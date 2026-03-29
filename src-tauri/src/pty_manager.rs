use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::Command;
use std::sync::Arc;
use std::thread;

use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::session::{SessionInfo, SessionStatus, ToolType};

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    info: SessionInfo,
    /// The tmux session name (e.g. "vcc-<uuid>"), if this session is tmux-backed.
    tmux_name: Option<String>,
}

/// Info about a discovered tmux session that is still running but not attached.
#[derive(Clone, serde::Serialize)]
pub struct TmuxSessionInfo {
    /// The tmux session name (e.g. "vcc-<uuid>")
    pub tmux_name: String,
    /// The session id extracted from the tmux name (uuid portion)
    pub session_id: String,
}

#[derive(Clone)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
    tmux_available: Arc<Mutex<Option<bool>>>,
}

#[derive(Clone, serde::Serialize)]
struct PtyOutputPayload {
    id: String,
    data: Vec<u8>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            tmux_available: Arc::new(Mutex::new(None)),
        }
    }

    /// Check whether tmux is available on this system. Caches the result.
    pub fn check_tmux(&self) -> bool {
        let mut cached = self.tmux_available.lock();
        if let Some(available) = *cached {
            return available;
        }
        let available = Command::new("which")
            .arg("tmux")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        *cached = Some(available);
        available
    }

    /// Create a new session. If tmux is available, uses tmux-backed spawning.
    /// Otherwise falls back to direct PTY spawning.
    pub fn create_session(
        &self,
        app: &AppHandle,
        tool: ToolType,
        cwd: String,
        initial_prompt: Option<String>,
    ) -> Result<String, String> {
        if self.check_tmux() {
            self.create_tmux_session(app, tool, cwd, initial_prompt)
        } else {
            self.create_direct_session(app, tool, cwd, initial_prompt)
        }
    }

    /// Create a session backed by tmux. The tool runs inside a tmux session,
    /// and we attach to it via PTY for xterm.js rendering.
    fn create_tmux_session(
        &self,
        app: &AppHandle,
        tool: ToolType,
        cwd: String,
        initial_prompt: Option<String>,
    ) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();
        let tmux_name = format!("vcc-{}", id);

        // Build the command string that tmux will execute
        let mut tool_args: Vec<String> = vec![tool.command().to_string()];
        if let Some(ref prompt) = initial_prompt {
            match tool {
                ToolType::Claude => {
                    tool_args.push("-p".to_string());
                    tool_args.push(prompt.clone());
                }
                ToolType::Codex => {
                    tool_args.push(prompt.clone());
                }
            }
        }

        // Resolve tool to absolute path so tmux can find it regardless of its shell's PATH
        let tool_bin = which_tool(tool.command());

        // Override the first arg with the resolved path
        tool_args[0] = tool_bin;

        // 1. Spawn the tool inside a new detached tmux session
        let mut tmux_cmd = Command::new("tmux");
        // Inherit current PATH so tmux's shell can find dependencies
        if let Ok(path) = std::env::var("PATH") {
            tmux_cmd.env("PATH", &path);
        }
        tmux_cmd.args([
            "new-session",
            "-d",
            "-s",
            &tmux_name,
            "-x",
            "80",
            "-y",
            "24",
            "-c",
            &cwd,
            "--",
        ]);
        // Add the tool command and its arguments
        for arg in &tool_args {
            tmux_cmd.arg(arg);
        }

        let output = tmux_cmd
            .output()
            .map_err(|e| format!("Failed to spawn tmux session: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("tmux new-session failed: {}", stderr));
        }

        // 2. Set scrollback history limit
        let _ = Command::new("tmux")
            .args([
                "set-option",
                "-t",
                &tmux_name,
                "history-limit",
                "10000",
            ])
            .output();

        // 3. Attach to the tmux session via PTY (for xterm.js rendering)
        self.attach_to_tmux(app, &id, &tmux_name, tool, cwd, initial_prompt)
    }

    /// Attach a PTY to an existing tmux session. Used both for initial creation
    /// and for reattachment after app restart.
    fn attach_to_tmux(
        &self,
        app: &AppHandle,
        id: &str,
        tmux_name: &str,
        tool: ToolType,
        cwd: String,
        _initial_prompt: Option<String>,
    ) -> Result<String, String> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let mut cmd = CommandBuilder::new("tmux");
        cmd.args(["attach-session", "-t", tmux_name]);

        let _child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to attach to tmux session {}: {}", tmux_name, e))?;

        drop(pair.slave);

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to get PTY reader: {}", e))?;

        let label = cwd.split('/').last().unwrap_or(&cwd).to_string();

        let info = SessionInfo {
            id: id.to_string(),
            tool,
            cwd,
            label,
            status: SessionStatus::Running,
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
        };

        let session = PtySession {
            master: pair.master,
            writer,
            info,
            tmux_name: Some(tmux_name.to_string()),
        };

        self.sessions.lock().insert(id.to_string(), session);

        // Spawn reader thread to stream output to frontend
        let session_id = id.to_string();
        let app_handle = app.clone();
        let sessions_ref = self.sessions.clone();

        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        // EOF — PTY attachment closed (could be detach or tmux session ended)
                        if let Some(session) = sessions_ref.lock().get_mut(&session_id) {
                            session.info.status = SessionStatus::Done;
                        }
                        let _ = app_handle.emit(
                            &format!("session:status:{}", session_id),
                            "done",
                        );
                        break;
                    }
                    Ok(n) => {
                        let payload = PtyOutputPayload {
                            id: session_id.clone(),
                            data: buf[..n].to_vec(),
                        };
                        let _ = app_handle.emit(
                            &format!("session:output:{}", session_id),
                            payload,
                        );
                    }
                    Err(_) => {
                        break;
                    }
                }
            }
        });

        Ok(id.to_string())
    }

    /// Direct PTY session (fallback when tmux is not available).
    /// This is the original behavior preserved as-is.
    fn create_direct_session(
        &self,
        app: &AppHandle,
        tool: ToolType,
        cwd: String,
        initial_prompt: Option<String>,
    ) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let mut cmd = CommandBuilder::new(tool.command());
        cmd.cwd(&cwd);

        // If there's an initial prompt, pass it as argument for claude
        if let Some(ref prompt) = initial_prompt {
            match tool {
                ToolType::Claude => {
                    cmd.arg("-p");
                    cmd.arg(prompt);
                }
                ToolType::Codex => {
                    cmd.arg(prompt);
                }
            }
        }

        let _child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn {}: {}", tool.command(), e))?;

        // Drop slave — we only need the master side
        drop(pair.slave);

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to get PTY reader: {}", e))?;

        let label = cwd.split('/').last().unwrap_or(&cwd).to_string();

        let info = SessionInfo {
            id: id.clone(),
            tool,
            cwd,
            label,
            status: SessionStatus::Running,
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
        };

        let session = PtySession {
            master: pair.master,
            writer,
            info,
            tmux_name: None,
        };

        self.sessions.lock().insert(id.clone(), session);

        // Spawn reader thread to stream output to frontend
        let session_id = id.clone();
        let app_handle = app.clone();
        let sessions_ref = self.sessions.clone();

        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        // EOF — process exited
                        if let Some(session) = sessions_ref.lock().get_mut(&session_id) {
                            session.info.status = SessionStatus::Done;
                        }
                        let _ = app_handle.emit(
                            &format!("session:status:{}", session_id),
                            "done",
                        );
                        break;
                    }
                    Ok(n) => {
                        let payload = PtyOutputPayload {
                            id: session_id.clone(),
                            data: buf[..n].to_vec(),
                        };
                        let _ = app_handle.emit(
                            &format!("session:output:{}", session_id),
                            payload,
                        );
                    }
                    Err(_) => {
                        break;
                    }
                }
            }
        });

        Ok(id)
    }

    /// Detach from a tmux session: drops the PTY attachment but leaves tmux running.
    /// For non-tmux sessions, this is equivalent to kill (drops the PTY).
    pub fn detach_session(&self, id: &str) -> Result<Option<String>, String> {
        let mut sessions = self.sessions.lock();
        let session = sessions
            .remove(id)
            .ok_or_else(|| format!("Session {} not found", id))?;
        // Return the tmux_name so the frontend knows it can be reattached
        Ok(session.tmux_name)
    }

    /// Reattach to an existing tmux session by creating a new PTY connection.
    pub fn reattach_session(
        &self,
        app: &AppHandle,
        id: &str,
        tmux_name: &str,
        tool: ToolType,
        cwd: String,
    ) -> Result<String, String> {
        // Verify the tmux session still exists
        let check = Command::new("tmux")
            .args(["has-session", "-t", tmux_name])
            .output()
            .map_err(|e| format!("Failed to check tmux session: {}", e))?;

        if !check.status.success() {
            return Err(format!(
                "tmux session {} no longer exists",
                tmux_name
            ));
        }

        self.attach_to_tmux(app, id, tmux_name, tool, cwd, None)
    }

    /// Kill a tmux session entirely (kills the underlying process).
    /// For non-tmux sessions, this just drops the PTY.
    pub fn kill_tmux_session(&self, id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        let session = sessions
            .remove(id)
            .ok_or_else(|| format!("Session {} not found", id))?;

        if let Some(ref tmux_name) = session.tmux_name {
            // Kill the tmux session
            let _ = Command::new("tmux")
                .args(["kill-session", "-t", tmux_name])
                .output();
        }
        // Dropping the session closes the PTY
        drop(session);
        Ok(())
    }

    /// Kill a tmux session by its tmux name (for orphaned sessions not in our map).
    pub fn kill_tmux_session_by_name(&self, tmux_name: &str) -> Result<(), String> {
        // First check if any of our tracked sessions have this name and remove them
        let mut sessions = self.sessions.lock();
        let to_remove: Vec<String> = sessions
            .iter()
            .filter(|(_, s)| s.tmux_name.as_deref() == Some(tmux_name))
            .map(|(id, _)| id.clone())
            .collect();
        for id in to_remove {
            sessions.remove(&id);
        }
        drop(sessions);

        let output = Command::new("tmux")
            .args(["kill-session", "-t", tmux_name])
            .output()
            .map_err(|e| format!("Failed to kill tmux session: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("tmux kill-session failed: {}", stderr));
        }
        Ok(())
    }

    /// List all tmux sessions with the `vcc-` prefix.
    pub fn list_tmux_sessions(&self) -> Vec<TmuxSessionInfo> {
        let output = match Command::new("tmux")
            .args(["list-sessions", "-F", "#{session_name}"])
            .output()
        {
            Ok(o) if o.status.success() => o,
            _ => return vec![],
        };

        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout
            .lines()
            .filter(|line| line.starts_with("vcc-"))
            .map(|line| {
                let tmux_name = line.trim().to_string();
                let session_id = tmux_name.strip_prefix("vcc-").unwrap_or("").to_string();
                TmuxSessionInfo {
                    tmux_name,
                    session_id,
                }
            })
            .collect()
    }

    /// Discover tmux sessions that are running but not currently attached.
    /// Returns sessions that exist in tmux but are not in our active sessions map.
    pub fn discover_sessions(&self) -> Vec<TmuxSessionInfo> {
        let all_tmux = self.list_tmux_sessions();
        let sessions = self.sessions.lock();
        let active_tmux_names: Vec<String> = sessions
            .values()
            .filter_map(|s| s.tmux_name.clone())
            .collect();

        all_tmux
            .into_iter()
            .filter(|t| !active_tmux_names.contains(&t.tmux_name))
            .collect()
    }

    /// Detach all active tmux sessions (used on app exit).
    /// Non-tmux sessions are killed (they can't survive without the PTY).
    pub fn detach_all(&self) {
        let mut sessions = self.sessions.lock();
        // Just drain all sessions — dropping them closes PTY attachments.
        // tmux sessions keep running in the background.
        sessions.clear();
    }

    // === Existing methods (preserved) ===

    pub fn write_to_session(&self, id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| format!("Session {} not found", id))?;

        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Write failed: {}", e))?;

        session
            .writer
            .flush()
            .map_err(|e| format!("Flush failed: {}", e))?;

        Ok(())
    }

    pub fn resize_session(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock();
        let session = sessions
            .get(id)
            .ok_or_else(|| format!("Session {} not found", id))?;

        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize failed: {}", e))?;

        Ok(())
    }

    pub fn kill_session(&self, id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        let session = sessions
            .remove(id)
            .ok_or_else(|| format!("Session {} not found", id))?;

        // If this is a tmux session, also kill the tmux session
        if let Some(ref tmux_name) = session.tmux_name {
            let _ = Command::new("tmux")
                .args(["kill-session", "-t", tmux_name])
                .output();
        }

        // Dropping the session closes the PTY
        drop(session);
        Ok(())
    }

    pub fn list_sessions(&self) -> Vec<SessionInfo> {
        self.sessions
            .lock()
            .values()
            .map(|s| s.info.clone())
            .collect()
    }
}

/// Resolve a tool name to its absolute path using `which`.
/// Falls back to the bare name if `which` fails.
fn which_tool(name: &str) -> String {
    Command::new("which")
        .arg(name)
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        })
        .unwrap_or_else(|| name.to_string())
}

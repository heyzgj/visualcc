use std::collections::HashMap;
use std::io::{Read, Write};
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
}

#[derive(Clone)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
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
        }
    }

    pub fn create_session(
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

        let label = cwd
            .split('/')
            .last()
            .unwrap_or(&cwd)
            .to_string();

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
        // Removing the session drops the master PTY, which signals the child process
        sessions
            .remove(id)
            .ok_or_else(|| format!("Session {} not found", id))?;
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

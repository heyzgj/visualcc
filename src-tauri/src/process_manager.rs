use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::Arc;
use std::thread;

use parking_lot::Mutex;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::session::{SessionInfo, SessionStatus, ToolType};

struct ProcessSession {
    stdin: Option<ChildStdin>,
    info: SessionInfo,
    #[allow(dead_code)]
    child_id: u32,
}

#[derive(Clone)]
pub struct ProcessManager {
    sessions: Arc<Mutex<HashMap<String, ProcessSession>>>,
}

#[derive(Clone, serde::Serialize)]
struct LinePayload {
    id: String,
    line: String,
}

#[derive(Clone, serde::Serialize)]
struct StderrPayload {
    id: String,
    line: String,
}

impl ProcessManager {
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

        let mut cmd = Command::new(tool.command());
        cmd.current_dir(&cwd);
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        // Add structured output flags
        match tool {
            ToolType::Claude => {
                cmd.arg("--output-format");
                cmd.arg("stream-json");
                cmd.arg("--input-format");
                cmd.arg("stream-json");
                cmd.arg("--verbose");
                if let Some(ref prompt) = initial_prompt {
                    cmd.arg("-p");
                    cmd.arg(prompt);
                }
            }
            ToolType::Codex => {
                cmd.arg("exec");
                cmd.arg("--json");
                if let Some(ref prompt) = initial_prompt {
                    cmd.arg(prompt);
                } else {
                    cmd.arg("help");
                }
            }
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn {}: {}", tool.command(), e))?;

        let child_id = child.id();
        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

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

        let session = ProcessSession {
            stdin,
            info,
            child_id,
        };

        self.sessions.lock().insert(id.clone(), session);

        // Spawn stdout reader thread — reads line-by-line
        if let Some(stdout) = stdout {
            let session_id = id.clone();
            let app_handle = app.clone();
            let sessions_ref = self.sessions.clone();

            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line_result in reader.lines() {
                    match line_result {
                        Ok(line) => {
                            if line.trim().is_empty() {
                                continue;
                            }
                            let payload = LinePayload {
                                id: session_id.clone(),
                                line,
                            };
                            let _ = app_handle.emit(
                                &format!("session:line:{}", session_id),
                                payload,
                            );
                        }
                        Err(_) => break,
                    }
                }
                // stdout closed — process exited
                if let Some(session) = sessions_ref.lock().get_mut(&session_id) {
                    session.info.status = SessionStatus::Done;
                }
                let _ = app_handle.emit(
                    &format!("session:status:{}", session_id),
                    "done",
                );
            });
        }

        // Spawn stderr reader thread
        if let Some(stderr) = stderr {
            let session_id = id.clone();
            let app_handle = app.clone();
            let sessions_ref = self.sessions.clone();

            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line_result in reader.lines() {
                    match line_result {
                        Ok(line) => {
                            if line.trim().is_empty() {
                                continue;
                            }
                            let payload = StderrPayload {
                                id: session_id.clone(),
                                line,
                            };
                            let _ = app_handle.emit(
                                &format!("session:stderr:{}", session_id),
                                payload,
                            );
                        }
                        Err(_) => break,
                    }
                }
                // Check if process had an error
                if let Some(session) = sessions_ref.lock().get_mut(&session_id) {
                    // Only mark as error if it was still running
                    if matches!(session.info.status, SessionStatus::Running) {
                        // Don't override — stdout thread handles the final status
                    }
                }
            });
        }

        // Spawn a thread to wait for the child process to exit
        let session_id = id.clone();
        let app_handle = app.clone();
        let sessions_ref = self.sessions.clone();

        thread::spawn(move || {
            let status = child.wait();
            if let Some(session) = sessions_ref.lock().get_mut(&session_id) {
                match status {
                    Ok(exit) if exit.success() => {
                        session.info.status = SessionStatus::Done;
                        let _ = app_handle.emit(
                            &format!("session:status:{}", session_id),
                            "done",
                        );
                    }
                    Ok(_) => {
                        session.info.status = SessionStatus::Error;
                        let _ = app_handle.emit(
                            &format!("session:status:{}", session_id),
                            "error",
                        );
                    }
                    Err(_) => {
                        session.info.status = SessionStatus::Error;
                        let _ = app_handle.emit(
                            &format!("session:status:{}", session_id),
                            "error",
                        );
                    }
                }
            }
        });

        Ok(id)
    }

    pub fn send_message(&self, id: &str, message: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| format!("Session {} not found", id))?;

        let stdin = session
            .stdin
            .as_mut()
            .ok_or_else(|| "Session stdin not available".to_string())?;

        stdin
            .write_all(message.as_bytes())
            .map_err(|e| format!("Write failed: {}", e))?;

        stdin
            .flush()
            .map_err(|e| format!("Flush failed: {}", e))?;

        Ok(())
    }

    pub fn kill_session(&self, id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        let session = sessions
            .remove(id)
            .ok_or_else(|| format!("Session {} not found", id))?;

        // Kill the process by PID
        #[cfg(unix)]
        {
            unsafe {
                libc::kill(session.child_id as i32, libc::SIGTERM);
            }
        }

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

use tauri::State;

use crate::process_manager::ProcessManager;
use crate::pty_manager::{PtyManager, TmuxSessionInfo};
use crate::session::{SessionInfo, ToolType};

// === PTY-based commands (terminal fallback) ===

#[tauri::command]
pub fn create_session(
    app: tauri::AppHandle,
    pty_manager: State<'_, PtyManager>,
    tool: ToolType,
    cwd: String,
    initial_prompt: Option<String>,
) -> Result<String, String> {
    eprintln!("[VisualCC-Rust] create_session called: tool={:?}, cwd={}", tool, cwd);
    let result = pty_manager.create_session(&app, tool, cwd, initial_prompt);
    match &result {
        Ok(id) => eprintln!("[VisualCC-Rust] create_session OK: id={}", id),
        Err(e) => eprintln!("[VisualCC-Rust] create_session ERROR: {}", e),
    }
    result
}

#[tauri::command]
pub fn write_to_session(
    pty_manager: State<'_, PtyManager>,
    id: String,
    data: String,
) -> Result<(), String> {
    pty_manager.write_to_session(&id, &data)
}

#[tauri::command]
pub fn resize_session(
    pty_manager: State<'_, PtyManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    pty_manager.resize_session(&id, cols, rows)
}

#[tauri::command]
pub fn kill_session(
    pty_manager: State<'_, PtyManager>,
    id: String,
) -> Result<(), String> {
    pty_manager.kill_session(&id)
}

#[tauri::command]
pub fn list_sessions(
    pty_manager: State<'_, PtyManager>,
) -> Vec<SessionInfo> {
    pty_manager.list_sessions()
}

// === tmux session commands ===

#[tauri::command]
pub fn check_tmux(
    pty_manager: State<'_, PtyManager>,
) -> bool {
    pty_manager.check_tmux()
}

#[tauri::command]
pub fn detach_session(
    pty_manager: State<'_, PtyManager>,
    id: String,
) -> Result<Option<String>, String> {
    pty_manager.detach_session(&id)
}

#[tauri::command]
pub fn reattach_session(
    app: tauri::AppHandle,
    pty_manager: State<'_, PtyManager>,
    id: String,
    tmux_name: String,
    tool: ToolType,
    cwd: String,
) -> Result<String, String> {
    pty_manager.reattach_session(&app, &id, &tmux_name, tool, cwd)
}

#[tauri::command]
pub fn kill_tmux_session(
    pty_manager: State<'_, PtyManager>,
    id: String,
) -> Result<(), String> {
    pty_manager.kill_tmux_session(&id)
}

#[tauri::command]
pub fn kill_tmux_session_by_name(
    pty_manager: State<'_, PtyManager>,
    tmux_name: String,
) -> Result<(), String> {
    pty_manager.kill_tmux_session_by_name(&tmux_name)
}

#[tauri::command]
pub fn discover_sessions(
    pty_manager: State<'_, PtyManager>,
) -> Vec<TmuxSessionInfo> {
    pty_manager.discover_sessions()
}

#[tauri::command]
pub fn list_tmux_sessions(
    pty_manager: State<'_, PtyManager>,
) -> Vec<TmuxSessionInfo> {
    pty_manager.list_tmux_sessions()
}

// === Structured output commands (rich chat UI) ===

#[tauri::command]
pub fn create_structured_session(
    app: tauri::AppHandle,
    process_manager: State<'_, ProcessManager>,
    tool: ToolType,
    cwd: String,
    initial_prompt: Option<String>,
) -> Result<String, String> {
    process_manager.create_session(&app, tool, cwd, initial_prompt)
}

#[tauri::command]
pub fn send_message(
    process_manager: State<'_, ProcessManager>,
    id: String,
    message: String,
) -> Result<(), String> {
    process_manager.send_message(&id, &message)
}

#[tauri::command]
pub fn kill_structured_session(
    process_manager: State<'_, ProcessManager>,
    id: String,
) -> Result<(), String> {
    process_manager.kill_session(&id)
}

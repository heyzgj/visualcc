mod commands;
mod pty_manager;
mod session;

use pty_manager::PtyManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pty_manager = PtyManager::new();

    // Keep a clone for the exit handler
    let pty_manager_for_exit = pty_manager.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .manage(pty_manager)
        .invoke_handler(tauri::generate_handler![
            commands::create_session,
            commands::prepare_reviewer_workspace,
            commands::write_to_session,
            commands::resize_session,
            commands::kill_session,
            commands::list_sessions,
            commands::check_tmux,
            commands::detach_session,
            commands::reattach_session,
            commands::kill_tmux_session,
            commands::kill_tmux_session_by_name,
            commands::discover_sessions,
            commands::list_tmux_sessions,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .on_window_event(move |_window, event| {
            // On window close/destroy, detach all tmux sessions so they survive
            if let tauri::WindowEvent::Destroyed = event {
                pty_manager_for_exit.detach_all();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

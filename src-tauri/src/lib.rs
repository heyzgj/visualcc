mod commands;
mod process_manager;
mod pty_manager;
mod session;

use process_manager::ProcessManager;
use pty_manager::PtyManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pty_manager = PtyManager::new();
    let process_manager = ProcessManager::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .manage(pty_manager)
        .manage(process_manager)
        .invoke_handler(tauri::generate_handler![
            commands::create_session,
            commands::write_to_session,
            commands::resize_session,
            commands::kill_session,
            commands::list_sessions,
            commands::create_structured_session,
            commands::send_message,
            commands::kill_structured_session,
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

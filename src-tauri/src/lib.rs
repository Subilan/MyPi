mod agent;

#[cfg(target_os = "macos")]
mod menu;

#[tauri::command]
fn app_info() -> serde_json::Value {
    serde_json::json!({
        "name": env!("CARGO_PKG_NAME"),
        "version": env!("CARGO_PKG_VERSION"),
        "tauri": tauri::VERSION,
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(agent::AgentProcess::default())
        .invoke_handler(tauri::generate_handler![app_info, agent::agent_request, agent::agent_status]);

    // macOS 默认菜单把 Cmd+W 绑在 Close Window 上，会截走编辑器里的关闭快捷键
    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::build);

    builder
        .setup(|app| {
            agent::start(app.handle())?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                agent::stop(app);
            }
        });
}

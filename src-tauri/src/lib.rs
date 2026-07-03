use base64::{engine::general_purpose::STANDARD, Engine};
use tauri::Manager;

#[tauri::command]
fn save_file(path: String, base64_data: String) -> Result<(), String> {
    let bytes = STANDARD.decode(base64_data).map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

fn log_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("gugle-ai.log"))
}

#[tauri::command]
fn append_log(app: tauri::AppHandle, line: String) -> Result<(), String> {
    use std::io::Write;
    let path = log_path(&app)?;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{line}").map_err(|e| e.to_string())
}

#[tauri::command]
fn show_log_file(app: tauri::AppHandle) -> Result<String, String> {
    let path = log_path(&app)?;
    if !path.exists() {
        std::fs::write(&path, "").map_err(|e| e.to_string())?;
    }
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_file, append_log, show_log_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

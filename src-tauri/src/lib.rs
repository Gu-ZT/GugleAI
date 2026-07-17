use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemInfo {
    system: String,
    arch: String,
    username: String,
}

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

// reqwest 默认只读代理环境变量,这里补上 Windows 系统代理(注册表)的探测
#[tauri::command]
fn get_system_proxy() -> Option<String> {
    for key in [
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy",
    ] {
        if let Ok(v) = std::env::var(key) {
            if !v.is_empty() {
                return Some(v);
            }
        }
    }
    #[cfg(windows)]
    {
        if let Some(p) = windows_registry_proxy() {
            return Some(p);
        }
    }
    None
}

#[tauri::command]
fn get_system_info() -> SystemInfo {
    let username = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "未知".to_string());
    SystemInfo {
        system: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        username,
    }
}

#[cfg(windows)]
fn windows_registry_proxy() -> Option<String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")
        .ok()?;
    let enabled: u32 = key.get_value("ProxyEnable").ok()?;
    if enabled == 0 {
        return None;
    }
    let server: String = key.get_value("ProxyServer").ok()?;
    if server.is_empty() {
        return None;
    }
    // 可能是 "host:port",也可能是 "http=host:port;https=host:port" 分协议格式
    let pick = if server.contains('=') {
        server.split(';').find_map(|part| {
            let (k, v) = part.split_once('=')?;
            (k == "https" || k == "http").then(|| v.to_string())
        })?
    } else {
        server
    };
    Some(if pick.contains("://") {
        pick
    } else {
        format!("http://{pick}")
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            save_file,
            append_log,
            show_log_file,
            get_system_proxy,
            get_system_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

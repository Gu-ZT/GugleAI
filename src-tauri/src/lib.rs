use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{DateTime, Duration, Local};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::Manager;

const LOG_FILE_NAME: &str = "gugle-ai.log";
const MAX_LOG_BYTES: u64 = 100 * 1024;
static LOG_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

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
    Ok(dir.join(LOG_FILE_NAME))
}

#[tauri::command]
fn append_log(app: tauri::AppHandle, line: String) -> Result<(), String> {
    use std::io::Write;
    let lock = LOG_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock.lock().map_err(|_| "日志锁已损坏".to_string())?;
    let path = log_path(&app)?;
    let incoming_bytes = line.len() as u64 + 1;
    if let Ok(metadata) = std::fs::metadata(&path) {
        if metadata.len().saturating_add(incoming_bytes) > MAX_LOG_BYTES {
            rotate_log_file(&path, &metadata)?;
        }
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{line}").map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())?;
    drop(file);
    if let Ok(metadata) = std::fs::metadata(&path) {
        if metadata.len() > MAX_LOG_BYTES {
            rotate_log_file(&path, &metadata)?;
        }
    }
    Ok(())
}

#[tauri::command]
fn show_log_file(app: tauri::AppHandle) -> Result<String, String> {
    let lock = LOG_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock.lock().map_err(|_| "日志锁已损坏".to_string())?;
    let path = log_path(&app)?;
    if !path.exists() {
        std::fs::write(&path, "").map_err(|e| e.to_string())?;
    }
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

fn rotate_log_file(path: &Path, metadata: &std::fs::Metadata) -> Result<Option<PathBuf>, String> {
    if metadata.len() == 0 {
        return Ok(None);
    }
    let modified = metadata
        .modified()
        .unwrap_or_else(|_| std::time::SystemTime::now());
    let timestamp = DateTime::<Local>::from(modified);
    let directory = path.parent().ok_or_else(|| "日志目录不存在".to_string())?;
    for offset in 0..10_000i64 {
        let candidate_time = timestamp + Duration::milliseconds(offset);
        let candidate = directory.join(format!(
            "gugle-ai-{}.log",
            candidate_time.format("%Y-%m-%d-%H-%M-%S-%3f")
        ));
        if candidate.exists() {
            continue;
        }
        std::fs::rename(path, &candidate).map_err(|e| e.to_string())?;
        return Ok(Some(candidate));
    }
    Err("无法为日志归档生成唯一文件名".to_string())
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
        .setup(|app| {
            let lock = LOG_LOCK.get_or_init(|| Mutex::new(()));
            if let Ok(_guard) = lock.lock() {
                if let Ok(path) = log_path(&app.handle()) {
                    if let Ok(metadata) = std::fs::metadata(&path) {
                        let _ = rotate_log_file(&path, &metadata);
                    }
                }
            }
            Ok(())
        })
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

use std::{fs, path::PathBuf};
use std::{io::{Read, Write}, net::TcpListener, sync::Mutex, time::{Duration, Instant}};
use tauri::Manager;

struct OAuthSlot(Mutex<Option<TcpListener>>);

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let d = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn file_path(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    let ok = !name.is_empty() && !name.contains("..") && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    if !ok {
        return Err("bad file name".into());
    }
    Ok(data_dir(app)?.join(name))
}

#[tauri::command]
fn read_file(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    let p = file_path(&app, &name)?;
    match fs::read_to_string(&p) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Atomic write: temp file then rename, so a crash never leaves a half-written vault.
#[tauri::command]
fn write_file(app: tauri::AppHandle, name: String, content: String) -> Result<(), String> {
    let p = file_path(&app, &name)?;
    let tmp = p.with_extension("tmp");
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

/// 32-byte random secret, stored protected by the OS (Windows DPAPI: bound to this Windows user and machine).
/// The UI mixes it into the PIN key so a copied vault file alone cannot be brute-forced.
#[tauri::command]
fn device_secret(app: tauri::AppHandle) -> Result<Vec<u8>, String> {
    let p = file_path(&app, "device.bin")?;
    if let Ok(blob) = fs::read(&p) {
        return os::unprotect(&blob);
    }
    let mut secret = [0u8; 32];
    getrandom::getrandom(&mut secret).map_err(|e| e.to_string())?;
    let blob = os::protect(&secret)?;
    fs::write(&p, blob).map_err(|e| e.to_string())?;
    Ok(secret.to_vec())
}

/// Loopback OAuth (RFC 8252): bind a free 127.0.0.1 port, the UI opens the system browser, then waits for the redirect.
#[tauri::command]
fn oauth_start(slot: tauri::State<OAuthSlot>) -> Result<u16, String> {
    let l = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    l.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = l.local_addr().map_err(|e| e.to_string())?.port();
    *slot.0.lock().unwrap() = Some(l);
    Ok(port)
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://accounts.google.com/") {
        return Err("url not allowed".into());
    }
    #[cfg(windows)]
    let r = std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", &url]).spawn();
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let r = std::process::Command::new("xdg-open").arg(&url).spawn();
    r.map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn oauth_wait(slot: tauri::State<'_, OAuthSlot>) -> Result<String, String> {
    let l = slot.0.lock().unwrap().take().ok_or("oauth not started")?;
    tauri::async_runtime::spawn_blocking(move || {
        let end = Instant::now() + Duration::from_secs(180);
        loop {
            match l.accept() {
                Ok((mut s, _)) => {
                    let _ = s.set_nonblocking(false);
                    let _ = s.set_read_timeout(Some(Duration::from_secs(5)));
                    let mut buf = [0u8; 4096];
                    let n = s.read(&mut buf).unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    let line = req.lines().next().unwrap_or("");
                    let query = line.split_whitespace().nth(1).and_then(|p| p.split_once('?')).map(|x| x.1.to_string());
                    let body = "<html><body style=\"font-family:sans-serif;background:#0b1220;color:#e9eefc;display:grid;place-items:center;height:100vh\"><h2>Lumen: you can close this tab</h2></body></html>";
                    let _ = s.write_all(format!("HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Content-Length: {}
Connection: close

{}", body.len(), body).as_bytes());
                    if let Some(q) = query {
                        return Ok(q);
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    if Instant::now() > end { return Err("timeout".to_string()); }
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(e) => return Err(e.to_string()),
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(windows)]
mod os {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB};

    fn run(data: &[u8], protect: bool) -> Result<Vec<u8>, String> {
        unsafe {
            let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
            let mut out = CRYPT_INTEGER_BLOB::default();
            if protect {
                CryptProtectData(&input, None, None, None, None, 0, &mut out).map_err(|e| e.to_string())?;
            } else {
                CryptUnprotectData(&input, None, None, None, None, 0, &mut out).map_err(|e| e.to_string())?;
            }
            let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
            let _ = LocalFree(Some(HLOCAL(out.pbData as *mut _)));
            Ok(v)
        }
    }
    pub fn protect(d: &[u8]) -> Result<Vec<u8>, String> { run(d, true) }
    pub fn unprotect(d: &[u8]) -> Result<Vec<u8>, String> { run(d, false) }
}

// Other platforms: replaced by Keychain / Android Keystore in a later step.
#[cfg(not(windows))]
mod os {
    pub fn protect(d: &[u8]) -> Result<Vec<u8>, String> { Ok(d.to_vec()) }
    pub fn unprotect(d: &[u8]) -> Result<Vec<u8>, String> { Ok(d.to_vec()) }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(OAuthSlot(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![read_file, write_file, device_secret, oauth_start, open_url, oauth_wait])
        .run(tauri::generate_context!())
        .expect("error while running Lumen");
}

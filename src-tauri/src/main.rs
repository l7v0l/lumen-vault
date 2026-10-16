#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, path::PathBuf};
use tauri::Manager;

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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![read_file, write_file, device_secret])
        .run(tauri::generate_context!())
        .expect("error while running Lumen");
}

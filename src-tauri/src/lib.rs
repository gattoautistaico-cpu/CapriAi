//! Cyber AI - backend Tauri.
//! Overlay trasparente always-on-top con click-through selettivo,
//! cattura schermo, Piper TTS, gestione processi locali (whisper-server),
//! import sprite e tray icon.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Deserialize;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WebviewWindow};

mod pet;

/// Rettangolo cliccabile in coordinate CSS (logiche) della finestra.
#[derive(Deserialize, Clone, Debug)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Default)]
struct Shared {
    rects: Mutex<Vec<Rect>>,
    /// true = finestra completamente interattiva (es. impostazioni aperte)
    interactive: AtomicBool,
    children: Mutex<Vec<(String, Child)>>,
    tts_counter: AtomicU64,
}

type AppState = Arc<Shared>;

// ---------------------------------------------------------------- overlay

#[tauri::command]
fn set_hit_rects(state: State<'_, AppState>, rects: Vec<Rect>) {
    if let Ok(mut r) = state.rects.lock() {
        *r = rects;
    }
}

#[tauri::command]
fn set_interactive(state: State<'_, AppState>, on: bool) {
    state.interactive.store(on, Ordering::Relaxed);
}

/// Thread che decide se la finestra deve lasciar passare i click:
/// cursore sopra avatar/pannelli -> cattura, altrove -> click-through.
fn spawn_hit_test(win: WebviewWindow, state: AppState) {
    std::thread::spawn(move || {
        let mut last: Option<bool> = None;
        loop {
            std::thread::sleep(Duration::from_millis(40));
            let ignore = if state.interactive.load(Ordering::Relaxed) {
                false
            } else {
                match (
                    win.cursor_position(),
                    win.outer_position(),
                    win.scale_factor(),
                ) {
                    (Ok(c), Ok(p), Ok(s)) => {
                        let lx = (c.x - p.x as f64) / s;
                        let ly = (c.y - p.y as f64) / s;
                        match state.rects.lock() {
                            Ok(rects) => !rects.iter().any(|r| {
                                lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h
                            }),
                            Err(_) => true,
                        }
                    }
                    _ => true,
                }
            };
            if last != Some(ignore) && win.set_ignore_cursor_events(ignore).is_ok() {
                last = Some(ignore);
            }
        }
    });
}

/// Copre il monitor principale (1px in meno in altezza: evita che Windows
/// la tratti come app fullscreen e nasconda la taskbar).
fn fit_to_monitor(win: &WebviewWindow) {
    if let Ok(Some(m)) = win.primary_monitor() {
        let pos = m.position();
        let size = m.size();
        let _ = win.set_position(tauri::PhysicalPosition::new(pos.x, pos.y));
        let _ = win.set_size(tauri::PhysicalSize::new(
            size.width,
            size.height.saturating_sub(1),
        ));
    }
}

// ---------------------------------------------------------------- schermo

#[tauri::command]
async fn capture_screen(max_width: u32, quality: u8) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || capture_impl(max_width, quality))
        .await
        .map_err(|e| e.to_string())?
}

/// Accetta sia `bool` sia `Result<bool, E>` (l'API di xcap è cambiata tra versioni).
#[cfg(windows)]
trait AsBool {
    fn as_bool(self) -> bool;
}
#[cfg(windows)]
impl AsBool for bool {
    fn as_bool(self) -> bool {
        self
    }
}
#[cfg(windows)]
impl<E> AsBool for Result<bool, E> {
    fn as_bool(self) -> bool {
        self.unwrap_or(false)
    }
}

#[cfg(windows)]
fn capture_impl(max_width: u32, quality: u8) -> Result<String, String> {
    use xcap::Monitor;
    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let mon = monitors
        .iter()
        .find(|m| m.is_primary().as_bool())
        .or_else(|| monitors.first())
        .ok_or_else(|| "nessun monitor trovato".to_string())?;
    let img = mon.capture_image().map_err(|e| e.to_string())?;
    let (w, h) = (img.width(), img.height());
    encode_jpeg(w, h, img.into_raw(), max_width, quality)
}

#[cfg(not(windows))]
fn capture_impl(_max_width: u32, _quality: u8) -> Result<String, String> {
    Err("cattura schermo supportata solo su Windows".into())
}

#[allow(dead_code)]
fn encode_jpeg(
    w: u32,
    h: u32,
    raw: Vec<u8>,
    max_width: u32,
    quality: u8,
) -> Result<String, String> {
    let rgba = image::RgbaImage::from_raw(w, h, raw).ok_or("buffer immagine non valido")?;
    let mut img = image::DynamicImage::ImageRgba8(rgba);
    if max_width > 0 && w > max_width {
        let nh = ((h as f64) * (max_width as f64) / (w as f64))
            .round()
            .max(1.0) as u32;
        img = img.resize_exact(max_width, nh, image::imageops::FilterType::Triangle);
    }
    let rgb = img.to_rgb8();
    let mut out: Vec<u8> = Vec::new();
    {
        let mut enc =
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality.clamp(30, 95));
        enc.encode_image(&rgb).map_err(|e| e.to_string())?;
    }
    Ok(B64.encode(out))
}

// ---------------------------------------------------------------- processi

#[cfg(windows)]
fn hide_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}
#[cfg(not(windows))]
fn hide_window(_cmd: &mut Command) {}

/// Piper TTS: testo su stdin -> wav -> base64.
#[tauri::command]
async fn piper_tts(
    state: State<'_, AppState>,
    exe: String,
    model: String,
    text: String,
    speaker: Option<u32>,
    length_scale: Option<f32>,
) -> Result<String, String> {
    let n = state.tts_counter.fetch_add(1, Ordering::Relaxed);
    tauri::async_runtime::spawn_blocking(move || {
        let out =
            std::env::temp_dir().join(format!("cyberai_tts_{}_{}.wav", std::process::id(), n));
        let mut cmd = Command::new(&exe);
        cmd.arg("--model")
            .arg(&model)
            .arg("--output_file")
            .arg(&out);
        if let Some(s) = speaker {
            cmd.arg("--speaker").arg(s.to_string());
        }
        if let Some(l) = length_scale {
            cmd.arg("--length_scale").arg(format!("{l:.2}"));
        }
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        hide_window(&mut cmd);
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Piper non avviabile ({exe}): {e}"))?;
        if let Some(mut stdin) = child.stdin.take() {
            let line = text.replace(['\r', '\n'], " ");
            stdin
                .write_all(line.as_bytes())
                .map_err(|e| e.to_string())?;
            stdin.write_all(b"\n").map_err(|e| e.to_string())?;
        }
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(format!(
                "Piper errore: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        let bytes = std::fs::read(&out).map_err(|e| format!("wav non trovato: {e}"))?;
        let _ = std::fs::remove_file(&out);
        Ok(B64.encode(bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Avvia un servizio locale (es. whisper-server). Stesso tag = riavvio.
#[tauri::command]
fn start_service(
    state: State<'_, AppState>,
    tag: String,
    exe: String,
    args: Vec<String>,
) -> Result<u32, String> {
    stop_service_inner(&state, &tag);
    let mut cmd = Command::new(&exe);
    cmd.args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(dir) = PathBuf::from(&exe).parent() {
        cmd.current_dir(dir);
    }
    hide_window(&mut cmd);
    let child = cmd
        .spawn()
        .map_err(|e| format!("{tag}: impossibile avviare {exe}: {e}"))?;
    let pid = child.id();
    if let Ok(mut c) = state.children.lock() {
        c.push((tag, child));
    }
    Ok(pid)
}

fn stop_service_inner(state: &Shared, tag: &str) {
    if let Ok(mut c) = state.children.lock() {
        c.retain_mut(|(t, child)| {
            if t.as_str() == tag {
                let _ = child.kill();
                let _ = child.wait();
                false
            } else {
                true
            }
        });
    }
}

#[tauri::command]
fn stop_service(state: State<'_, AppState>, tag: String) {
    stop_service_inner(&state, &tag);
}

#[tauri::command]
fn service_running(state: State<'_, AppState>, tag: String) -> bool {
    match state.children.lock() {
        Ok(mut c) => c
            .iter_mut()
            .any(|(t, child)| t.as_str() == tag && matches!(child.try_wait(), Ok(None))),
        Err(_) => false,
    }
}

fn kill_all(state: &Shared) {
    if let Ok(mut c) = state.children.lock() {
        for (_, child) in c.iter_mut() {
            let _ = child.kill();
        }
        c.clear();
    }
}

// ---------------------------------------------------------------- file

fn profiles_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("profiles"))
}

/// Copia uno sprite dentro AppData/profiles/<sub_dir>/ e ritorna il percorso finale.
#[tauri::command]
fn import_file(app: AppHandle, src: String, sub_dir: String) -> Result<String, String> {
    let safe: String = sub_dir
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-' || *c == '/')
        .collect();
    let dir = profiles_dir(&app)?.join(safe.trim_matches('/'));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let src_p = PathBuf::from(&src);
    let ext = src_p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if !["png", "webp", "gif", "jpg", "jpeg", "apng", "webm", "mp4"].contains(&ext.as_str()) {
        return Err(format!("formato non supportato: .{ext}"));
    }
    let stem: String = src_p
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("sprite")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .take(40)
        .collect();
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let dest = dir.join(format!("{ts}_{stem}.{ext}"));
    std::fs::copy(&src_p, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

/// Elimina un file importato (solo dentro la cartella profili).
#[tauri::command]
fn delete_file(app: AppHandle, path: String) -> Result<(), String> {
    let base = profiles_dir(&app)?;
    let p = PathBuf::from(&path);
    let canon_base = base.canonicalize().map_err(|e| e.to_string())?;
    let canon = p.canonicalize().map_err(|e| e.to_string())?;
    if !canon.starts_with(&canon_base) {
        return Err("percorso non consentito".into());
    }
    std::fs::remove_file(canon).map_err(|e| e.to_string())
}

#[tauri::command]
fn data_dir(app: AppHandle) -> Result<String, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string())
}

/// Cartella strumenti locali di default: %LOCALAPPDATA%\CyberAI\tools
#[tauri::command]
fn tools_dir() -> String {
    let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into());
    PathBuf::from(base)
        .join("CyberAI")
        .join("tools")
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    PathBuf::from(path).exists()
}

// ---------------------------------------------------------------- app, finestra attiva, OCR

/// Elenco app del menu Start (nome + AppID), JSON. Usa Get-StartApps (Windows 10/11).
#[tauri::command]
async fn list_apps() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut cmd = Command::new("powershell.exe");
        cmd.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress",
        ]);
        cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        hide_window(&mut cmd);
        let out = cmd.output().map_err(|e| format!("powershell: {e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).to_string());
        }
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Apre un'app dal suo AppID (shell:AppsFolder), oppure un percorso .exe/.lnk.
#[tauri::command]
fn open_app(app_id: String) -> Result<(), String> {
    let id = app_id.trim();
    if id.is_empty() || id.contains('"') {
        return Err("app non valida".into());
    }
    let low = id.to_ascii_lowercase();
    let target = if low.ends_with(".exe")
        || low.ends_with(".lnk")
        || low.contains(":\\")
        || low.starts_with("shell:")
    {
        id.to_string()
    } else if id.starts_with("raw:") {
        // nome semplice ("notepad", "chrome"): lo risolve Windows tramite App Paths / PATH
        id[4..].to_string()
    } else {
        format!("shell:AppsFolder\\{id}")
    };
    shell_open(&target)
}

#[cfg(windows)]
#[link(name = "user32")]
extern "system" {
    fn GetForegroundWindow() -> isize;
    fn GetWindowTextW(hwnd: isize, buf: *mut u16, max: i32) -> i32;
}

/// Titolo della finestra in primo piano (per sapere cosa sta guardando l'utente).
#[tauri::command]
fn foreground_title() -> String {
    #[cfg(windows)]
    unsafe {
        let h = GetForegroundWindow();
        if h == 0 {
            return String::new();
        }
        let mut buf = [0u16; 512];
        let n = GetWindowTextW(h, buf.as_mut_ptr(), buf.len() as i32);
        if n <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..n as usize])
    }
    #[cfg(not(windows))]
    String::new()
}

const OCR_PS: &str = r#"
param([string]$path)
[Console]::OutputEncoding=[Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime] | Out-Null
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { Write-Output '[OCR non disponibile: installa una lingua con OCR in Impostazioni > Lingua]'; exit 0 }
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$result.Lines | ForEach-Object { $_.Text }
"#;

/// Testo visibile sullo schermo principale tramite OCR di Windows (Windows.Media.Ocr).
#[tauri::command]
async fn ocr_screen() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(ocr_impl)
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(windows)]
fn ocr_impl() -> Result<String, String> {
    use xcap::Monitor;
    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let mon = monitors
        .iter()
        .find(|m| m.is_primary().as_bool())
        .or_else(|| monitors.first())
        .ok_or_else(|| "nessun monitor".to_string())?;
    let img = mon.capture_image().map_err(|e| e.to_string())?;
    let dir = std::env::temp_dir();
    let png = dir.join(format!("cyberai_ocr_{}.png", std::process::id()));
    let ps1 = dir.join("cyberai_ocr.ps1");
    image::DynamicImage::ImageRgba8(
        image::RgbaImage::from_raw(img.width(), img.height(), img.into_raw()).ok_or("buffer")?,
    )
    .save(&png)
    .map_err(|e| e.to_string())?;
    std::fs::write(&ps1, OCR_PS).map_err(|e| e.to_string())?;
    let mut cmd = Command::new("powershell.exe");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
    ])
    .arg(&ps1)
    .arg(&png);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_window(&mut cmd);
    let out = cmd.output().map_err(|e| e.to_string());
    let _ = std::fs::remove_file(&png);
    let out = out?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if text.is_empty() && !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr)
            .chars()
            .take(300)
            .collect());
    }
    Ok(text.chars().take(8000).collect())
}

#[cfg(not(windows))]
fn ocr_impl() -> Result<String, String> {
    Err("OCR supportato solo su Windows".into())
}

// ---------------------------------------------------------------- url, media, oauth

/// Apre un URL o un URI (https://, spotify:) con l'app predefinita di Windows.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let l = url.to_ascii_lowercase();
    let ok = [
        "https://",
        "http://127.0.0.1",
        "http://localhost",
        "spotify:",
        "swiftfree:",
        "tel:",
        "whatsapp:",
        "mailto:",
        "steam:",
        "discord:",
        "ms-settings:",
    ]
    .iter()
    .any(|p| l.starts_with(p));
    if !ok || url.contains('"') {
        return Err("schema URL non consentito".into());
    }
    shell_open(&url)
}

#[cfg(windows)]
#[link(name = "shell32")]
extern "system" {
    fn ShellExecuteW(
        hwnd: isize,
        op: *const u16,
        file: *const u16,
        params: *const u16,
        dir: *const u16,
        show: i32,
    ) -> isize;
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Apre URL, percorsi, AppID (shell:AppsFolder\...) o nomi registrati in "App Paths"
/// con ShellExecute: niente problemi di virgolette/spazi/% come con rundll32 o explorer.
fn shell_open(target: &str) -> Result<(), String> {
    #[cfg(windows)]
    unsafe {
        let op = wide("open");
        let f = wide(target);
        let r = ShellExecuteW(
            0,
            op.as_ptr(),
            f.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
        );
        if r <= 32 {
            return Err(format!("ShellExecute {r}: {target}"));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// Crea una cartella (e le cartelle padre) se manca.
#[tauri::command]
fn ensure_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// Apre una cartella (creandola se manca), es. la cartella dei clip.
#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    }
    shell_open(&path)
}

#[cfg(windows)]
#[link(name = "user32")]
extern "system" {
    fn keybd_event(b_vk: u8, b_scan: u8, dw_flags: u32, dw_extra_info: usize);
}

/// Tasti multimediali di sistema (funzionano con Spotify anche senza Premium).
#[tauri::command]
fn media_key(key: String) -> Result<(), String> {
    let vk: u8 = match key.as_str() {
        "next" => 0xB0,
        "prev" => 0xB1,
        "stop" => 0xB2,
        "play_pause" => 0xB3,
        "mute" => 0xAD,
        "vol_down" => 0xAE,
        "vol_up" => 0xAF,
        _ => return Err("tasto sconosciuto".into()),
    };
    #[cfg(windows)]
    unsafe {
        keybd_event(vk, 0, 0, 0);
        keybd_event(vk, 0, 2, 0);
    }
    #[cfg(not(windows))]
    let _ = vk;
    Ok(())
}

/// Aspetta un solo redirect OAuth su 127.0.0.1:<port> e ritorna la query string.
#[tauri::command]
async fn oauth_listen(port: u16, timeout_sec: u64) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::{BufRead, BufReader};
        use std::net::TcpListener;
        let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|e| format!("porta {port} occupata: {e}"))?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let deadline = std::time::Instant::now() + Duration::from_secs(timeout_sec.max(10));
        loop {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = stream.set_nonblocking(false);
                    let mut line = String::new();
                    {
                        let mut r = BufReader::new(&stream);
                        r.read_line(&mut line).map_err(|e| e.to_string())?;
                    }
                    // "GET /callback?code=...&state=... HTTP/1.1"
                    let path = line.split_whitespace().nth(1).unwrap_or("").to_string();
                    if !path.starts_with("/callback") {
                        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
                        continue;
                    }
                    let body = "<html><body style=\"background:#0a0a0f;color:#fcee0a;font-family:monospace;padding:40px\"><h2>CYBER AI // LINK OK</h2><p style=\"color:#00f0ff\">Spotify collegato. Puoi chiudere questa scheda.</p></body></html>";
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = stream.write_all(resp.as_bytes());
                    return Ok(path.split_once('?').map(|(_, q)| q.to_string()).unwrap_or_default());
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    if std::time::Instant::now() > deadline {
                        return Err("login Spotify scaduto".into());
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(e) => return Err(e.to_string()),
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------- desktop pet

#[tauri::command]
fn pet_windows(window: tauri::Window) -> Vec<pet::PetWin> {
    pet::windows(pet::frame_of(&window))
}

#[tauri::command]
fn pet_desk(window: tauri::Window) -> pet::DeskInfo {
    pet::desk(pet::frame_of(&window))
}

#[tauri::command]
fn pet_signals() -> pet::Signals {
    pet::signals()
}

#[tauri::command]
async fn pet_window_action(hwnd: i64, action: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || pet::window_action(hwnd, &action))
        .await
        .map_err(|e| e.to_string())?
}

/// Avvio con Windows (HKCU\...\Run). `on` = None legge soltanto lo stato.
#[tauri::command]
async fn autostart(on: Option<bool>) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        const KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
        let run = |args: &[&str]| -> bool {
            let mut cmd = Command::new("reg");
            cmd.args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
            hide_window(&mut cmd);
            cmd.status().map(|s| s.success()).unwrap_or(false)
        };
        match on {
            Some(true) => {
                let exe = std::env::current_exe().map_err(|e| e.to_string())?;
                let val = format!("\"{}\"", exe.display());
                if !run(&["add", KEY, "/v", "CyberAI", "/t", "REG_SZ", "/d", &val, "/f"]) {
                    return Err("registro non scrivibile".into());
                }
                Ok(true)
            }
            Some(false) => {
                run(&["delete", KEY, "/v", "CyberAI", "/f"]);
                Ok(false)
            }
            None => Ok(run(&["query", KEY, "/v", "CyberAI"])),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Primo video dei risultati di YouTube (id), come le "errands" di notme71/Capri-Desktop.
#[tauri::command]
async fn yt_first(query: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let q: String = query
            .chars()
            .map(|c| if c.is_alphanumeric() { c.to_string() } else if c == ' ' { "+".into() } else { format!("%{:02X}", c as u32 & 0xFF) })
            .collect();
        let url = format!("https://www.youtube.com/results?search_query={q}&hl=en");
        let script = format!(
            "$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; (Invoke-WebRequest -UseBasicParsing -Uri '{}' -Headers @{{Cookie='SOCS=CAI'; 'Accept-Language'='en-US,en;q=0.9'}} -UserAgent 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' -TimeoutSec 12).Content",
            url.replace('\'', "''")
        );
        let mut cmd = Command::new("powershell.exe");
        cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        hide_window(&mut cmd);
        let out = cmd.output().map_err(|e| e.to_string())?;
        let html = String::from_utf8_lossy(&out.stdout);
        let key = "\"videoRenderer\":{\"videoId\":\"";
        Ok(html.find(key).and_then(|i| {
            let id: String = html[i + key.len()..].chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
            if id.len() == 11 { Some(id) } else { None }
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Legge un file dei dati dell'app come byte (sprite del pet: canvas senza "taint").
#[tauri::command]
fn read_bytes(app: AppHandle, path: String) -> Result<tauri::ipc::Response, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let p = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    let b = std::fs::canonicalize(&base).unwrap_or(base);
    if !p.starts_with(&b) {
        return Err("percorso non consentito".into());
    }
    let data = std::fs::read(&p).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(data))
}

/// Nomi dei file in una cartella (non ricorsivo).
#[tauri::command]
fn list_dir(path: String) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(&path)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
                .map(|e| e.file_name().to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}

// ---------------------------------------------------------------- avvio

fn toggle_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("overlay") {
        if w.is_visible().unwrap_or(true) {
            let _ = w.hide();
        } else {
            let _ = w.show();
        }
    }
}

// ---------------------------------------------------------------- clip (tasti rapidi di Medal / AMD / NVIDIA / Game Bar)

/// Codice virtual-key per un nome di tasto ("ctrl", "f10", "s", "win", ...).
fn vk_code(k: &str) -> Option<u8> {
    let k = k.trim().to_ascii_lowercase();
    let v = match k.as_str() {
        "ctrl" | "control" | "ctl" => 0x11,
        "shift" => 0x10,
        "alt" | "menu" => 0x12,
        "win" | "windows" | "meta" | "super" => 0x5B,
        "space" | "spazio" => 0x20,
        "enter" | "return" | "invio" => 0x0D,
        "tab" => 0x09,
        "esc" | "escape" => 0x1B,
        "home" => 0x24,
        "end" => 0x23,
        "insert" | "ins" => 0x2D,
        "delete" | "del" | "canc" => 0x2E,
        "pageup" | "pgup" => 0x21,
        "pagedown" | "pgdn" => 0x22,
        "print" | "printscreen" | "prtsc" | "stamp" => 0x2C,
        "scrolllock" => 0x91,
        "pause" => 0x13,
        "up" => 0x26,
        "down" => 0x28,
        "left" => 0x25,
        "right" => 0x27,
        "numpad0" => 0x60,
        _ => {
            if k.len() == 1 {
                let c = k.as_bytes()[0];
                if c.is_ascii_alphabetic() {
                    return Some(c.to_ascii_uppercase());
                }
                if c.is_ascii_digit() {
                    return Some(c);
                }
                return None;
            }
            if let Some(n) = k.strip_prefix('f').and_then(|n| n.parse::<u8>().ok()) {
                if (1..=24).contains(&n) {
                    return Some(0x6F + n);
                }
            }
            if let Some(n) = k.strip_prefix("numpad").and_then(|n| n.parse::<u8>().ok()) {
                if n <= 9 {
                    return Some(0x60 + n);
                }
            }
            return None;
        }
    };
    Some(v)
}

/// Preme una combinazione di tasti (es. "Ctrl+Shift+S", "Alt+F10", "F8") a livello di sistema.
#[tauri::command]
async fn send_hotkey(combo: String) -> Result<(), String> {
    let keys: Vec<u8> = combo
        .split('+')
        .filter(|x| !x.trim().is_empty())
        .map(|k| vk_code(k).ok_or_else(|| format!("tasto sconosciuto: {k}")))
        .collect::<Result<_, _>>()?;
    if keys.is_empty() {
        return Err("combinazione vuota".into());
    }
    #[cfg(windows)]
    tauri::async_runtime::spawn_blocking(move || unsafe {
        const KEYUP: u32 = 0x0002;
        const EXT: u32 = 0x0001;
        let ext = |vk: u8| {
            if matches!(vk, 0x21..=0x2E | 0x5B) {
                EXT
            } else {
                0
            }
        };
        for &k in &keys {
            keybd_event(k, 0, ext(k), 0);
            std::thread::sleep(std::time::Duration::from_millis(35));
        }
        std::thread::sleep(std::time::Duration::from_millis(60));
        for &k in keys.iter().rev() {
            keybd_event(k, 0, ext(k) | KEYUP, 0);
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    #[cfg(not(windows))]
    let _ = keys;
    Ok(())
}

/// Nomi (minuscoli) dei processi in esecuzione, per capire quale software di clip è attivo.
#[tauri::command]
async fn running_processes() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut cmd = Command::new("tasklist");
        cmd.args(["/FO", "CSV", "/NH"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        hide_window(&mut cmd);
        let out = cmd.output().map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&out.stdout);
        let mut v: Vec<String> = text
            .lines()
            .filter_map(|l| l.split("\",\"").next())
            .map(|n| n.trim_matches('"').to_ascii_lowercase())
            .filter(|n| !n.is_empty())
            .collect();
        v.sort();
        v.dedup();
        Ok(v)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Scarica un file (solo voci Piper da Hugging Face) nel percorso indicato.
#[tauri::command]
async fn download_file(url: String, dest: String) -> Result<(), String> {
    if !url.starts_with("https://huggingface.co/rhasspy/piper-voices/")
        && !url.starts_with("https://github.com/BtbN/FFmpeg-Builds/releases/")
        && !url.starts_with("https://huggingface.co/ggerganov/whisper.cpp/")
        && !url.starts_with("https://raw.githubusercontent.com/lachydotmcg/capri-desktop/")
        && !url.starts_with("https://raw.githubusercontent.com/notme71/Capri-Desktop/")
    {
        return Err("URL non consentito".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let tmp = format!("{dest}.part");
        let script = format!(
            "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri '{}' -OutFile '{}'",
            url.replace('\'', "''"),
            tmp.replace('\'', "''")
        );
        let mut cmd = Command::new("powershell.exe");
        cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        hide_window(&mut cmd);
        let out = cmd.output().map_err(|e| e.to_string())?;
        if !out.status.success() {
            let _ = std::fs::remove_file(&tmp);
            return Err(String::from_utf8_lossy(&out.stderr).chars().take(300).collect());
        }
        std::fs::rename(&tmp, &dest).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------- finestre esterne (Clingy mode)

#[cfg(windows)]
#[repr(C)]
#[derive(Default, Clone, Copy)]
struct WinRect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[cfg(windows)]
#[link(name = "user32")]
extern "system" {
    fn IsWindow(hwnd: isize) -> i32;
    fn IsIconic(hwnd: isize) -> i32;
    fn IsWindowVisible(hwnd: isize) -> i32;
    fn GetWindowRect(hwnd: isize, r: *mut WinRect) -> i32;
    fn GetWindowThreadProcessId(hwnd: isize, pid: *mut u32) -> u32;
}

#[cfg(windows)]
#[link(name = "dwmapi")]
extern "system" {
    fn DwmGetWindowAttribute(hwnd: isize, attr: u32, out: *mut WinRect, size: u32) -> i32;
}

#[derive(serde::Serialize)]
struct ExtWindow {
    hwnd: i64,
    title: String,
    /// rettangolo in coordinate CSS (logiche) dell'overlay
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[cfg(windows)]
fn ext_rect(win: &tauri::Window, hwnd: isize) -> Option<ExtWindow> {
    unsafe {
        if hwnd == 0 || IsWindow(hwnd) == 0 || IsIconic(hwnd) != 0 || IsWindowVisible(hwnd) == 0 {
            return None;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == std::process::id() {
            return None;
        }
        let mut r = WinRect::default();
        // DWMWA_EXTENDED_FRAME_BOUNDS = 9: bordi visibili, senza l'ombra invisibile di Windows 10/11
        if DwmGetWindowAttribute(hwnd, 9, &mut r, std::mem::size_of::<WinRect>() as u32) != 0 {
            GetWindowRect(hwnd, &mut r);
        }
        let sf = win.scale_factor().unwrap_or(1.0);
        let (ox, oy) = win.outer_position().map(|p| (p.x, p.y)).unwrap_or((0, 0));
        let mut buf = [0u16; 256];
        let n = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        Some(ExtWindow {
            hwnd: hwnd as i64,
            title: if n > 0 {
                String::from_utf16_lossy(&buf[..n as usize])
            } else {
                String::new()
            },
            x: (r.left - ox) as f64 / sf,
            y: (r.top - oy) as f64 / sf,
            w: (r.right - r.left) as f64 / sf,
            h: (r.bottom - r.top) as f64 / sf,
        })
    }
}

/// Finestra in primo piano (se non è Capri stessa).
#[tauri::command]
fn foreground_window(window: tauri::Window) -> Option<ExtWindow> {
    #[cfg(windows)]
    unsafe {
        return ext_rect(&window, GetForegroundWindow());
    }
    #[allow(unreachable_code)]
    {
        let _ = window;
        None
    }
}

/// Posizione attuale di una finestra (null se chiusa o ridotta a icona).
#[tauri::command]
fn window_rect(window: tauri::Window, hwnd: i64) -> Option<ExtWindow> {
    #[cfg(windows)]
    {
        return ext_rect(&window, hwnd as isize);
    }
    #[allow(unreachable_code)]
    {
        let _ = (window, hwnd);
        None
    }
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

// ---------------------------------------------------------------- instant replay (ffmpeg)

/// Prova gli encoder H.264 (hardware prima) e ritorna il primo che funziona davvero.
#[tauri::command]
async fn replay_probe(ffmpeg: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        for enc in ["h264_amf", "h264_nvenc", "h264_qsv", "libx264"] {
            let mut cmd = Command::new(&ffmpeg);
            cmd.args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=320x240:r=30",
                "-frames:v",
                "5",
                "-pix_fmt",
                "yuv420p",
                "-c:v",
                enc,
                "-f",
                "null",
                "-",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
            hide_window(&mut cmd);
            if let Ok(st) = cmd.status() {
                if st.success() {
                    return Ok(enc.to_string());
                }
            }
        }
        Err("ffmpeg non trovato o nessun encoder H.264 funzionante".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Dispositivi audio DirectShow (per registrare anche l'audio, es. "Stereo Mix").
#[tauri::command]
async fn replay_audio_devices(ffmpeg: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(&ffmpeg);
        cmd.args([
            "-hide_banner",
            "-list_devices",
            "true",
            "-f",
            "dshow",
            "-i",
            "dummy",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
        hide_window(&mut cmd);
        let out = cmd.output().map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&out.stderr);
        Ok(text
            .lines()
            .filter(|l| l.contains("(audio)"))
            .filter_map(|l| l.split('"').nth(1).map(|x| x.to_string()))
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Salva gli ultimi `seconds` secondi del buffer (segmenti .ts) in un .mp4.
#[tauri::command]
async fn replay_save(
    ffmpeg: String,
    buf_dir: String,
    out_file: String,
    seconds: u32,
    seg_sec: u32,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut segs: Vec<(SystemTime, PathBuf)> = std::fs::read_dir(&buf_dir)
            .map_err(|e| format!("buffer replay: {e}"))?
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().map(|x| x == "ts").unwrap_or(false))
            .filter_map(|p| {
                std::fs::metadata(&p)
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .map(|t| (t, p))
            })
            .collect();
        if segs.is_empty() {
            return Err("buffer vuoto: l'instant replay è attivo da pochi secondi?".into());
        }
        segs.sort_by_key(|(t, _)| *t);
        let need = (seconds / seg_sec.max(1) + 1) as usize;
        let take: Vec<&PathBuf> = segs
            .iter()
            .rev()
            .take(need)
            .map(|(_, p)| p)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        if let Some(dir) = PathBuf::from(&out_file).parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let list = PathBuf::from(&buf_dir).join("concat.txt");
        let body: String = take
            .iter()
            .map(|p| {
                format!(
                    "file '{}'\n",
                    p.to_string_lossy()
                        .replace('\\', "/")
                        .replace('\'', "'\\''")
                )
            })
            .collect();
        std::fs::write(&list, body).map_err(|e| e.to_string())?;
        let mut cmd = Command::new(&ffmpeg);
        cmd.args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
        ])
        .arg(&list)
        .args(["-c", "copy", "-movflags", "+faststart"])
        .arg(&out_file)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
        hide_window(&mut cmd);
        let out = cmd.output().map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr)
                .chars()
                .take(300)
                .collect());
        }
        Ok(out_file)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Cartella predefinita dei clip: Video\Capri Clips.
#[tauri::command]
fn default_clips_dir() -> String {
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".into());
    PathBuf::from(home)
        .join("Videos")
        .join("Capri Clips")
        .to_string_lossy()
        .to_string()
}

/// Estrae uno zip (ffmpeg scaricato) con PowerShell.
#[tauri::command]
async fn unzip_file(zip: String, dest: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let script = format!(
            "Expand-Archive -Force -LiteralPath '{}' -DestinationPath '{}'",
            zip.replace('\'', "''"),
            dest.replace('\'', "''")
        );
        let mut cmd = Command::new("powershell.exe");
        cmd.args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
        hide_window(&mut cmd);
        let out = cmd.output().map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr)
                .chars()
                .take(300)
                .collect());
        }
        let _ = std::fs::remove_file(&zip);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------- lingua menu tray

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetUserDefaultUILanguage() -> u16;
}

/// true se la lingua dell'interfaccia di Windows è l'italiano (LANG_ITALIAN = 0x10).
fn os_is_italian() -> bool {
    #[cfg(windows)]
    unsafe {
        return (GetUserDefaultUILanguage() & 0x3ff) == 0x10;
    }
    #[allow(unreachable_code)]
    true
}

fn tray_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>, it: bool) -> tauri::Result<Menu<R>> {
    let l = |a: &'static str, b: &'static str| if it { a } else { b };
    let toggle = MenuItem::with_id(
        app,
        "toggle",
        l("Mostra / Nascondi", "Show / Hide"),
        true,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(
        app,
        "settings",
        l("Impostazioni", "Settings"),
        true,
        None::<&str>,
    )?;
    let interact = MenuItem::with_id(
        app,
        "interact",
        l("Blocca/Sblocca interazione", "Lock/Unlock interaction"),
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", l("Esci", "Quit"), true, None::<&str>)?;
    Menu::with_items(app, &[&toggle, &settings, &interact, &quit])
}

/// Aggiorna le voci del menu tray quando l'utente cambia lingua.
#[tauri::command]
fn set_tray_lang(app: tauri::AppHandle, lang: String) -> Result<(), String> {
    let menu = tray_menu(&app, !lang.starts_with("en")).map_err(|e| e.to_string())?;
    if let Some(t) = app.tray_by_id("main") {
        t.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn run() {
    let shared: AppState = Arc::new(Shared::default());
    let setup_state = shared.clone();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(shared.clone())
        .setup(move |app| {
            if let Some(win) = app.get_webview_window("overlay") {
                fit_to_monitor(&win);
                let _ = win.set_always_on_top(true);
                spawn_hit_test(win, setup_state.clone());
            }

            let menu = tray_menu(app.handle(), os_is_italian())?;

            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("Cyber AI")
                .menu(&menu);
            if let Some(icon) = app.default_window_icon().cloned() {
                tray = tray.icon(icon);
            }
            tray.on_menu_event(|app, event| match event.id().as_ref() {
                "toggle" => toggle_window(app),
                "settings" => {
                    if let Some(w) = app.get_webview_window("overlay") {
                        let _ = w.show();
                    }
                    let _ = app.emit("tray", "settings");
                }
                "interact" => {
                    let _ = app.emit("tray", "interact");
                }
                "quit" => {
                    if let Some(s) = app.try_state::<AppState>() {
                        kill_all(&s);
                    }
                    app.exit(0);
                }
                _ => {}
            })
            .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pet_windows,
            yt_first,
            pet_desk,
            pet_signals,
            pet_window_action,
            autostart,
            read_bytes,
            list_dir,
            set_tray_lang,
            open_path,
            ensure_dir,
            foreground_window,
            window_rect,
            quit_app,
            replay_probe,
            replay_audio_devices,
            replay_save,
            default_clips_dir,
            unzip_file,
            send_hotkey,
            running_processes,
            download_file,
            set_hit_rects,
            set_interactive,
            capture_screen,
            piper_tts,
            start_service,
            stop_service,
            service_running,
            import_file,
            delete_file,
            data_dir,
            tools_dir,
            path_exists,
            open_url,
            media_key,
            oauth_listen,
            list_apps,
            open_app,
            foreground_title,
            ocr_screen
        ])
        .build(tauri::generate_context!())
        .expect("errore avvio Cyber AI");

    app.run(move |_app, event| {
        if let RunEvent::Exit = event {
            kill_all(&shared);
        }
    });
}

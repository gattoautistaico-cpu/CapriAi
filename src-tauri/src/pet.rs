//! Modalità "desktop pet" autonoma: finestre su cui sedersi, area di lavoro,
//! segnali di sistema (inattività, batteria, CPU), azioni sulle finestre, avvio con Windows.
//!
//! La logica dei "ledge" (bordi delle finestre scoperti) riprende Perches/Desk di
//! lachydotmcg/capri-desktop (PolyForm Noncommercial 1.0.0, Copyright 2026 Lachy),
//! qui riscritta in Rust per l'overlay Tauri.
#![allow(clashing_extern_declarations)]

use serde::Serialize;
#[cfg(windows)]
use std::sync::Mutex;

/// Finestra visibile (coordinate logiche dell'overlay, ordine z: la prima è in cima).
#[derive(Serialize, Clone, Debug)]
pub struct PetWin {
    pub hwnd: i64,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    /// ci si può sedere sopra (non massimizzata, non tool window, abbastanza grande)
    pub seat: bool,
    /// copre ciò che c'è sotto (finestra "vera" con barra del titolo)
    pub solid: bool,
    pub max: bool,
    pub title: String,
    pub exe: String,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct Area {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct DeskInfo {
    /// area di lavoro (senza taskbar) del monitor principale
    pub work: Area,
    /// monitor principale
    pub screen: Area,
    /// un'app a schermo intero (gioco, video) è in primo piano
    pub fullscreen: bool,
    pub fg: i64,
    pub fg_title: String,
    pub fg_exe: String,
    pub cursor_x: f64,
    pub cursor_y: f64,
    /// ms dall'ultimo input di tastiera/mouse
    pub idle_ms: u64,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct Signals {
    /// percentuale batteria (-1 = nessuna batteria)
    pub battery: i32,
    pub charging: bool,
    /// uso CPU 0-100 dall'ultima chiamata
    pub cpu: f64,
}

// ---------------------------------------------------------------- Win32

#[cfg(windows)]
mod ffi {
    use std::ffi::c_void;
    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    pub struct Rc {
        pub left: i32,
        pub top: i32,
        pub right: i32,
        pub bottom: i32,
    }
    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    pub struct Pt {
        pub x: i32,
        pub y: i32,
    }
    #[repr(C)]
    pub struct LastInput {
        pub size: u32,
        pub time: u32,
    }
    #[repr(C)]
    #[derive(Default)]
    pub struct Power {
        pub ac: u8,
        pub flag: u8,
        pub percent: u8,
        pub saver: u8,
        pub life: u32,
        pub full: u32,
    }
    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    pub struct FileTime {
        pub lo: u32,
        pub hi: u32,
    }
    pub type EnumProc = unsafe extern "system" fn(isize, isize) -> i32;

    #[link(name = "user32")]
    extern "system" {
        pub fn EnumWindows(f: EnumProc, l: isize) -> i32;
        pub fn IsWindow(h: isize) -> i32;
        pub fn IsWindowVisible(h: isize) -> i32;
        pub fn IsIconic(h: isize) -> i32;
        pub fn IsZoomed(h: isize) -> i32;
        pub fn GetWindowRect(h: isize, r: *mut Rc) -> i32;
        pub fn GetWindowLongW(h: isize, i: i32) -> i32;
        pub fn GetClassNameW(h: isize, b: *mut u16, n: i32) -> i32;
        pub fn GetWindowTextW(h: isize, b: *mut u16, n: i32) -> i32;
        pub fn GetWindowThreadProcessId(h: isize, pid: *mut u32) -> u32;
        pub fn GetForegroundWindow() -> isize;
        pub fn SetForegroundWindow(h: isize) -> i32;
        pub fn ShowWindow(h: isize, cmd: i32) -> i32;
        pub fn PostMessageW(h: isize, msg: u32, w: usize, l: isize) -> i32;
        pub fn GetCursorPos(p: *mut Pt) -> i32;
        pub fn GetLastInputInfo(p: *mut LastInput) -> i32;
        pub fn SystemParametersInfoW(a: u32, b: u32, c: *mut c_void, d: u32) -> i32;
        pub fn GetSystemMetrics(i: i32) -> i32;
        pub fn GetShellWindow() -> isize;
        pub fn GetDesktopWindow() -> isize;
        pub fn keybd_event(vk: u8, scan: u8, flags: u32, extra: usize);
    }
    #[link(name = "dwmapi")]
    extern "system" {
        pub fn DwmGetWindowAttribute(h: isize, attr: u32, out: *mut c_void, size: u32) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        pub fn GetTickCount() -> u32;
        pub fn GetSystemPowerStatus(p: *mut Power) -> i32;
        pub fn GetSystemTimes(idle: *mut FileTime, kernel: *mut FileTime, user: *mut FileTime) -> i32;
        pub fn GetCurrentProcessId() -> u32;
        pub fn OpenProcess(access: u32, inherit: i32, pid: u32) -> isize;
        pub fn QueryFullProcessImageNameW(h: isize, flags: u32, buf: *mut u16, size: *mut u32) -> i32;
        pub fn CloseHandle(h: isize) -> i32;
    }
}

#[cfg(windows)]
const SHELL: &[&str] = &[
    "Progman",
    "WorkerW",
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
    "#32768",
    "tooltips_class32",
    "Windows.UI.Core.CoreWindow",
    "ForegroundStaging",
    "XamlExplorerHostIslandWindow",
];

#[cfg(windows)]
fn wstr(buf: &[u16], n: i32) -> String {
    if n <= 0 {
        String::new()
    } else {
        String::from_utf16_lossy(&buf[..(n as usize).min(buf.len())])
    }
}

#[cfg(windows)]
fn class_of(h: isize) -> String {
    let mut b = [0u16; 128];
    let n = unsafe { ffi::GetClassNameW(h, b.as_mut_ptr(), b.len() as i32) };
    wstr(&b, n)
}

#[cfg(windows)]
fn title_of(h: isize) -> String {
    let mut b = [0u16; 256];
    let n = unsafe { ffi::GetWindowTextW(h, b.as_mut_ptr(), b.len() as i32) };
    wstr(&b, n)
}

#[cfg(windows)]
fn exe_of_pid(pid: u32) -> String {
    unsafe {
        let h = ffi::OpenProcess(0x1000, 0, pid);
        if h == 0 {
            return String::new();
        }
        let mut b = [0u16; 520];
        let mut n = b.len() as u32;
        let ok = ffi::QueryFullProcessImageNameW(h, 0, b.as_mut_ptr(), &mut n);
        ffi::CloseHandle(h);
        if ok == 0 {
            return String::new();
        }
        let full = String::from_utf16_lossy(&b[..n as usize]);
        full.rsplit(['\\', '/']).next().unwrap_or("").to_ascii_lowercase()
    }
}

#[cfg(windows)]
fn bounds(h: isize) -> Option<ffi::Rc> {
    let mut r = ffi::Rc::default();
    unsafe {
        // DWMWA_EXTENDED_FRAME_BOUNDS: bordo visibile, senza l'ombra invisibile
        if ffi::DwmGetWindowAttribute(h, 9, &mut r as *mut _ as *mut _, 16) != 0 && ffi::GetWindowRect(h, &mut r) == 0 {
            return None;
        }
    }
    if r.right - r.left <= 0 || r.bottom - r.top <= 0 {
        None
    } else {
        Some(r)
    }
}

/// Origine (fisica) e scala dell'overlay: per convertire in coordinate CSS.
#[derive(Clone, Copy)]
pub struct Frame {
    pub ox: f64,
    pub oy: f64,
    pub sf: f64,
}

pub fn frame_of(win: &tauri::Window) -> Frame {
    let sf = win.scale_factor().unwrap_or(1.0);
    let (ox, oy) = win.outer_position().map(|p| (p.x as f64, p.y as f64)).unwrap_or((0.0, 0.0));
    Frame { ox, oy, sf }
}

#[cfg(windows)]
fn screen_rect() -> ffi::Rc {
    unsafe {
        ffi::Rc {
            left: 0,
            top: 0,
            right: ffi::GetSystemMetrics(0),
            bottom: ffi::GetSystemMetrics(1),
        }
    }
}

#[cfg(windows)]
fn look(h: isize, own: u32, scr: &ffi::Rc, f: Frame) -> Option<PetWin> {
    unsafe {
        if ffi::IsWindow(h) == 0 || ffi::IsWindowVisible(h) == 0 || ffi::IsIconic(h) != 0 {
            return None;
        }
        let mut cloaked: i32 = 0;
        if ffi::DwmGetWindowAttribute(h, 14, &mut cloaked as *mut _ as *mut _, 4) == 0 && cloaked != 0 {
            return None;
        }
        let ex = ffi::GetWindowLongW(h, -20);
        // WS_EX_TRANSPARENT, oppure layered + noactivate (overlay di altre app)
        if ex & 0x20 != 0 || ex & 0x0808_0000 == 0x0808_0000 {
            return None;
        }
        let mut pid = 0u32;
        ffi::GetWindowThreadProcessId(h, &mut pid);
        if pid == own {
            return None;
        }
        let class = class_of(h);
        if SHELL.iter().any(|s| *s == class) {
            return None;
        }
        let r = bounds(h)?;
        let (w, hh) = (r.right - r.left, r.bottom - r.top);
        let tool = ex & 0x80 != 0 && ex & 0x40000 == 0;
        let style = GetStyle(h);
        let big = w >= 120 && hh >= 60;
        let fills = r.left <= scr.left && r.top <= scr.top && r.right >= scr.right && r.bottom >= scr.bottom;
        let zoomed = ffi::IsZoomed(h) != 0;
        Some(PetWin {
            hwnd: h as i64,
            x: (r.left as f64 - f.ox) / f.sf,
            y: (r.top as f64 - f.oy) / f.sf,
            w: w as f64 / f.sf,
            h: hh as f64 / f.sf,
            seat: big && !tool && !zoomed && !fills,
            solid: big && !tool && style & 0x00C0_0000 == 0x00C0_0000,
            max: zoomed || fills,
            title: title_of(h),
            exe: exe_of_pid(pid),
        })
    }
}

#[cfg(windows)]
#[allow(non_snake_case)]
fn GetStyle(h: isize) -> i32 {
    unsafe { ffi::GetWindowLongW(h, -16) }
}

#[cfg(windows)]
struct Collect {
    out: Vec<PetWin>,
    own: u32,
    scr: ffi::Rc,
    f: Frame,
}

#[cfg(windows)]
unsafe extern "system" fn visit(h: isize, l: isize) -> i32 {
    let c = &mut *(l as *mut Collect);
    if let Some(w) = look(h, c.own, &c.scr, c.f) {
        c.out.push(w);
    }
    1
}

/// Finestre visibili dall'alto in basso.
pub fn windows(f: Frame) -> Vec<PetWin> {
    #[cfg(windows)]
    unsafe {
        let mut c = Collect {
            out: Vec::new(),
            own: ffi::GetCurrentProcessId(),
            scr: screen_rect(),
            f,
        };
        ffi::EnumWindows(visit, &mut c as *mut Collect as isize);
        return c.out;
    }
    #[allow(unreachable_code)]
    {
        let _ = f;
        Vec::new()
    }
}

pub fn desk(f: Frame) -> DeskInfo {
    #[cfg(windows)]
    unsafe {
        let mut d = DeskInfo::default();
        let scr = screen_rect();
        d.screen = Area {
            x: (scr.left as f64 - f.ox) / f.sf,
            y: (scr.top as f64 - f.oy) / f.sf,
            w: (scr.right - scr.left) as f64 / f.sf,
            h: (scr.bottom - scr.top) as f64 / f.sf,
        };
        let mut wa = ffi::Rc::default();
        // SPI_GETWORKAREA
        if ffi::SystemParametersInfoW(0x0030, 0, &mut wa as *mut _ as *mut _, 0) != 0 {
            d.work = Area {
                x: (wa.left as f64 - f.ox) / f.sf,
                y: (wa.top as f64 - f.oy) / f.sf,
                w: (wa.right - wa.left) as f64 / f.sf,
                h: (wa.bottom - wa.top) as f64 / f.sf,
            };
        } else {
            d.work = d.screen.clone();
        }
        let fg = ffi::GetForegroundWindow();
        d.fg = fg as i64;
        if fg != 0 && fg != ffi::GetShellWindow() && fg != ffi::GetDesktopWindow() {
            let mut pid = 0u32;
            ffi::GetWindowThreadProcessId(fg, &mut pid);
            let class = class_of(fg);
            if pid != ffi::GetCurrentProcessId() && !SHELL.iter().any(|s| *s == class) {
                d.fg_title = title_of(fg);
                d.fg_exe = exe_of_pid(pid);
                if let Some(r) = bounds(fg) {
                    d.fullscreen = r.left <= scr.left && r.top <= scr.top && r.right >= scr.right && r.bottom >= scr.bottom;
                }
            }
        }
        let mut p = ffi::Pt::default();
        if ffi::GetCursorPos(&mut p) != 0 {
            d.cursor_x = (p.x as f64 - f.ox) / f.sf;
            d.cursor_y = (p.y as f64 - f.oy) / f.sf;
        }
        let mut li = ffi::LastInput { size: 8, time: 0 };
        if ffi::GetLastInputInfo(&mut li) != 0 {
            d.idle_ms = ffi::GetTickCount().wrapping_sub(li.time) as u64;
        }
        return d;
    }
    #[allow(unreachable_code)]
    {
        let _ = f;
        DeskInfo::default()
    }
}

#[cfg(windows)]
static CPU_LAST: Mutex<Option<(u64, u64)>> = Mutex::new(None);

pub fn signals() -> Signals {
    #[cfg(windows)]
    unsafe {
        let mut s = Signals { battery: -1, ..Default::default() };
        let mut p = ffi::Power::default();
        if ffi::GetSystemPowerStatus(&mut p) != 0 && p.flag != 128 && p.flag != 255 && p.percent <= 100 {
            s.battery = p.percent as i32;
            s.charging = p.ac == 1;
        }
        let (mut i, mut k, mut u) = (ffi::FileTime::default(), ffi::FileTime::default(), ffi::FileTime::default());
        if ffi::GetSystemTimes(&mut i, &mut k, &mut u) != 0 {
            let q = |t: ffi::FileTime| ((t.hi as u64) << 32) | t.lo as u64;
            let idle = q(i);
            let total = q(k) + q(u); // il tempo kernel include l'idle
            if let Ok(mut last) = CPU_LAST.lock() {
                if let Some((li, lt)) = *last {
                    let dt = total.saturating_sub(lt);
                    let di = idle.saturating_sub(li);
                    if dt > 0 {
                        s.cpu = (100.0 * (1.0 - di as f64 / dt as f64)).clamp(0.0, 100.0);
                    }
                }
                *last = Some((idle, total));
            }
        }
        return s;
    }
    #[allow(unreachable_code)]
    Signals { battery: -1, ..Default::default() }
}

/// switch_to / minimize / maximize / restore / close.
pub fn window_action(hwnd: i64, action: &str) -> Result<(), String> {
    #[cfg(windows)]
    unsafe {
        let h = hwnd as isize;
        if ffi::IsWindow(h) == 0 {
            return Err("finestra chiusa".into());
        }
        match action {
            "switch_to" => {
                if ffi::IsIconic(h) != 0 {
                    ffi::ShowWindow(h, 9);
                }
                // un ALT "fantasma" sblocca SetForegroundWindow quando non siamo in primo piano
                ffi::keybd_event(0x12, 0, 0, 0);
                ffi::keybd_event(0x12, 0, 2, 0);
                ffi::SetForegroundWindow(h);
            }
            "minimize" => {
                ffi::ShowWindow(h, 6);
            }
            "maximize" => {
                ffi::ShowWindow(h, 3);
            }
            "restore" => {
                ffi::ShowWindow(h, 9);
            }
            "close" => {
                ffi::PostMessageW(h, 0x0010, 0, 0);
            }
            "close_tab" => {
                ffi::keybd_event(0x12, 0, 0, 0);
                ffi::keybd_event(0x12, 0, 2, 0);
                ffi::SetForegroundWindow(h);
                std::thread::sleep(std::time::Duration::from_millis(120));
                ffi::keybd_event(0x11, 0, 0, 0);
                ffi::keybd_event(0x57, 0, 0, 0);
                ffi::keybd_event(0x57, 0, 2, 0);
                ffi::keybd_event(0x11, 0, 2, 0);
            }
            _ => return Err(format!("azione sconosciuta: {action}")),
        }
        return Ok(());
    }
    #[allow(unreachable_code)]
    {
        let _ = (hwnd, action);
        Err("solo Windows".into())
    }
}

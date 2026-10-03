//! The desktop shell (DESIGN.md §12): the web app in a WebView2 window, plus the few things a browser can't do.
//! Reading and writing files by path, listing folders, finding the presets and examples folders, the autosave file,
//! and watching loaded pictures so a sheet saved in the art app reloads by itself. Dialogs and opening links come from
//! the dialog and opener plugins.
//!
//! The program is portable: what it keeps between runs (the autosave and WebView2's own data) lives in a `settings`
//! folder next to the exe, so the whole folder can be moved or copied. Only when that folder can't be written (say,
//! the exe sits in Program Files) does it fall back to `%APPDATA%\com.reactorcore.pixelto3d\`.

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

fn err(path: &Path, e: std::io::Error) -> String {
    format!("{}: {}", path.display(), e)
}

/// A whole file as bytes (an ArrayBuffer on the JS side).
#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    fs::read(&path).map(Response::new).map_err(|e| err(Path::new(&path), e))
}

/// `%XX` escapes back to text (the path travels in a header, which must be ASCII).
fn percent_decode(s: &str) -> Result<String, String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = std::str::from_utf8(&b[i + 1..i + 3]).map_err(|e| e.to_string())?;
            out.push(u8::from_str_radix(hex, 16).map_err(|e| e.to_string())?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|e| e.to_string())
}

/// Writes through a temporary file next to the target and then swaps it in, so a crash or a full disk never leaves
/// a half-written session or sheet behind. Missing folders are created.
fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| err(dir, e))?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".p3d-tmp");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, data).map_err(|e| err(&tmp, e))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        err(path, e)
    })
}

/// Raw bytes in the request body; the path, URI-encoded, in the `path` header.
#[tauri::command]
fn write_file(request: Request) -> Result<(), String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err("write_file expects raw bytes".into());
    };
    let path = request
        .headers()
        .get("path")
        .and_then(|v| v.to_str().ok())
        .ok_or("write_file needs a path header")?;
    write_atomic(Path::new(&percent_decode(path)?), data)
}

/// Moves a sheet that ① is remaking into a `replaced` folder next to it, so nothing is ever thrown away. A name already
/// taken there gets " (2)", " (3)"... Returns the new path.
#[tauri::command]
fn move_aside(path: String) -> Result<String, String> {
    let from = Path::new(&path);
    let dir = from.parent().ok_or("no folder")?.join("replaced");
    fs::create_dir_all(&dir).map_err(|e| err(&dir, e))?;
    let stem = from.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = from.extension().map(|s| format!(".{}", s.to_string_lossy())).unwrap_or_default();
    let mut to = dir.join(format!("{stem}{ext}"));
    let mut k = 2;
    while to.exists() {
        to = dir.join(format!("{stem} ({k}){ext}"));
        k += 1;
    }
    fs::rename(from, &to).map_err(|e| err(from, e))?;
    Ok(to.to_string_lossy().into_owned())
}

#[derive(Serialize)]
struct Entry {
    name: String,
    dir: bool,
}

/// The files and folders directly inside a folder.
#[tauri::command]
fn list_dir(path: String) -> Result<Vec<Entry>, String> {
    let rd = fs::read_dir(&path).map_err(|e| err(Path::new(&path), e))?;
    Ok(rd
        .flatten()
        .map(|e| Entry {
            name: e.file_name().to_string_lossy().into_owned(),
            dir: e.file_type().map(|t| t.is_dir()).unwrap_or(false),
        })
        .collect())
}

/// "file", "dir" or "missing" for each path (for dropped items and command-line arguments).
#[tauri::command]
fn path_kinds(paths: Vec<String>) -> Vec<&'static str> {
    paths
        .iter()
        .map(|p| match fs::metadata(p) {
            Ok(m) if m.is_dir() => "dir",
            Ok(_) => "file",
            Err(_) => "missing",
        })
        .collect()
}

fn exe_dir() -> Option<PathBuf> {
    // A dev build acts as if it sat in its own project's src-tauri/target/debug/, so it finds the project's folders
    // and keeps its own settings even when cargo builds into a shared folder (target-dir in ~/.cargo/config.toml).
    if cfg!(debug_assertions) {
        return Some(Path::new(env!("CARGO_MANIFEST_DIR")).join("target").join("debug"));
    }
    std::env::current_exe().ok()?.parent().map(Path::to_path_buf)
}

/// A folder that ships next to the exe: found there, or in a folder above it (while developing, the exe sits in
/// `src-tauri/target/debug/` and the project's own folders are used).
fn find_beside(name: &str, ok: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    let dir = exe_dir()?;
    dir.ancestors().take(5).map(|d| d.join(name)).find(|p| ok(p))
}

fn find_presets() -> Option<PathBuf> {
    find_beside("presets", |p| p.join("sprite-sets").is_dir())
}

const EXAMPLE_SESSION: &str = "Example session.p3d.json";

/// The example session the app opens on its very first start, from the `examples/` folder.
#[tauri::command]
fn example_session() -> Option<String> {
    find_beside("examples", |p| p.join(EXAMPLE_SESSION).is_file()).map(|p| p.join(EXAMPLE_SESSION).to_string_lossy().into_owned())
}

/// A page of the guide (`user-guide.html`, `paint-a-sheet.html`): in the `guide/` folder next to the exe, or
/// `public/guide/` while developing. Only plain `.html` file names are looked up.
#[tauri::command]
fn guide_path(page: String) -> Option<String> {
    let plain = page.ends_with(".html") && !page.contains(['/', '\\', ':']) && !page.contains("..");
    if !plain {
        return None;
    }
    find_beside("guide", |p| p.join(&page).is_file())
        .or_else(|| find_beside("public", |p| p.join("guide").join(&page).is_file()).map(|p| p.join("guide")))
        .map(|p| p.join(&page).to_string_lossy().into_owned())
}

#[tauri::command]
fn presets_dir() -> Option<String> {
    find_presets().map(|p| p.to_string_lossy().into_owned())
}

/// Removes one of the user's own preset files. Only `.json` files inside the presets folder can be removed.
#[tauri::command]
fn remove_preset(path: String) -> Result<(), String> {
    let root = find_presets().and_then(|p| p.canonicalize().ok()).ok_or("no presets folder")?;
    let file = Path::new(&path).canonicalize().map_err(|e| err(Path::new(&path), e))?;
    let json = file.extension().map(|x| x.eq_ignore_ascii_case("json")).unwrap_or(false);
    if !json || !file.starts_with(&root) {
        return Err(format!("{path} isn't a preset file"));
    }
    fs::remove_file(&file).map_err(|e| err(&file, e))
}

/// The folder for what the program keeps between runs (see the top of this file).
struct Settings(PathBuf);

fn writable(dir: &Path) -> bool {
    let probe = dir.join(".write-test");
    let ok = fs::create_dir_all(dir).is_ok() && fs::write(&probe, b"").is_ok();
    let _ = fs::remove_file(&probe);
    ok
}

fn settings_dir(app: &AppHandle) -> PathBuf {
    if let Some(d) = exe_dir().map(|d| d.join("settings")).filter(|d| writable(d)) {
        return d;
    }
    let d = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("pixel-to-3d"));
    let _ = fs::create_dir_all(&d);
    d
}

/// Where the autosave lives: `settings/autosave.p3d.json` next to the exe (or the fallback folder).
#[tauri::command]
fn autosave_path(settings: State<Settings>) -> String {
    settings.0.join("autosave.p3d.json").to_string_lossy().into_owned()
}

/// Files given on the command line (a session file or pictures, e.g. from "Open with").
#[tauri::command]
fn start_args() -> Vec<String> {
    std::env::args().skip(1).filter(|a| !a.starts_with('-')).collect()
}

/// Opens a folder in Explorer.
#[tauri::command]
fn open_folder(app: AppHandle, path: String) -> Result<(), String> {
    app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
}

// ------------------------------------------------------------------ watching loaded pictures

#[derive(Default)]
struct Watching(Mutex<Option<RecommendedWatcher>>);

/// Paths compared the way Windows does: case-insensitive, either slash.
fn key(p: &Path) -> String {
    p.to_string_lossy().replace('/', "\\").to_lowercase()
}

/// Watches these files from now on (replacing the previous list) and sends `files-changed` with the paths that were
/// written. The folders are watched rather than the files, because many art apps save by writing a new file and
/// renaming it over the old one.
#[tauri::command]
fn watch_files(app: AppHandle, state: State<Watching>, paths: Vec<String>) -> Result<(), String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    *slot = None;
    if paths.is_empty() {
        return Ok(());
    }
    let files: HashSet<String> = paths.iter().map(|p| key(Path::new(p))).collect();
    let dirs: HashSet<PathBuf> = paths.iter().filter_map(|p| Path::new(p).parent().map(Path::to_path_buf)).collect();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(ev) = res else { return };
        if matches!(ev.kind, EventKind::Access(_) | EventKind::Remove(_)) {
            return;
        }
        let hit: Vec<String> = ev
            .paths
            .iter()
            .filter(|p| files.contains(&key(p)))
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        if !hit.is_empty() {
            let _ = app.emit("files-changed", hit);
        }
    })
    .map_err(|e| e.to_string())?;
    for d in dirs {
        // a folder that's gone (a sheet whose folder was deleted) just isn't watched
        let _ = watcher.watch(&d, RecursiveMode::NonRecursive);
    }
    *slot = Some(watcher);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Watching::default())
        .setup(|app| {
            // the window is made here rather than from the config alone, so WebView2 keeps its data (browser
            // storage, caches) in the settings folder too
            let dir = settings_dir(app.handle());
            let cfg = app.config().app.windows.iter().find(|w| w.label == "main").cloned().ok_or("no main window in tauri.conf.json")?;
            tauri::WebviewWindowBuilder::from_config(app.handle(), &cfg)?.data_directory(dir.join("webview")).build()?;
            app.manage(Settings(dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            move_aside,
            list_dir,
            path_kinds,
            presets_dir,
            remove_preset,
            autosave_path,
            start_args,
            example_session,
            guide_path,
            open_folder,
            watch_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}

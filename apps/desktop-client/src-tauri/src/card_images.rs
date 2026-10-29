//! Local card-image cache (RIFT-1129).
//!
//! Card art is the official printing image. The desktop client keeps the
//! original bytes in its own app-data directory and serves them back to the
//! webview through the `rbimg` URI scheme, so card art is read from disk
//! instead of the network once it has been downloaded.
//!
//! * `rbimg://localhost/<printingId>?src=<official url>` (Windows:
//!   `http://rbimg.localhost/...`) returns the cached file. On a cache miss it
//!   downloads `src` once, validates it, stores it and returns it.
//! * `prefetch_card_images` downloads every missing printing in the
//!   background and reports progress through the `card-images-progress` event.
//!
//! The only accepted remote source is the official image CDN over HTTPS on
//! its default port, so the scheme can never act as a general fetch proxy.

use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Emitter, Manager, Runtime, Url};

pub const SCHEME: &str = "rbimg";
pub const PROGRESS_EVENT: &str = "card-images-progress";

const OFFICIAL_IMAGE_HOST: &str = "cmsassets.rgpub.io";
const CACHE_DIRECTORY: &str = "card-images";
const MAX_IMAGE_BYTES: u64 = 16 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const PREFETCH_WORKERS: usize = 4;
const EXTENSIONS: [&str; 4] = ["png", "jpg", "webp", "avif"];

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrefetchItem {
    id: String,
    url: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrefetchProgress {
    total: usize,
    cached: usize,
    failed: usize,
    running: bool,
    cancelled: bool,
}

/// Run control for the background prefetch. A start request that arrives
/// while a run is still winding down (paused, then resumed right away) is
/// remembered and started as soon as the current run ends, so one click on
/// "continue" is always enough.
#[derive(Default)]
pub struct PrefetchControl {
    inner: Mutex<ControlState>,
    cancel: AtomicBool,
}

#[derive(Default)]
struct ControlState {
    running: bool,
    restart: Option<Vec<PrefetchItem>>,
}

#[derive(Debug, PartialEq, Eq)]
enum StartDecision {
    /// No run in progress: start one now.
    Start,
    /// A run is in progress; it continues (any pending pause is withdrawn)
    /// and the request is re-run once it ends.
    Queued,
}

impl PrefetchControl {
    fn request_start(&self, items: Vec<PrefetchItem>) -> (StartDecision, Option<Vec<PrefetchItem>>) {
        let mut state = self.inner.lock().unwrap_or_else(|poison| poison.into_inner());
        self.cancel.store(false, Ordering::SeqCst);
        if state.running {
            state.restart = Some(items);
            (StartDecision::Queued, None)
        } else {
            state.running = true;
            (StartDecision::Start, Some(items))
        }
    }

    /// Called when a run's workers have all exited. Returns the items of a
    /// start request that arrived meanwhile; the run then stays "running".
    fn finish(&self) -> Option<Vec<PrefetchItem>> {
        let mut state = self.inner.lock().unwrap_or_else(|poison| poison.into_inner());
        match state.restart.take() {
            Some(items) if !self.cancel.load(Ordering::SeqCst) => Some(items),
            _ => {
                state.running = false;
                None
            }
        }
    }

    fn cancel(&self) {
        let mut state = self.inner.lock().unwrap_or_else(|poison| poison.into_inner());
        state.restart = None;
        self.cancel.store(true, Ordering::SeqCst);
    }

    fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }
}

/// Same printing-id shape the game server accepts for `/api/card-images`.
fn is_safe_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    if bytes.is_empty() || bytes.len() > 128 {
        return false;
    }
    let edge_ok = |b: u8| b.is_ascii_alphanumeric();
    if !edge_ok(bytes[0]) || !edge_ok(bytes[bytes.len() - 1]) {
        return false;
    }
    bytes
        .iter()
        .all(|&b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-')
        && !id.contains("..")
}

fn cache_directory<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("app data directory unavailable: {error}"))?;
    Ok(base.join(CACHE_DIRECTORY))
}

fn cached_file(directory: &Path, id: &str) -> Option<(PathBuf, &'static str)> {
    EXTENSIONS.iter().find_map(|extension| {
        let path = directory.join(format!("{id}.{extension}"));
        path.is_file().then(|| (path, mime_for(extension)))
    })
}

fn mime_for(extension: &str) -> &'static str {
    match extension {
        "png" => "image/png",
        "jpg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "image/avif",
    }
}

/// An ISO-BMFF `ftyp` box whose major or any compatible brand is AVIF.
fn is_avif(bytes: &[u8]) -> bool {
    if bytes.len() < 16 || &bytes[4..8] != b"ftyp" {
        return false;
    }
    let size = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
    if size < 16 || size > bytes.len() {
        return false;
    }
    let is_avif_brand = |brand: &[u8]| brand == b"avif" || brand == b"avis";
    is_avif_brand(&bytes[8..12]) || bytes[16..size].chunks_exact(4).any(is_avif_brand)
}

/// Identifies the image by its file signature; the response header alone is
/// never trusted.
fn sniff_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("jpg")
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else if is_avif(bytes) {
        Some("avif")
    } else {
        None
    }
}

/// Only the official CDN over HTTPS on its default port, without credentials.
pub fn is_allowed_source(source: &str) -> bool {
    let Ok(url) = Url::parse(source) else {
        return false;
    };
    url.scheme() == "https"
        && url.host_str() == Some(OFFICIAL_IMAGE_HOST)
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
}

fn download(source: &str) -> Result<(Vec<u8>, &'static str), String> {
    let agent = ureq::AgentBuilder::new()
        .timeout(REQUEST_TIMEOUT)
        .redirects(0)
        .build();
    let response = agent
        .get(source)
        .call()
        .map_err(|error| format!("download failed: {error}"))?;
    if response.status() != 200 {
        return Err(format!("download returned HTTP {}", response.status()));
    }
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(MAX_IMAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("download interrupted: {error}"))?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err("image is empty or too large".into());
    }
    let extension = sniff_extension(&bytes).ok_or("response is not a supported image")?;
    Ok((bytes, extension))
}

/// Writes to a temporary sibling first so a reader never sees a partial file.
/// If the rename loses a race against another writer of the same printing,
/// the already-present file is accepted.
fn store(directory: &Path, id: &str, bytes: &[u8], extension: &str) -> Result<PathBuf, String> {
    fs::create_dir_all(directory).map_err(|error| format!("cannot create cache: {error}"))?;
    let target = directory.join(format!("{id}.{extension}"));
    let temporary = directory.join(format!(
        ".{id}.{extension}.{}-{:?}.part",
        std::process::id(),
        thread::current().id()
    ));
    let write = || -> std::io::Result<()> {
        let mut file = fs::File::create(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, &target)
    };
    match write() {
        Ok(()) => Ok(target),
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            match cached_file(directory, id) {
                Some((existing, _)) => Ok(existing),
                None => Err(format!("cannot store image: {error}")),
            }
        }
    }
}

/// One lock per printing id, so the background prefetch and an on-demand
/// image request never download or write the same printing at once.
fn printing_lock(id: &str) -> Arc<Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    let mut locks = LOCKS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    Arc::clone(locks.entry(id.to_string()).or_default())
}

/// Returns the cached bytes, downloading and storing them first when absent.
fn load_or_fetch(directory: &Path, id: &str, source: Option<&str>) -> Result<(Vec<u8>, &'static str), String> {
    let lock = printing_lock(id);
    let _guard = lock.lock().unwrap_or_else(|poison| poison.into_inner());
    if let Some((path, content_type)) = cached_file(directory, id) {
        if let Ok(bytes) = fs::read(&path) {
            return Ok((bytes, content_type));
        }
    }
    let source = source.ok_or("image not cached")?;
    if !is_allowed_source(source) {
        return Err("image source is not allowed".into());
    }
    let (bytes, extension) = download(source)?;
    store(directory, id, &bytes, extension)?;
    Ok((bytes, mime_for(extension)))
}

fn respond(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn request_parts(request: &Request<Vec<u8>>) -> Option<(String, Option<String>)> {
    let uri = request.uri();
    let encoded_id = uri.path().trim_start_matches('/');
    let id = percent_decode(encoded_id)?;
    let source = uri.query().and_then(|query| {
        query
            .split('&')
            .find_map(|pair| pair.strip_prefix("src="))
            .and_then(percent_decode)
    });
    Some((id, source))
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' => {
                let hex = value.get(index + 1..index + 3)?;
                decoded.push(u8::from_str_radix(hex, 16).ok()?);
                index += 3;
            }
            b'+' => {
                decoded.push(b' ');
                index += 1;
            }
            byte => {
                decoded.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8(decoded).ok()
}

/// Serves one `rbimg` request: cache first, then a single validated download.
pub fn handle_request<R: Runtime>(app: &AppHandle<R>, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let Some((id, source)) = request_parts(request) else {
        return respond(StatusCode::BAD_REQUEST, "text/plain", b"bad image request".to_vec());
    };
    if !is_safe_id(&id) {
        return respond(StatusCode::BAD_REQUEST, "text/plain", b"bad printing id".to_vec());
    }
    let directory = match cache_directory(app) {
        Ok(directory) => directory,
        Err(error) => return respond(StatusCode::INTERNAL_SERVER_ERROR, "text/plain", error.into_bytes()),
    };
    match load_or_fetch(&directory, &id, source.as_deref()) {
        Ok((bytes, content_type)) => respond(StatusCode::OK, content_type, bytes),
        Err(error) if source.is_none() => respond(StatusCode::NOT_FOUND, "text/plain", error.into_bytes()),
        Err(error) => respond(StatusCode::BAD_GATEWAY, "text/plain", error.into_bytes()),
    }
}

/// Printing ids that already have a local file.
#[tauri::command]
pub fn card_image_cache_ids(app: AppHandle) -> Result<Vec<String>, String> {
    let directory = cache_directory(&app)?;
    let Ok(entries) = fs::read_dir(&directory) else {
        return Ok(Vec::new());
    };
    let mut ids: Vec<String> = entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| !name.starts_with('.'))
        .filter_map(|name| {
            let (id, extension) = name.rsplit_once('.')?;
            (EXTENSIONS.contains(&extension) && is_safe_id(id)).then(|| id.to_string())
        })
        .collect();
    ids.sort();
    ids.dedup();
    Ok(ids)
}

/// Starts the background download of every missing printing. A request made
/// while a previous run is still stopping is picked up as soon as it ends.
#[tauri::command]
pub fn prefetch_card_images(
    app: AppHandle,
    control: tauri::State<'_, Arc<PrefetchControl>>,
    items: Vec<PrefetchItem>,
) -> Result<(), String> {
    let directory = cache_directory(&app)?;
    let control = Arc::clone(control.inner());
    if let (StartDecision::Start, Some(items)) = control.request_start(items) {
        spawn_run(app, control, directory, items);
    }
    Ok(())
}

/// Pauses the background download; already-stored images stay cached.
#[tauri::command]
pub fn cancel_card_image_prefetch(control: tauri::State<'_, Arc<PrefetchControl>>) {
    control.cancel();
}

fn spawn_run(app: AppHandle, control: Arc<PrefetchControl>, directory: PathBuf, items: Vec<PrefetchItem>) {
    thread::spawn(move || {
        let mut items = items;
        loop {
            run_once(&app, &control, &directory, items);
            match control.finish() {
                Some(next) => items = next,
                None => break,
            }
        }
    });
}

fn emit_progress(app: &AppHandle, control: &PrefetchControl, total: usize, cached: usize, failed: usize, running: bool) {
    let _ = app.emit(
        PROGRESS_EVENT,
        PrefetchProgress { total, cached, failed, running, cancelled: control.cancelled() },
    );
}

fn run_once(app: &AppHandle, control: &Arc<PrefetchControl>, directory: &Path, items: Vec<PrefetchItem>) {
    let total = items.len();
    let mut pending = VecDeque::new();
    let mut already = 0;
    for item in items {
        if is_safe_id(&item.id) && cached_file(directory, &item.id).is_some() {
            already += 1;
        } else {
            pending.push_back(item);
        }
    }
    let queue = Mutex::new(pending);
    let cached = AtomicUsize::new(already);
    let failed = AtomicUsize::new(0);
    let report = |running: bool| {
        emit_progress(app, control, total, cached.load(Ordering::SeqCst), failed.load(Ordering::SeqCst), running);
    };
    report(true);
    thread::scope(|scope| {
        for _ in 0..PREFETCH_WORKERS {
            scope.spawn(|| loop {
                if control.cancelled() {
                    break;
                }
                let Some(item) = queue.lock().ok().and_then(|mut queue| queue.pop_front()) else {
                    break;
                };
                let result = if is_safe_id(&item.id) {
                    load_or_fetch(directory, &item.id, Some(&item.url)).map(|_| ())
                } else {
                    Err("bad printing id".to_string())
                };
                match result {
                    Ok(()) => cached.fetch_add(1, Ordering::SeqCst),
                    Err(_) => failed.fetch_add(1, Ordering::SeqCst),
                };
                report(true);
            });
        }
    });
    // The final summary of this run (the outer loop may start another).
    report(false);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str) -> PrefetchItem {
        PrefetchItem { id: id.into(), url: format!("https://{OFFICIAL_IMAGE_HOST}/{id}.png") }
    }

    fn temp_directory(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!("rbimg-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        directory
    }

    #[test]
    fn accepts_only_safe_printing_ids() {
        assert!(is_safe_id("sfd-026-221"));
        assert!(is_safe_id("ogn-001a-298"));
        assert!(!is_safe_id(""));
        assert!(!is_safe_id("../etc"));
        assert!(!is_safe_id("a..b"));
        assert!(!is_safe_id("-leading"));
        assert!(!is_safe_id("bad/slash"));
        assert!(!is_safe_id("bad%2fslash"));
    }

    #[test]
    fn accepts_only_the_official_cdn() {
        assert!(is_allowed_source(
            "https://cmsassets.rgpub.io/sanity/images/x/game_data_live/a-744x1039.png?accountingTag=RB"
        ));
        assert!(!is_allowed_source("http://cmsassets.rgpub.io/a.png"));
        assert!(!is_allowed_source("https://cmsassets.rgpub.io:8443/a.png"));
        assert!(!is_allowed_source("https://cmsassets.rgpub.io.evil.example/a.png"));
        assert!(!is_allowed_source("https://user:pw@cmsassets.rgpub.io/a.png"));
        assert!(!is_allowed_source("https://evil.example/api/card-images/sfd-026-221"));
        assert!(!is_allowed_source("https://rift-beta.xjerryx.com/api/card-images/sfd-026-221"));
        assert!(!is_allowed_source("http://10.0.0.1/api/card-images/sfd-026-221"));
        assert!(!is_allowed_source("file:///etc/passwd"));
        assert!(!is_allowed_source("not a url"));
    }

    #[test]
    fn identifies_images_by_signature() {
        assert_eq!(sniff_extension(b"\x89PNG\r\n\x1a\nrest"), Some("png"));
        assert_eq!(sniff_extension(&[0xff, 0xd8, 0xff, 0xe0]), Some("jpg"));
        assert_eq!(sniff_extension(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
        assert_eq!(sniff_extension(b"\0\0\0\x10ftypavif\0\0\0\0"), Some("avif"));
        assert_eq!(sniff_extension(b"<html>not an image"), None);
    }

    #[test]
    fn recognises_avif_from_compatible_brands() {
        // major brand mif1, compatible brands mif1 + avif (common encoder output)
        let mif1 = b"\0\0\0\x18ftypmif1\0\0\0\0mif1avif";
        assert_eq!(sniff_extension(mif1), Some("avif"));
        // a HEIC file (no AVIF brand) is not accepted
        let heic = b"\0\0\0\x18ftypheic\0\0\0\0mif1heic";
        assert_eq!(sniff_extension(heic), None);
        // a box size beyond the data is rejected
        let truncated = b"\0\0\0\x40ftypmif1\0\0\0\0avif";
        assert_eq!(sniff_extension(truncated), None);
    }

    #[test]
    fn decodes_scheme_paths_and_sources() {
        assert_eq!(percent_decode("sfd-026-221").as_deref(), Some("sfd-026-221"));
        assert_eq!(
            percent_decode("https%3A%2F%2Fcmsassets.rgpub.io%2Fa.png%3FaccountingTag%3DRB").as_deref(),
            Some("https://cmsassets.rgpub.io/a.png?accountingTag=RB")
        );
        assert_eq!(percent_decode("%zz"), None);
    }

    #[test]
    fn stores_atomically_and_finds_cached_file() {
        let directory = temp_directory("store");
        let png = b"\x89PNG\r\n\x1a\nbody".to_vec();
        let path = store(&directory, "sfd-026-221", &png, "png").expect("stored");
        assert_eq!(fs::read(&path).expect("readable"), png);
        let (found, content_type) = cached_file(&directory, "sfd-026-221").expect("cached");
        assert_eq!(found, path);
        assert_eq!(content_type, "image/png");
        assert!(cached_file(&directory, "sfd-110-221").is_none());
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn concurrent_writers_of_one_printing_all_succeed() {
        let directory = temp_directory("concurrent");
        let png = b"\x89PNG\r\n\x1a\nsame-bytes".to_vec();
        thread::scope(|scope| {
            let handles: Vec<_> = (0..8)
                .map(|_| scope.spawn(|| store(&directory, "sfd-026-221", &png, "png")))
                .collect();
            for handle in handles {
                assert!(handle.join().expect("joined").is_ok());
            }
        });
        assert_eq!(fs::read(directory.join("sfd-026-221.png")).expect("stored"), png);
        let leftovers = fs::read_dir(&directory)
            .expect("listable")
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".part"))
            .count();
        assert_eq!(leftovers, 0);
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn cached_printing_is_served_without_any_source() {
        let directory = temp_directory("cached");
        let png = b"\x89PNG\r\n\x1a\ncached".to_vec();
        store(&directory, "sfd-026-221", &png, "png").expect("stored");
        let (bytes, content_type) = load_or_fetch(&directory, "sfd-026-221", None).expect("served");
        assert_eq!(bytes, png);
        assert_eq!(content_type, "image/png");
        // a disallowed source is never contacted for a cached printing either
        assert!(load_or_fetch(&directory, "sfd-026-221", Some("https://evil.example/a.png")).is_ok());
        // an uncached printing with a disallowed source is refused before any download
        assert_eq!(
            load_or_fetch(&directory, "sfd-110-221", Some("https://evil.example/a.png")).unwrap_err(),
            "image source is not allowed"
        );
        assert_eq!(load_or_fetch(&directory, "sfd-110-221", None).unwrap_err(), "image not cached");
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn resume_during_a_stopping_run_restarts_it() {
        let control = PrefetchControl::default();
        assert_eq!(control.request_start(vec![item("a")]).0, StartDecision::Start);
        control.cancel();
        assert!(control.cancelled());
        // "continue" clicked while the paused run's workers are still exiting
        assert_eq!(control.request_start(vec![item("a"), item("b")]).0, StartDecision::Queued);
        assert!(!control.cancelled());
        let restarted = control.finish().expect("restart queued");
        assert_eq!(restarted.len(), 2);
        // the restarted run ends normally
        assert!(control.finish().is_none());
        assert_eq!(control.request_start(vec![item("c")]).0, StartDecision::Start);
    }

    #[test]
    fn pause_withdraws_a_queued_restart() {
        let control = PrefetchControl::default();
        assert_eq!(control.request_start(vec![item("a")]).0, StartDecision::Start);
        assert_eq!(control.request_start(vec![item("a")]).0, StartDecision::Queued);
        control.cancel();
        assert!(control.finish().is_none());
        assert_eq!(control.request_start(vec![item("a")]).0, StartDecision::Start);
    }
}

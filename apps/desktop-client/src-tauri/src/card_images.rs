//! Local card-image cache (RIFT-1129).
//!
//! Card art is the official printing image. The desktop client keeps the
//! original bytes in its own app-data directory and serves them back to the
//! webview through the `rbimg` URI scheme, so card art is read from disk
//! instead of the network once it has been downloaded.
//!
//! * `rbimg://localhost/<printingId>?src=<remote url>` (Windows:
//!   `http://rbimg.localhost/...`) returns the cached file. On a cache miss it
//!   downloads `src` once, validates it, stores it and returns it.
//! * `prefetch_card_images` downloads every missing printing in the
//!   background and reports progress through the `card-images-progress` event.
//!
//! Only two remote sources are accepted: the official image CDN over HTTPS,
//! and a game server's own `/api/card-images/<printingId>` route for the same
//! printing. The scheme is therefore never a general-purpose fetch proxy.

use std::collections::VecDeque;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
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

#[derive(Default)]
pub struct PrefetchState {
    running: AtomicBool,
    cancel: AtomicBool,
}

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

/// Identifies the image by its file signature; the response header alone is
/// never trusted.
fn sniff_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("jpg")
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" && (&bytes[8..12] == b"avif" || &bytes[8..12] == b"avis") {
        Some("avif")
    } else {
        None
    }
}

/// The official CDN over HTTPS, or a game server's image route for exactly
/// this printing.
pub fn is_allowed_source(source: &str, id: &str) -> bool {
    let Ok(url) = Url::parse(source) else {
        return false;
    };
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    match url.scheme() {
        "https" if url.host_str() == Some(OFFICIAL_IMAGE_HOST) => true,
        "https" | "http" => {
            url.query().is_none() && url.path() == format!("/api/card-images/{id}")
        }
        _ => false,
    }
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
    if let Err(error) = write() {
        let _ = fs::remove_file(&temporary);
        return Err(format!("cannot store image: {error}"));
    }
    Ok(target)
}

fn fetch_into_cache(directory: &Path, id: &str, source: &str) -> Result<(Vec<u8>, &'static str), String> {
    if !is_allowed_source(source, id) {
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
    if let Some((path, content_type)) = cached_file(&directory, &id) {
        if let Ok(bytes) = fs::read(&path) {
            return respond(StatusCode::OK, content_type, bytes);
        }
    }
    let Some(source) = source else {
        return respond(StatusCode::NOT_FOUND, "text/plain", b"image not cached".to_vec());
    };
    match fetch_into_cache(&directory, &id, &source) {
        Ok((bytes, content_type)) => respond(StatusCode::OK, content_type, bytes),
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

/// Starts (or restarts after a pause) the background download of every
/// missing printing. Returns `false` when a run is already in progress.
#[tauri::command]
pub fn prefetch_card_images(
    app: AppHandle,
    state: tauri::State<'_, Arc<PrefetchState>>,
    items: Vec<PrefetchItem>,
) -> Result<bool, String> {
    let state = Arc::clone(state.inner());
    if state.running.swap(true, Ordering::SeqCst) {
        return Ok(false);
    }
    state.cancel.store(false, Ordering::SeqCst);
    let directory = match cache_directory(&app) {
        Ok(directory) => directory,
        Err(error) => {
            state.running.store(false, Ordering::SeqCst);
            return Err(error);
        }
    };

    let total = items.len();
    let mut pending = VecDeque::new();
    let mut cached = 0;
    for item in items {
        if is_safe_id(&item.id) && cached_file(&directory, &item.id).is_some() {
            cached += 1;
        } else {
            pending.push_back(item);
        }
    }

    let queue = Arc::new(Mutex::new(pending));
    let cached = Arc::new(AtomicUsize::new(cached));
    let failed = Arc::new(AtomicUsize::new(0));
    let emit = {
        let app = app.clone();
        let state = Arc::clone(&state);
        let cached = Arc::clone(&cached);
        let failed = Arc::clone(&failed);
        move |running: bool| {
            let _ = app.emit(
                PROGRESS_EVENT,
                PrefetchProgress {
                    total,
                    cached: cached.load(Ordering::SeqCst),
                    failed: failed.load(Ordering::SeqCst),
                    running,
                    cancelled: state.cancel.load(Ordering::SeqCst),
                },
            );
        }
    };
    emit(true);

    thread::spawn(move || {
        let workers: Vec<_> = (0..PREFETCH_WORKERS)
            .map(|_| {
                let queue = Arc::clone(&queue);
                let state = Arc::clone(&state);
                let directory = directory.clone();
                let cached = Arc::clone(&cached);
                let failed = Arc::clone(&failed);
                let emit = emit.clone();
                thread::spawn(move || loop {
                    if state.cancel.load(Ordering::SeqCst) {
                        break;
                    }
                    let Some(item) = queue.lock().ok().and_then(|mut queue| queue.pop_front()) else {
                        break;
                    };
                    let result = if !is_safe_id(&item.id) {
                        Err("bad printing id".to_string())
                    } else if cached_file(&directory, &item.id).is_some() {
                        Ok(())
                    } else {
                        fetch_into_cache(&directory, &item.id, &item.url).map(|_| ())
                    };
                    match result {
                        Ok(()) => cached.fetch_add(1, Ordering::SeqCst),
                        Err(_) => failed.fetch_add(1, Ordering::SeqCst),
                    };
                    emit(true);
                })
            })
            .collect();
        for worker in workers {
            let _ = worker.join();
        }
        state.running.store(false, Ordering::SeqCst);
        emit(false);
    });
    Ok(true)
}

/// Pauses the background download; already-stored images stay cached.
#[tauri::command]
pub fn cancel_card_image_prefetch(state: tauri::State<'_, Arc<PrefetchState>>) {
    state.cancel.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn accepts_only_official_cdn_or_matching_server_route() {
        let id = "sfd-026-221";
        assert!(is_allowed_source(
            "https://cmsassets.rgpub.io/sanity/images/x/game_data_live/a-744x1039.png?accountingTag=RB",
            id
        ));
        assert!(is_allowed_source("https://rift-beta.xjerryx.com/api/card-images/sfd-026-221", id));
        assert!(is_allowed_source("http://127.0.0.1:8787/api/card-images/sfd-026-221", id));
        assert!(!is_allowed_source("http://cmsassets.rgpub.io/a.png", id));
        assert!(!is_allowed_source("https://evil.example/a.png", id));
        assert!(!is_allowed_source("https://rift-beta.xjerryx.com/api/card-images/sfd-110-221", id));
        assert!(!is_allowed_source("https://rift-beta.xjerryx.com/api/cards", id));
        assert!(!is_allowed_source("https://user:pw@cmsassets.rgpub.io/a.png", id));
        assert!(!is_allowed_source("file:///etc/passwd", id));
    }

    #[test]
    fn identifies_images_by_signature() {
        assert_eq!(sniff_extension(b"\x89PNG\r\n\x1a\nrest"), Some("png"));
        assert_eq!(sniff_extension(&[0xff, 0xd8, 0xff, 0xe0]), Some("jpg"));
        assert_eq!(sniff_extension(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
        assert_eq!(sniff_extension(b"\0\0\0\x1cftypavif"), Some("avif"));
        assert_eq!(sniff_extension(b"<html>not an image"), None);
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
        let directory = std::env::temp_dir().join(format!("rbimg-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        let png = b"\x89PNG\r\n\x1a\nbody".to_vec();
        let path = store(&directory, "sfd-026-221", &png, "png").expect("stored");
        assert_eq!(fs::read(&path).expect("readable"), png);
        let (found, content_type) = cached_file(&directory, "sfd-026-221").expect("cached");
        assert_eq!(found, path);
        assert_eq!(content_type, "image/png");
        assert!(cached_file(&directory, "sfd-110-221").is_none());
        let leftovers: Vec<_> = fs::read_dir(&directory)
            .expect("listable")
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".part"))
            .collect();
        assert!(leftovers.is_empty());
        let _ = fs::remove_dir_all(&directory);
    }
}

use std::io::Read as _;
use std::time::Duration;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse,
    },
    Json,
};
use serde::Deserialize;
use tokio_stream::{wrappers::BroadcastStream, StreamExt};
use tracing::warn;

use crate::{
    auth::middleware::AuthUser,
    db::music_queue,
    error::{AppError, Result},
    minecraft::music::{self, CurrentTrack},
    state::AppState,
};

// ── GET /api/music/tracks ──────────────────────────────────────────────────────

/// Unified catalog entry — merges the static vanilla catalog with user-added
/// custom tracks from the database.  `is_custom` lets the UI badge custom ones.
/// `image_url` is set for custom tracks that have artwork uploaded.
#[derive(Clone, serde::Serialize)]
pub struct CatalogEntry {
    pub id:            String,
    pub display_name:  String,
    pub artist:        String,
    pub duration_secs: u32,
    pub is_custom:     bool,
    pub image_url:     Option<String>,
}

/// GET /api/music/tracks — vanilla catalog plus any registered custom tracks.
pub async fn list_tracks(
    State(state): State<AppState>,
    _: AuthUser,
) -> Result<Json<Vec<CatalogEntry>>> {
    let vanilla: Vec<CatalogEntry> = music::CATALOG.iter().map(|e| CatalogEntry {
        id:            e.id.to_string(),
        display_name:  e.display_name.to_string(),
        artist:        e.artist.to_string(),
        duration_secs: e.duration_secs,
        is_custom:     false,
        image_url:     None,
    }).collect();

    let custom: Vec<CatalogEntry> = music_queue::list_custom_tracks(&state.pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|t| CatalogEntry {
            id:            t.sound_id.clone(),
            display_name:  t.display_name,
            artist:        t.artist,
            duration_secs: t.duration_secs as u32,
            is_custom:     true,
            image_url:     t.image_filename
                .map(|f| format!("/uploads/music/images/{f}")),
        })
        .collect();

    Ok(Json([vanilla, custom].concat()))
}

// ── GET /api/music/state ───────────────────────────────────────────────────────

/// Return the current now-playing info plus the upcoming queue.
pub async fn get_state(
    State(state): State<AppState>,
    _: AuthUser,
) -> Result<Json<music_queue::MusicStatePayload>> {
    let queue = music_queue::list(&state.pool).await?;
    let now_playing = {
        let guard = state.music_current.lock().await;
        guard.as_ref().map(|t| music_queue::NowPlayingPayload {
            queue_id:      t.queue_id,
            sound_id:      t.sound_id.clone(),
            display_name:  t.display_name.clone(),
            artist:        t.artist.clone(),
            requested_by:  t.requested_by.clone(),
            elapsed_secs:  t.started_at.elapsed().as_secs(),
            duration_secs: t.duration_secs,
        })
    };
    Ok(Json(music_queue::MusicStatePayload { now_playing, queue }))
}

// ── POST /api/music/queue ──────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct EnqueueBody {
    pub sound_id: String,
}

/// Add a track to the queue.  If nothing is currently playing, starts it
/// immediately via /playsound; otherwise appends to the DB queue.
pub async fn enqueue(
    State(state): State<AppState>,
    actor: AuthUser,
    Json(body): Json<EnqueueBody>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "music.play")?;

    // Resolve sound metadata from vanilla catalog first, then custom DB tracks.
    let (display_name, artist, duration_secs): (String, String, u32) =
        if let Some(e) = music::lookup(&body.sound_id) {
            (e.display_name.to_string(), e.artist.to_string(), e.duration_secs)
        } else {
            let customs = music_queue::list_custom_tracks(&state.pool).await.unwrap_or_default();
            if let Some(t) = customs.iter().find(|t| t.sound_id == body.sound_id) {
                (t.display_name.clone(), t.artist.clone(), t.duration_secs as u32)
            } else {
                return Err(AppError::BadRequest(
                    format!("Unknown sound '{}' — add it as a custom track first", body.sound_id)
                ));
            }
        };

    // Lock for the check-and-act to prevent two concurrent requests from both
    // seeing an idle state and firing duplicate playsound commands.
    let mut current_guard = state.music_current.lock().await;

    if current_guard.is_none() {
        // Nothing playing — start immediately.
        let _ = music::play_all(&state.config, &body.sound_id).await;
        *current_guard = Some(CurrentTrack {
            queue_id:      0,
            sound_id:      body.sound_id.clone(),
            display_name:  display_name.clone(),
            artist:        artist.clone(),
            requested_by:  actor.email.clone(),
            started_at:    std::time::Instant::now(),
            duration_secs,
        });
        drop(current_guard);
    } else {
        // Something is playing — append to the persistent queue.
        drop(current_guard);
        music_queue::enqueue(&state.pool, &body.sound_id, &display_name, &actor.email).await?;
    }

    music::broadcast_state(&state.pool, &state.music_current, &state.music_tx).await;

    Ok(StatusCode::NO_CONTENT)
}

// ── DELETE /api/music/queue/:id ────────────────────────────────────────────────

/// Remove an upcoming queue entry.  Cannot remove the currently-playing track
/// (use /skip for that).
pub async fn remove_from_queue(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "music.play")?;

    let found = music_queue::remove(&state.pool, id).await?;
    if !found {
        return Err(AppError::NotFound(format!("Queue entry {id} not found")));
    }

    music::broadcast_state(&state.pool, &state.music_current, &state.music_tx).await;

    Ok(StatusCode::NO_CONTENT)
}

// ── POST /api/music/skip ───────────────────────────────────────────────────────

/// Stop the current track and immediately start the next one (if any).
pub async fn skip(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "music.play")?;

    let _ = music::stop_all(&state.config).await;
    music::start_next(&state.config, &state.pool, &state.music_current, &state.music_tx).await;

    Ok(StatusCode::NO_CONTENT)
}

// ── POST /api/music/stop ───────────────────────────────────────────────────────

/// Stop all music and clear the entire queue.
pub async fn stop(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "music.play")?;

    let _ = music::stop_all(&state.config).await;

    music_queue::clear(&state.pool).await?;

    {
        let mut guard = state.music_current.lock().await;
        *guard = None;
    }

    music::broadcast_state(&state.pool, &state.music_current, &state.music_tx).await;

    Ok(StatusCode::NO_CONTENT)
}

// ── POST /api/music/tracks ────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct AddTrackBody {
    pub sound_id:      String,
    pub display_name:  String,
    #[serde(default)]
    pub artist:        String,
    #[serde(default = "default_duration")]
    pub duration_secs: i64,
}
fn default_duration() -> i64 { 180 }

/// Register a custom sound event from the server's resource pack.
pub async fn add_custom_track(
    State(state): State<AppState>,
    actor: AuthUser,
    Json(body): Json<AddTrackBody>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "music.play")?;

    if body.sound_id.trim().is_empty() || body.display_name.trim().is_empty() {
        return Err(AppError::BadRequest("sound_id and display_name are required".into()));
    }
    if body.duration_secs < 1 || body.duration_secs > 7200 {
        return Err(AppError::BadRequest("duration_secs must be 1–7200".into()));
    }

    music_queue::add_custom_track(
        &state.pool,
        body.sound_id.trim(),
        body.display_name.trim(),
        body.artist.trim(),
        body.duration_secs,
        &actor.email,
    ).await?;

    Ok(StatusCode::NO_CONTENT)
}

/// Update the display metadata of an existing custom track.
#[derive(Deserialize)]
pub struct UpdateTrackBody {
    pub display_name:  String,
    #[serde(default)]
    pub artist:        String,
    #[serde(default = "default_duration")]
    pub duration_secs: i64,
}

pub async fn update_custom_track(
    State(state): State<AppState>,
    actor: AuthUser,
    axum::extract::Path(sound_id): axum::extract::Path<String>,
    Json(body): Json<UpdateTrackBody>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "music.play")?;

    if body.display_name.trim().is_empty() {
        return Err(AppError::BadRequest("display_name is required".into()));
    }
    if body.duration_secs < 1 || body.duration_secs > 7200 {
        return Err(AppError::BadRequest("duration_secs must be 1–7200".into()));
    }

    let found = music_queue::update_custom_track(
        &state.pool,
        &sound_id,
        body.display_name.trim(),
        body.artist.trim(),
        body.duration_secs,
    ).await?;
    if !found {
        return Err(AppError::NotFound(format!("Custom track '{sound_id}' not found")));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ── POST /api/music/upload ────────────────────────────────────────────────────

/// Upload one or more `.ogg` files. Each file is stored under the resource-pack
/// sounds directory, registered as a custom track, and returned in the response.
///
/// Long files are split losslessly into ~5-minute chunks via ffmpeg (`-c copy`).
/// Each chunk becomes its own custom track named "Original (1/N)", "(2/N)", …
/// — so the user can multi-select all of them in the disc picker to play the
/// full song back-to-back.
///
/// Path layout:
///   /opt/redstonecipher/www/uploads/music/{filename}.ogg
/// Sound ID:
///   redstonecipher:music.{filename_without_ext}
pub async fn upload_oggs(
    State(state): State<AppState>,
    actor: AuthUser,
    mut multipart: axum::extract::Multipart,
) -> Result<Json<Vec<music_queue::CustomTrack>>> {
    crate::auth::middleware::require_perm(&actor, "music.play")?;

    const UPLOAD_DIR: &str = "/opt/redstonecipher/www/uploads/music";
    tokio::fs::create_dir_all(UPLOAD_DIR).await
        .map_err(|e| AppError::ExternalCommand(format!("create upload dir: {e}")))?;

    let mut created: Vec<music_queue::CustomTrack> = vec![];

    while let Some(field) = multipart.next_field().await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
    {
        if field.name() != Some("file") { continue; }

        let original_name = field.file_name()
            .map(|s| s.to_string())
            .ok_or_else(|| AppError::BadRequest("Missing filename in upload".into()))?;

        if !original_name.to_lowercase().ends_with(".ogg") {
            return Err(AppError::BadRequest(
                format!("'{original_name}' is not an .ogg file")
            ));
        }

        let bytes = field.bytes().await
            .map_err(|e| AppError::BadRequest(e.to_string()))?;

        // Sanitise filename (alphanumeric + underscore + dot only)
        let base = sanitise_filename(&original_name);
        let stem = base.trim_end_matches(".ogg");
        if stem.is_empty() {
            return Err(AppError::BadRequest("Empty filename after sanitisation".into()));
        }

        // Write the upload to disk first so ffmpeg can read it.
        let raw_path = format!("{UPLOAD_DIR}/{base}");
        tokio::fs::write(&raw_path, &bytes).await
            .map_err(|e| AppError::ExternalCommand(format!("write {raw_path}: {e}")))?;
        // Memory pressure: drop the buffered upload bytes asap.
        drop(bytes);

        // Detect duration via ffprobe.
        let duration = match probe_duration_secs(&raw_path).await {
            Ok(d) => d,
            Err(e) => {
                tracing::warn!(file = %raw_path, error = %e,
                    "ffprobe failed; storing as single track with default duration");
                180
            }
        };

        // Split when needed.  Sweet spot: ~5-minute slices (300s).
        const CHUNK_SECS: i64 = 300;
        let display_base = pretty_name(stem);

        if duration <= CHUNK_SECS + 30 {
            // Short file — register the original as a single track.
            let sound_id = format!("redstonecipher:music.{stem}");
            let _ = music_queue::remove_custom_track(&state.pool, &sound_id).await;
            let track = music_queue::add_custom_track(
                &state.pool,
                &sound_id,
                &display_base,
                "",
                duration,
                &actor.email,
            ).await?;
            created.push(track);
            continue;
        }

        // ── Split path ────────────────────────────────────────────────
        let total_chunks = ((duration as f64) / (CHUNK_SECS as f64)).ceil() as i64;
        let mut chunk_paths: Vec<(String, String, i64, i64)> = vec![]; // (sound_id, file_path, idx, dur)
        for idx in 0..total_chunks {
            let start = idx * CHUNK_SECS;
            let this_dur = (duration - start).min(CHUNK_SECS);

            let chunk_stem = format!("{stem}_part{}", idx + 1);
            let chunk_path = format!("{UPLOAD_DIR}/{chunk_stem}.ogg");

            if let Err(e) = run_ffmpeg_split(&raw_path, &chunk_path, start, this_dur).await {
                // Clean up any partial outputs.
                for (_, p, _, _) in &chunk_paths {
                    let _ = tokio::fs::remove_file(p).await;
                }
                let _ = tokio::fs::remove_file(&chunk_path).await;
                return Err(AppError::ExternalCommand(format!("ffmpeg split: {e}")));
            }

            chunk_paths.push((
                format!("redstonecipher:music.{chunk_stem}"),
                chunk_path,
                idx + 1,
                this_dur,
            ));
        }

        // Remove the original — splits are the canonical artifacts now.
        let _ = tokio::fs::remove_file(&raw_path).await;

        // Register each split.  Naming "Original Name (1/N)" so the user
        // can pick all of them in the disc modal to play them back-to-back.
        for (sound_id, _path, n, dur) in &chunk_paths {
            let display_name = format!("{display_base} ({}/{})", n, total_chunks);
            let _ = music_queue::remove_custom_track(&state.pool, sound_id).await;
            let track = music_queue::add_custom_track(
                &state.pool,
                sound_id,
                &display_name,
                "",
                *dur,
                &actor.email,
            ).await?;
            created.push(track);
        }
    }

    if created.is_empty() {
        return Err(AppError::BadRequest("No .ogg files in upload".into()));
    }

    Ok(Json(created))
}

fn sanitise_filename(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' { c } else { '_' })
        .collect()
}

/// Convert a sanitised stem into a presentable display name
/// (underscores → spaces, title case).
fn pretty_name(stem: &str) -> String {
    stem.replace('_', " ")
}

/// Return the duration in seconds of an audio file via `ffprobe`.
async fn probe_duration_secs(path: &str) -> std::result::Result<i64, String> {
    let out = tokio::process::Command::new("ffprobe")
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path,
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    let txt = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let secs: f64 = txt.parse().map_err(|e: std::num::ParseFloatError| e.to_string())?;
    Ok(secs.round() as i64)
}

/// Losslessly extract `[start, start+duration]` from `input` into `output`
/// using `ffmpeg -c copy`.  Re-encoding is avoided so the operation is fast
/// and preserves audio quality.
async fn run_ffmpeg_split(
    input:    &str,
    output:   &str,
    start:    i64,
    duration: i64,
) -> std::result::Result<(), String> {
    let out = tokio::process::Command::new("ffmpeg")
        .args([
            "-y",                 // overwrite output
            "-loglevel", "error",
            "-ss", &start.to_string(),
            "-i",  input,
            "-t",  &duration.to_string(),
            "-c",  "copy",
            output,
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

/// Remove a registered custom track entry.
pub async fn remove_custom_track(
    State(state): State<AppState>,
    actor: AuthUser,
    axum::extract::Path(sound_id): axum::extract::Path<String>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "music.play")?;

    // Best-effort: remove the image file too if one is registered.
    if let Ok(Some(t)) = music_queue::get_custom_track(&state.pool, &sound_id).await {
        if let Some(fname) = t.image_filename {
            let path = format!("{TRACK_IMAGE_DIR}/{fname}");
            let _ = tokio::fs::remove_file(path).await;
        }
    }

    let found = music_queue::remove_custom_track(&state.pool, &sound_id).await?;
    if !found {
        return Err(AppError::NotFound(format!("Custom track '{sound_id}' not found")));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ── POST /api/music/tracks/:sound_id/image ────────────────────────────────────

const TRACK_IMAGE_DIR: &str = "/opt/redstonecipher/www/uploads/music/images";

/// Upload artwork for a custom track (multipart form-data field `image`,
/// accepts PNG/JPEG/WebP up to 2 MB).  Replaces any existing image.
pub async fn upload_track_image(
    State(state): State<AppState>,
    actor: AuthUser,
    axum::extract::Path(sound_id): axum::extract::Path<String>,
    mut multipart: axum::extract::Multipart,
) -> Result<Json<serde_json::Value>> {
    crate::auth::middleware::require_perm(&actor, "music.play")?;

    // Confirm the track exists and is custom
    let track = music_queue::get_custom_track(&state.pool, &sound_id).await?
        .ok_or_else(|| AppError::NotFound(format!("Custom track '{sound_id}' not found")))?;

    tokio::fs::create_dir_all(TRACK_IMAGE_DIR).await
        .map_err(|e| AppError::ExternalCommand(format!("create image dir: {e}")))?;

    let mut bytes: Option<Vec<u8>> = None;
    let mut content_type: Option<String> = None;
    while let Some(field) = multipart.next_field().await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
    {
        if field.name() == Some("image") {
            content_type = field.content_type().map(|s| s.to_string());
            let data = field.bytes().await
                .map_err(|e| AppError::BadRequest(e.to_string()))?;
            if data.len() > 2 * 1024 * 1024 {
                return Err(AppError::BadRequest("Image must be ≤ 2 MB".into()));
            }
            bytes = Some(data.to_vec());
        }
    }

    let data = bytes.ok_or_else(|| AppError::BadRequest("Missing multipart field 'image'".into()))?;

    let ext = match content_type.as_deref() {
        Some("image/png")  => "png",
        Some("image/jpeg") | Some("image/jpg") => "jpg",
        Some("image/webp") => "webp",
        Some("image/gif")  => "gif",
        _ => return Err(AppError::BadRequest("Image must be PNG, JPEG, WebP, or GIF".into())),
    };

    // Derive a deterministic filename from the sound_id (sanitised) plus ext.
    let safe = track.sound_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect::<String>();
    let filename = format!("{safe}.{ext}");
    let path = format!("{TRACK_IMAGE_DIR}/{filename}");

    // Remove any previously-stored image with a different extension
    if let Some(prev) = track.image_filename.as_ref() {
        if prev != &filename {
            let _ = tokio::fs::remove_file(format!("{TRACK_IMAGE_DIR}/{prev}")).await;
        }
    }

    tokio::fs::write(&path, &data).await
        .map_err(|e| AppError::ExternalCommand(format!("write image: {e}")))?;

    music_queue::set_custom_track_image(&state.pool, &sound_id, Some(&filename)).await?;

    Ok(Json(serde_json::json!({
        "url": format!("/uploads/music/images/{filename}"),
    })))
}

/// Remove a custom track's image (keeps the track itself).
pub async fn delete_track_image(
    State(state): State<AppState>,
    actor: AuthUser,
    axum::extract::Path(sound_id): axum::extract::Path<String>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "music.play")?;

    let track = music_queue::get_custom_track(&state.pool, &sound_id).await?
        .ok_or_else(|| AppError::NotFound(format!("Custom track '{sound_id}' not found")))?;

    if let Some(fname) = track.image_filename {
        let _ = tokio::fs::remove_file(format!("{TRACK_IMAGE_DIR}/{fname}")).await;
    }
    music_queue::set_custom_track_image(&state.pool, &sound_id, None).await?;

    Ok(StatusCode::NO_CONTENT)
}

// ── POST /api/music/resource-pack ─────────────────────────────────────────────

const PACK_PATH: &str = "/opt/redstonecipher/www/resource-pack.zip";
const PACK_URL:  &str = "https://example.com/resource-pack.zip";

// ── Sound detection ────────────────────────────────────────────────────────────

/// One sound event detected from a resource pack's sounds.json.
#[derive(Clone, serde::Serialize)]
pub struct DetectedSound {
    /// Full Minecraft namespaced ID, e.g. `redstonecipher:music.my_song`.
    pub sound_id: String,
    /// First audio file path in the sounds array (without `.ogg`),
    /// e.g. `redstonecipher/music/my_song`.
    pub path: String,
}

/// Parse every `assets/<namespace>/sounds.json` in the zip at `pack_path`
/// and return all detected sound events as `DetectedSound` entries.
fn parse_pack_sounds(pack_path: &str) -> Vec<DetectedSound> {
    let file = match std::fs::File::open(pack_path) {
        Ok(f)  => f,
        Err(_) => return vec![],
    };
    let mut archive = match zip::ZipArchive::new(file) {
        Ok(a)  => a,
        Err(_) => return vec![],
    };

    let mut out: Vec<DetectedSound> = vec![];

    for i in 0..archive.len() {
        let mut entry = match archive.by_index(i) {
            Ok(e)  => e,
            Err(_) => continue,
        };

        // Only process assets/<namespace>/sounds.json
        let name = entry.name().to_owned();
        let parts: Vec<&str> = name.splitn(4, '/').collect();
        if parts.len() != 3
            || parts[0] != "assets"
            || parts[2] != "sounds.json"
        {
            continue;
        }
        let namespace = parts[1].to_owned();

        let mut content = String::new();
        if entry.read_to_string(&mut content).is_err() {
            continue;
        }
        let map: serde_json::Map<String, serde_json::Value> =
            match serde_json::from_str(&content) {
                Ok(m)  => m,
                Err(_) => continue,
            };

        for (event_key, event_val) in &map {
            // The first sound entry's "name" (can be a plain string or an object).
            let path = event_val
                .get("sounds")
                .and_then(|s| s.as_array())
                .and_then(|arr| arr.first())
                .and_then(|first| {
                    first.as_str()
                        .map(|s| s.to_owned())
                        .or_else(|| {
                            first.get("name")
                                .and_then(|n| n.as_str())
                                .map(|s| s.to_owned())
                        })
                })
                .unwrap_or_default();

            out.push(DetectedSound {
                sound_id: format!("{}:{}", namespace, event_key),
                path,
            });
        }
    }

    out.sort_by(|a, b| a.sound_id.cmp(&b.sound_id));
    out
}

/// GET /api/music/resource-pack/sounds
///
/// Parse the installed resource pack's sounds.json files and return every
/// detected sound event so the frontend can offer one-click registration.
pub async fn get_pack_sounds(_: AuthUser) -> Json<Vec<DetectedSound>> {
    Json(parse_pack_sounds(PACK_PATH))
}

/// Upload a resource pack zip.  Saves it as a static file the game client can
/// download, computes its SHA-1, and writes resource-pack / resource-pack-sha1
/// into server.properties (no restart — takes effect for players who (re)join).
pub async fn upload_resource_pack(
    State(state): State<AppState>,
    actor: AuthUser,
    mut multipart: axum::extract::Multipart,
) -> Result<Json<serde_json::Value>> {
    crate::auth::middleware::require_perm(&actor, "music.play")?;

    let mut file_bytes: Option<Vec<u8>> = None;
    while let Some(field) = multipart.next_field().await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
    {
        if field.name() == Some("pack") {
            let data = field.bytes().await
                .map_err(|e| AppError::BadRequest(e.to_string()))?;
            file_bytes = Some(data.to_vec());
        }
    }

    let bytes = file_bytes
        .ok_or_else(|| AppError::BadRequest("Missing multipart field 'pack'".into()))?;

    if bytes.len() < 4 || &bytes[..4] != b"PK\x03\x04" {
        return Err(AppError::BadRequest("File must be a valid .zip archive".into()));
    }

    tokio::fs::write(PACK_PATH, &bytes).await
        .map_err(|e| AppError::ExternalCommand(format!("Could not save pack: {e}")))?
    ;

    // sha1sum is available on the Debian web server.
    let sha1_out = tokio::process::Command::new("sha1sum")
        .arg(PACK_PATH)
        .output()
        .await
        .map_err(|e| AppError::ExternalCommand(e.to_string()))?;
    let sha1 = String::from_utf8_lossy(&sha1_out.stdout)
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_string();

    // Update server.properties on the MC server (no restart).
    let mut props = std::collections::HashMap::new();
    props.insert("resource-pack".to_string(),      PACK_URL.to_string());
    props.insert("resource-pack-sha1".to_string(), sha1.clone());
    if let Err(e) = crate::minecraft::properties::apply_updates_no_restart(&state.config, &props).await {
        tracing::warn!("Could not update server.properties with resource-pack URL: {e}");
    }

    let detected = parse_pack_sounds(PACK_PATH);

    Ok(Json(serde_json::json!({
        "url":        PACK_URL,
        "sha1":       sha1,
        "size_bytes": bytes.len(),
        "sounds":     detected,
    })))
}

/// Return info about the currently installed resource pack (or {installed:false}).
pub async fn get_resource_pack(_: AuthUser) -> Json<serde_json::Value> {
    match tokio::fs::metadata(PACK_PATH).await {
        Ok(meta) => {
            let sha1_out = tokio::process::Command::new("sha1sum")
                .arg(PACK_PATH)
                .output()
                .await
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout)
                    .split_whitespace().next().unwrap_or("").to_string())
                .unwrap_or_default();
            Json(serde_json::json!({
                "installed":  true,
                "url":        PACK_URL,
                "sha1":       sha1_out,
                "size_bytes": meta.len(),
            }))
        }
        Err(_) => Json(serde_json::json!({ "installed": false })),
    }
}

/// Remove the installed resource pack and clear server.properties entries.
pub async fn delete_resource_pack(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "music.play")?;

    let _ = tokio::fs::remove_file(PACK_PATH).await;

    let mut props = std::collections::HashMap::new();
    props.insert("resource-pack".to_string(),      String::new());
    props.insert("resource-pack-sha1".to_string(), String::new());
    if let Err(e) = crate::minecraft::properties::apply_updates_no_restart(&state.config, &props).await {
        tracing::warn!("Could not clear resource-pack from server.properties: {e}");
    }

    Ok(StatusCode::NO_CONTENT)
}

// ── GET /api/music/stream ──────────────────────────────────────────────────────

/// Server-sent events stream of `MusicStatePayload` snapshots.
/// Fires whenever the queue or now-playing state changes.
pub async fn stream(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<impl IntoResponse> {
    crate::auth::middleware::require_perm(&actor, "music.play")?;

    let rx = state.music_tx.subscribe();
    let broadcast_stream = BroadcastStream::new(rx);

    let sse_stream = broadcast_stream.filter_map(
        |result| -> Option<std::result::Result<Event, std::convert::Infallible>> {
            match result {
                Ok(payload) => match serde_json::to_string(&*payload) {
                    Ok(json) => Some(Ok(Event::default().data(json))),
                    Err(e) => {
                        warn!("music SSE: serialize error: {e}");
                        None
                    }
                },
                Err(e) => {
                    let n = match e {
                        tokio_stream::wrappers::errors::BroadcastStreamRecvError::Lagged(n) => n,
                    };
                    warn!("music SSE: client lagged by {n} events");
                    Some(Ok(Event::default()
                        .event("lagged")
                        .data(format!("{{\"missed\":{n}}}"))))
                }
            }
        },
    );

    Ok(Sse::new(sse_stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text(":keepalive"),
    ))
}

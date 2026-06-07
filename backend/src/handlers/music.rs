use std::io::Read as _;
use std::time::Duration;

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
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
/// `audio_url` is set for custom tracks pointing to the (UUID-named) OGG
/// behind the public `/uploads/music/` mount.
#[derive(Clone, serde::Serialize)]
pub struct CatalogEntry {
    pub id:            String,
    pub display_name:  String,
    pub artist:        String,
    pub duration_secs: u32,
    pub is_custom:     bool,
    pub image_url:     Option<String>,
    pub audio_url:     Option<String>,
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
        audio_url:     None,
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
            audio_url:     t.storage_filename
                .map(|f| format!("/uploads/music/{f}")),
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

    // Rebuild resource pack so the new track is available in-game.
    if let Err(e) = rebuild_resource_pack(&state.pool, &state.config).await {
        tracing::warn!("add_custom_track: pack rebuild failed: {e}");
    }

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

    // Rebuild resource pack in case the sound_id mapping changed.
    if let Err(e) = rebuild_resource_pack(&state.pool, &state.config).await {
        tracing::warn!("update_custom_track: pack rebuild failed: {e}");
    }

    Ok(StatusCode::NO_CONTENT)
}

// ── POST /api/music/upload ────────────────────────────────────────────────────

/// Upload one or more `.ogg` or `.mp3` files. `.mp3` files are transcoded to
/// OGG Vorbis (the only codec Minecraft resource packs support) on the server.
/// Each file is stored under the resource-pack sounds directory, registered as
/// a custom track, and returned in the response.
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

    // OGGs land in /data/ — outside the nginx web root — so they're never
    // directly downloadable.  The only way clients see them is via the
    // bundled, UUID-rotating resource pack.
    const UPLOAD_DIR: &str = UPLOAD_DIR_MUSIC;
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

        let lower  = original_name.to_lowercase();
        let is_ogg = lower.ends_with(".ogg");
        let is_mp3 = lower.ends_with(".mp3");
        if !is_ogg && !is_mp3 {
            return Err(AppError::BadRequest(
                format!("'{original_name}' is not an .ogg or .mp3 file")
            ));
        }

        let bytes = field.bytes().await
            .map_err(|e| AppError::BadRequest(e.to_string()))?;

        // Sanitise filename — used for the sound_id (human-readable),
        // NOT for the on-disk path.  On-disk uses a UUID so the public
        // URL isn't trivially scrapable.
        let base = sanitise_filename(&original_name);
        let stem = base.trim_end_matches(".ogg").trim_end_matches(".mp3");
        if stem.is_empty() {
            return Err(AppError::BadRequest("Empty filename after sanitisation".into()));
        }
        let upload_uuid = uuid::Uuid::new_v4().simple().to_string();
        let storage_filename = format!("{upload_uuid}.ogg");

        // The on-disk artifact is ALWAYS OGG Vorbis. .ogg uploads are written
        // straight through; .mp3 uploads are transcoded to Vorbis via ffmpeg
        // (a temp .mp3 is written, converted, then removed).
        let raw_path = format!("{UPLOAD_DIR}/{storage_filename}");
        if is_mp3 {
            let tmp_mp3 = format!("{UPLOAD_DIR}/{upload_uuid}.src.mp3");
            tokio::fs::write(&tmp_mp3, &bytes).await
                .map_err(|e| AppError::ExternalCommand(format!("write {tmp_mp3}: {e}")))?;
            drop(bytes);
            if let Err(e) = run_ffmpeg_to_vorbis(&tmp_mp3, &raw_path).await {
                let _ = tokio::fs::remove_file(&tmp_mp3).await;
                return Err(AppError::ExternalCommand(
                    format!("Failed to convert '{original_name}' to OGG Vorbis: {e}")
                ));
            }
            let _ = tokio::fs::remove_file(&tmp_mp3).await;
        } else {
            tokio::fs::write(&raw_path, &bytes).await
                .map_err(|e| AppError::ExternalCommand(format!("write {raw_path}: {e}")))?;
            // Memory pressure: drop the buffered upload bytes asap.
            drop(bytes);
        }

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
            // Short file — register the upload as a single track.
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
            // Record the UUID-named on-disk file.
            let _ = music_queue::set_custom_track_storage(
                &state.pool, &sound_id, &storage_filename,
            ).await;
            created.push(music_queue::CustomTrack {
                storage_filename: Some(storage_filename.clone()),
                ..track
            });
            continue;
        }

        // ── Split path ────────────────────────────────────────────────
        let total_chunks = ((duration as f64) / (CHUNK_SECS as f64)).ceil() as i64;
        // (sound_id, file_path, storage_filename, idx, dur)
        let mut chunk_paths: Vec<(String, String, String, i64, i64)> = vec![];
        for idx in 0..total_chunks {
            let start    = idx * CHUNK_SECS;
            let this_dur = (duration - start).min(CHUNK_SECS);

            let chunk_stem    = format!("{stem}_part{}", idx + 1);
            let chunk_uuid    = uuid::Uuid::new_v4().simple().to_string();
            let chunk_storage = format!("{chunk_uuid}.ogg");
            let chunk_path    = format!("{UPLOAD_DIR}/{chunk_storage}");

            if let Err(e) = run_ffmpeg_split(&raw_path, &chunk_path, start, this_dur).await {
                // Clean up any partial outputs.
                for (_, p, _, _, _) in &chunk_paths {
                    let _ = tokio::fs::remove_file(p).await;
                }
                let _ = tokio::fs::remove_file(&chunk_path).await;
                return Err(AppError::ExternalCommand(format!("ffmpeg split: {e}")));
            }

            chunk_paths.push((
                format!("redstonecipher:music.{chunk_stem}"),
                chunk_path,
                chunk_storage,
                idx + 1,
                this_dur,
            ));
        }

        // Remove the original — splits are the canonical artifacts now.
        let _ = tokio::fs::remove_file(&raw_path).await;

        // Register each split.  Naming "Original Name (1/N)" so the user
        // can pick all of them in the disc modal to play them back-to-back.
        for (sound_id, _path, storage, n, dur) in &chunk_paths {
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
            let _ = music_queue::set_custom_track_storage(
                &state.pool, sound_id, storage,
            ).await;
            created.push(music_queue::CustomTrack {
                storage_filename: Some(storage.clone()),
                ..track
            });
        }
    }

    if created.is_empty() {
        return Err(AppError::BadRequest("No .ogg or .mp3 files in upload".into()));
    }

    // Auto-rebuild the server resource pack to include the new tracks.
    if let Err(e) = rebuild_resource_pack(&state.pool, &state.config).await {
        tracing::warn!("upload_oggs: pack rebuild failed: {e}");
    }

    Ok(Json(created))
}

fn sanitise_filename(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' { c } else { '_' })
        .collect::<String>()
        .to_ascii_lowercase()
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

/// Transcode any audio input (e.g. an uploaded `.mp3`) to OGG **Vorbis**.
///
/// Minecraft resource packs only support Vorbis-in-Ogg — NOT Opus — so the
/// audio codec is pinned to `libvorbis`. `-q:a 5` is ~160 kbps VBR, transparent
/// for game music. `-vn` drops any embedded cover-art video stream so ffmpeg
/// doesn't choke trying to copy it into the Ogg container.
async fn run_ffmpeg_to_vorbis(
    input:  &str,
    output: &str,
) -> std::result::Result<(), String> {
    let out = tokio::process::Command::new("ffmpeg")
        .args([
            "-y",
            "-loglevel", "error",
            "-i", input,
            "-vn",
            "-c:a", "libvorbis",
            "-q:a", "5",
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

    // Auto-rebuild the server resource pack without the removed track.
    if let Err(e) = rebuild_resource_pack(&state.pool, &state.config).await {
        tracing::warn!("remove_custom_track: pack rebuild failed: {e}");
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

    // Use a UUID for the on-disk filename so the public URL isn't trivially
    // scrapable from the (possibly-known) sound_id.
    let image_uuid = uuid::Uuid::new_v4().simple().to_string();
    let filename = format!("{image_uuid}.{ext}");
    let path = format!("{TRACK_IMAGE_DIR}/{filename}");

    // Remove the previously-stored image (different UUID).
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
//
// Resource-pack and OGG storage layout:
//
//   • Pack zip  → /opt/redstonecipher/www/packs/<session-uuid>/resource-pack.zip
//     Each rebuild mints a fresh UUID — clients see a brand-new URL on every
//     pack change, and any older URL (or a guessed one) returns 404.
//     Old session dirs are pruned to PACK_SESSIONS_KEEP most-recent.
//
//   • OGGs       → /opt/redstonecipher/data/uploads/music/<uuid>.ogg
//     Kept OUTSIDE the nginx web root so MC clients (and anyone else) can
//     never download the raw audio directly — the only way to reach them
//     is through the bundled pack zip.
//
// `PACK_URL_HOST` is built into the URLs we write to server.properties.

const PACK_BASE_DIR:      &str  = "/opt/redstonecipher/www/packs";
const PACK_URL_HOST:      &str  = "https://redstonecipher.com";
const PACK_FILENAME:      &str  = "resource-pack.zip";
const PACK_SESSIONS_KEEP: usize = 3;

const TEMPLATE_PATH:      &str = "/opt/redstonecipher/www/resource-pack-template.zip";

const UPLOAD_DIR_MUSIC:   &str = "/opt/redstonecipher/data/uploads/music";
/// Old public location of OGG files.  Still searched by `find_track_ogg`
/// during the rolling migration to the private path above.
const LEGACY_PUBLIC_MUSIC: &str = "/opt/redstonecipher/www/uploads/music";
/// Even older legacy custom-music dir (pre-uploads).
const LEGACY_CUSTOM_MUSIC: &str = "/opt/redstonecipher/data/custom-music";

/// A single resource-pack session — minted on each rebuild/upload so the
/// public URL rotates and old links go dead.
///
/// `pub` so the binary crate (main.rs) can pass it around for the
/// startup self-heal; everything except `path()` stays opaque.
#[derive(Debug, Clone)]
pub struct PackSession { uuid: String }

impl PackSession {
    fn new() -> Self {
        Self { uuid: uuid::Uuid::new_v4().simple().to_string() }
    }
    fn dir(&self)  -> String { format!("{PACK_BASE_DIR}/{}", self.uuid) }
    /// Absolute path of the pack zip on the web server's filesystem.
    pub fn path(&self) -> String { format!("{}/{PACK_FILENAME}", self.dir()) }
    fn url(&self)  -> String { format!("{PACK_URL_HOST}/packs/{}/{PACK_FILENAME}", self.uuid) }
}

/// Resolve the currently-active session by reading the `resource-pack`
/// value from server.properties and pulling the UUID out of the URL.
/// Returns `None` if no pack is configured or the URL doesn't match the
/// `/packs/<uuid>/resource-pack.zip` shape (e.g. a legacy flat path or
/// a manually-set external URL).
pub async fn current_pack_session(
    cfg: &crate::config::Config,
) -> Option<PackSession> {
    let props = crate::minecraft::properties::get_all(cfg).await.ok()?;
    let raw   = props.get("resource-pack")?.clone();
    if raw.trim().is_empty() { return None; }
    // server.properties stores `\:` as the escape — Properties format.
    let clean  = raw.replace("\\:", ":");
    let prefix = format!("{PACK_URL_HOST}/packs/");
    let suffix = format!("/{PACK_FILENAME}");
    let uuid   = clean.strip_prefix(&prefix)?.strip_suffix(&suffix)?.to_string();
    Some(PackSession { uuid })
}

/// Best-effort cleanup of stale pack-session directories.  Sorts by
/// mtime and drops everything past `PACK_SESSIONS_KEEP` so any client
/// still mid-download on the previous one or two URLs can finish.
async fn cleanup_old_pack_sessions(keep: usize) {
    use std::time::SystemTime;
    let mut entries: Vec<(SystemTime, std::path::PathBuf)> = Vec::new();
    let mut rd = match tokio::fs::read_dir(PACK_BASE_DIR).await {
        Ok(rd) => rd,
        Err(_) => return,
    };
    while let Ok(Some(e)) = rd.next_entry().await {
        let mtime = e.metadata().await.ok()
            .and_then(|m| m.modified().ok())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        entries.push((mtime, e.path()));
    }
    entries.sort_by(|a, b| b.0.cmp(&a.0)); // newest first
    for (_, path) in entries.into_iter().skip(keep) {
        if let Err(e) = tokio::fs::remove_dir_all(&path).await {
            tracing::warn!("pack cleanup: remove {:?} failed: {e}", path);
        }
    }
    // Also sweep the legacy flat /resource-pack.zip if it's still around
    // from before the URL-rotation change.  Idempotent.
    let _ = tokio::fs::remove_file("/opt/redstonecipher/www/resource-pack.zip").await;
}

/// Rebuild the server resource pack from the template + all custom tracks.
///
/// 1. Opens the template zip (pack.mcmeta + skeleton).
/// 2. Finds OGG files for every custom track in the DB.
/// 3. Builds a fresh `sounds.json` with entries for every found track.
/// 4. Writes the new pack to PACK_PATH, computes SHA-1.
/// 5. Updates `server.properties` on the MC server (no restart needed).
///
/// Best-effort — returns Ok(()) even when individual tracks are missing.
pub async fn rebuild_resource_pack(
    pool: &sqlx::SqlitePool,
    cfg:  &crate::config::Config,
) -> anyhow::Result<()> {
    // 1. Read the template zip into memory.
    let tpl_bytes = tokio::fs::read(TEMPLATE_PATH).await
        .map_err(|e| anyhow::anyhow!("read template: {e}"))?;
    let tpl_reader = std::io::Cursor::new(&tpl_bytes);
    let mut tpl_archive = zip::ZipArchive::new(tpl_reader)
        .map_err(|e| anyhow::anyhow!("parse template zip: {e}"))?;

    // 2. Start a new zip in memory.
    let buf = std::io::Cursor::new(Vec::<u8>::new());
    let mut writer = zip::ZipWriter::new(buf);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // Copy template entries except sounds.json (we'll regenerate it).
    for i in 0..tpl_archive.len() {
        let mut entry = tpl_archive.by_index(i)?;
        let name = entry.name().to_owned();
        if name.ends_with("sounds.json") || name.ends_with("README.txt") {
            continue;
        }
        if entry.is_dir() {
            writer.add_directory(&name, opts)?;
        } else {
            let mut data = Vec::new();
            entry.read_to_end(&mut data)?;
            writer.start_file(&name, opts)?;
            std::io::Write::write_all(&mut writer, &data)?;
        }
    }

    // 3. Gather all custom tracks and find their OGG files.
    let tracks = music_queue::list_custom_tracks(pool).await.unwrap_or_default();
    let mut sounds_map = serde_json::Map::new();
    let mut included = 0u32;

    for t in &tracks {
        // Derive stem from sound_id: "redstonecipher:music.wolf_s_rain" → "wolf_s_rain"
        let stem = t.sound_id
            .strip_prefix("redstonecipher:music.")
            .unwrap_or(&t.sound_id)
            .to_ascii_lowercase();

        // Find OGG file — check UUID storage first, then stem match in both dirs.
        let ogg_bytes = find_track_ogg(&t.storage_filename, &stem).await;
        let ogg_bytes = match ogg_bytes {
            Some(b) => b,
            None => {
                tracing::warn!("rebuild_pack: no OGG found for {}, skipping", t.sound_id);
                continue;
            }
        };

        // Add OGG to zip: assets/redstonecipher/sounds/music/{stem}.ogg
        let zip_path = format!("assets/redstonecipher/sounds/music/{stem}.ogg");
        writer.start_file(&zip_path, opts)?;
        std::io::Write::write_all(&mut writer, &ogg_bytes)?;

        // Add entry to sounds.json
        sounds_map.insert(
            format!("music.{stem}"),
            serde_json::json!({
                "sounds": [{
                    "name": format!("redstonecipher:music/{stem}"),
                    "stream": true
                }]
            }),
        );
        included += 1;
    }

    // 4. Write sounds.json into the zip.
    let sounds_json = serde_json::to_string_pretty(&sounds_map)
        .unwrap_or_else(|_| "{}".to_string());
    writer.start_file("assets/redstonecipher/sounds.json", opts)?;
    std::io::Write::write_all(&mut writer, sounds_json.as_bytes())?;

    let finished = writer.finish()?;
    let pack_bytes = finished.into_inner();

    // 5. Mint a fresh session UUID and write the pack into its own
    //    directory.  The URL embeds this UUID so any old URL (or a
    //    guessed one) returns 404 once we've rebuilt.
    let session = PackSession::new();
    tokio::fs::create_dir_all(session.dir()).await
        .map_err(|e| anyhow::anyhow!("mkdir {}: {e}", session.dir()))?;
    tokio::fs::write(session.path(), &pack_bytes).await
        .map_err(|e| anyhow::anyhow!("write pack: {e}"))?;

    // 6. Compute SHA-1.
    let sha1_out = tokio::process::Command::new("sha1sum")
        .arg(session.path())
        .output()
        .await
        .map_err(|e| anyhow::anyhow!("sha1sum: {e}"))?;
    let sha1 = String::from_utf8_lossy(&sha1_out.stdout)
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_string();

    // 7. Update server.properties on MC server with the new URL + SHA-1.
    let mut props = std::collections::HashMap::new();
    props.insert("resource-pack".to_string(),      session.url());
    props.insert("resource-pack-sha1".to_string(), sha1.clone());
    if let Err(e) = crate::minecraft::properties::apply_updates_no_restart(cfg, &props).await {
        tracing::warn!("rebuild_pack: could not update server.properties: {e}");
    }

    // 8. Restart the MC server so it sends the new pack URL/SHA-1 to
    //    clients on their next join.  server.properties is only read at
    //    startup, so without this players keep the stale pack.
    //
    //    `--no-block` returns immediately after systemd queues the job —
    //    a graceful Paper restart can easily take 60-90 s (autosave +
    //    plugin shutdown + chunk load on cold start), well over our 30 s
    //    SSH timeout.  We don't need to wait for it to come back; clients
    //    will retry the resource pack on reconnect.
    match crate::gcloud::ssh::run(cfg, "sudo systemctl restart --no-block minecraft").await {
        Ok(_)  => {
            tracing::info!("rebuild_pack: restarted MC server for new resource pack");
            // The kick interrupted any in-progress zone music, so any
            // `finished_at` cooldown anchors and stale `is_playing` flags
            // for the just-disconnected players would otherwise block the
            // new pack's zones from triggering on reconnect.  Reset both
            // so players get a clean slate.
            match crate::db::music_zones::reset_all_for_server_restart(pool).await {
                Ok(n) if n > 0 => tracing::info!(
                    "rebuild_pack: cleared {n} stale zone state row(s) (cooldown + playing)",
                ),
                Ok(_)  => {},
                Err(e) => tracing::warn!("rebuild_pack: failed to reset zone state: {e}"),
            }
        }
        Err(e) => tracing::warn!("rebuild_pack: MC restart failed (pack still updated): {e}"),
    }

    tracing::info!(
        "rebuild_pack: built resource pack with {included}/{} tracks, sha1={sha1}, session={}",
        tracks.len(), session.uuid,
    );

    // 9. Prune older session dirs.  Keep the last PACK_SESSIONS_KEEP so
    //    clients still mid-download on the previous URL can finish.
    cleanup_old_pack_sessions(PACK_SESSIONS_KEEP).await;

    Ok(())
}

/// Search for an OGG file for a custom track, checking multiple locations.
///
/// Search order:
///   1. UUID-named file in the new private dir (canonical location)
///   2. UUID-named file in the legacy public dir (transition compat)
///   3. Stem-named file in any known dir (very-old uploads)
async fn find_track_ogg(storage_filename: &Option<String>, stem: &str) -> Option<Vec<u8>> {
    // 1+2. UUID-named file.
    if let Some(ref sf) = storage_filename {
        for dir in [UPLOAD_DIR_MUSIC, LEGACY_PUBLIC_MUSIC] {
            let path = format!("{dir}/{sf}");
            if let Ok(b) = tokio::fs::read(&path).await {
                return Some(b);
            }
        }
    }

    // 3. Stem-named file in uploads dir (legacy or pre-UUID).
    for dir in [UPLOAD_DIR_MUSIC, LEGACY_PUBLIC_MUSIC, LEGACY_CUSTOM_MUSIC] {
        // Try exact stem match first.
        let path = format!("{dir}/{stem}.ogg");
        if let Ok(b) = tokio::fs::read(&path).await {
            return Some(b);
        }
        // Try case-insensitive scan.
        if let Ok(mut entries) = tokio::fs::read_dir(dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let fname = entry.file_name().to_string_lossy().to_string();
                if fname.to_ascii_lowercase() == format!("{stem}.ogg") {
                    if let Ok(b) = tokio::fs::read(entry.path()).await {
                        return Some(b);
                    }
                }
            }
        }
    }

    None
}

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
pub async fn get_pack_sounds(
    State(state): State<AppState>,
    _: AuthUser,
) -> Json<Vec<DetectedSound>> {
    let sounds = match current_pack_session(&state.config).await {
        Some(s) => parse_pack_sounds(&s.path()),
        None    => Vec::new(),
    };
    Json(sounds)
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

    let session = PackSession::new();
    tokio::fs::create_dir_all(session.dir()).await
        .map_err(|e| AppError::ExternalCommand(format!("mkdir {}: {e}", session.dir())))?;
    tokio::fs::write(session.path(), &bytes).await
        .map_err(|e| AppError::ExternalCommand(format!("Could not save pack: {e}")))?;

    // sha1sum is available on the Debian web server.
    let sha1_out = tokio::process::Command::new("sha1sum")
        .arg(session.path())
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
    props.insert("resource-pack".to_string(),      session.url());
    props.insert("resource-pack-sha1".to_string(), sha1.clone());
    if let Err(e) = crate::minecraft::properties::apply_updates_no_restart(&state.config, &props).await {
        tracing::warn!("Could not update server.properties with resource-pack URL: {e}");
    }

    let detected = parse_pack_sounds(&session.path());

    // Prune older session dirs.
    cleanup_old_pack_sessions(PACK_SESSIONS_KEEP).await;

    Ok(Json(serde_json::json!({
        "url":        session.url(),
        "sha1":       sha1,
        "size_bytes": bytes.len(),
        "sounds":     detected,
    })))
}

/// Return info about the currently installed resource pack (or {installed:false}).
pub async fn get_resource_pack(
    State(state): State<AppState>,
    _: AuthUser,
) -> Json<serde_json::Value> {
    let Some(session) = current_pack_session(&state.config).await else {
        return Json(serde_json::json!({ "installed": false }));
    };
    match tokio::fs::metadata(&session.path()).await {
        Ok(meta) => {
            let sha1_out = tokio::process::Command::new("sha1sum")
                .arg(&session.path())
                .output()
                .await
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout)
                    .split_whitespace().next().unwrap_or("").to_string())
                .unwrap_or_default();
            Json(serde_json::json!({
                "installed":  true,
                "url":        session.url(),
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

    // Remove the currently-referenced session dir (if any).
    if let Some(session) = current_pack_session(&state.config).await {
        let _ = tokio::fs::remove_dir_all(session.dir()).await;
    }
    // And wipe any orphaned legacy file.
    let _ = tokio::fs::remove_file("/opt/redstonecipher/www/resource-pack.zip").await;

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

// ── GET /api/music/tracks/:sound_id/preview ──────────────────────────────────
//
// Stream the OGG body of a custom track to the browser so users can audition
// it on the Music page.  The file itself lives outside the public web root
// (/opt/redstonecipher/data/uploads/music/<uuid>.ogg) — this handler is the
// ONLY way to fetch it, gated behind the `music.play` permission and the
// session JWT cookie.
//
// Supports HTTP Range so HTML5 `<audio>` can seek without buffering the
// whole file.  Vanilla disc tracks aren't files we own, so they 404.

pub async fn preview_track(
    State(state):   State<AppState>,
    actor:          AuthUser,
    Path(sound_id): Path<String>,
    headers:        HeaderMap,
) -> Result<Response> {
    crate::auth::middleware::require_perm(&actor, "music.play")?;

    // Vanilla tracks have no on-disk file — we'd need a different source.
    if !sound_id.starts_with("redstonecipher:music.") {
        return Err(AppError::NotFound(
            "Preview is only available for custom tracks".into(),
        ));
    }

    // Look up the track row so we can resolve its storage_filename.
    let track = music_queue::list_custom_tracks(&state.pool).await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("list_custom_tracks: {e}")))?
        .into_iter()
        .find(|t| t.sound_id == sound_id)
        .ok_or_else(|| AppError::NotFound(format!("Track not found: {sound_id}")))?;

    let stem = sound_id
        .strip_prefix("redstonecipher:music.")
        .unwrap_or(&sound_id)
        .to_ascii_lowercase();

    let bytes = find_track_ogg(&track.storage_filename, &stem).await
        .ok_or_else(|| AppError::NotFound(format!("OGG file missing for {sound_id}")))?;

    let total = bytes.len() as u64;

    // Honour Range if the client sent one.  HTML5 <audio> needs this for
    // seeking — without it, the browser has to re-download from byte 0
    // every time you scrub.
    let range = headers.get(header::RANGE).and_then(|h| h.to_str().ok());
    if let Some((start, end)) = range.and_then(|r| parse_byte_range(r, total)) {
        let slice = bytes[start as usize..=end as usize].to_vec();
        let len   = end - start + 1;
        return Ok(Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_TYPE,   "audio/ogg")
            .header(header::CONTENT_LENGTH, len.to_string())
            .header(header::ACCEPT_RANGES,  "bytes")
            .header(header::CONTENT_RANGE,  format!("bytes {start}-{end}/{total}"))
            .header(header::CACHE_CONTROL,  "private, max-age=3600")
            .body(Body::from(slice))
            .unwrap());
    }

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE,   "audio/ogg")
        .header(header::CONTENT_LENGTH, total.to_string())
        .header(header::ACCEPT_RANGES,  "bytes")
        .header(header::CACHE_CONTROL,  "private, max-age=3600")
        .body(Body::from(bytes))
        .unwrap())
}

/// Parse a single `bytes=START-END` range header.  Returns inclusive
/// (start, end) clamped to `total`, or None for syntactically invalid or
/// multi-range requests we don't bother supporting.
fn parse_byte_range(raw: &str, total: u64) -> Option<(u64, u64)> {
    let spec = raw.strip_prefix("bytes=")?;
    if spec.contains(',') { return None; } // multi-range — not supported
    let (a, b) = spec.split_once('-')?;
    let last = total.checked_sub(1)?;
    let (start, end) = match (a.trim(), b.trim()) {
        // bytes=N-       → from N to EOF
        (s, "") if !s.is_empty() => (s.parse().ok()?, last),
        // bytes=-N       → last N bytes
        ("", e) if !e.is_empty() => {
            let n: u64 = e.parse().ok()?;
            (total.saturating_sub(n), last)
        }
        // bytes=S-E
        (s, e) if !s.is_empty() && !e.is_empty() =>
            (s.parse().ok()?, e.parse::<u64>().ok()?.min(last)),
        _ => return None,
    };
    if start > end || start > last { return None; }
    Some((start, end))
}

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
#[derive(Clone, serde::Serialize)]
pub struct CatalogEntry {
    pub id:            String,
    pub display_name:  String,
    pub artist:        String,
    pub duration_secs: u32,
    pub is_custom:     bool,
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
    }).collect();

    let custom: Vec<CatalogEntry> = music_queue::list_custom_tracks(&state.pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|t| CatalogEntry {
            id:            t.sound_id,
            display_name:  t.display_name,
            artist:        t.artist,
            duration_secs: t.duration_secs as u32,
            is_custom:     true,
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

/// Remove a registered custom track entry.
pub async fn remove_custom_track(
    State(state): State<AppState>,
    actor: AuthUser,
    axum::extract::Path(sound_id): axum::extract::Path<String>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "music.play")?;

    let found = music_queue::remove_custom_track(&state.pool, &sound_id).await?;
    if !found {
        return Err(AppError::NotFound(format!("Custom track '{sound_id}' not found")));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ── POST /api/music/resource-pack ─────────────────────────────────────────────

const PACK_PATH: &str = "/opt/redstonecipher/www/resource-pack.zip";
const PACK_URL:  &str = "https://redstonecipher.com/resource-pack.zip";

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

    Ok(Json(serde_json::json!({
        "url":        PACK_URL,
        "sha1":       sha1,
        "size_bytes": bytes.len(),
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

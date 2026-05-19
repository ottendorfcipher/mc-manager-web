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

/// Return the full static sound catalog.  No special permission needed beyond
/// being authenticated — the catalog is not sensitive data.
pub async fn list_tracks(_: AuthUser) -> Json<Vec<music::SoundEntry>> {
    Json(music::CATALOG.to_vec())
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

    let entry = music::lookup(&body.sound_id)
        .ok_or_else(|| AppError::BadRequest(format!("Unknown sound: {}", body.sound_id)))?;

    // Lock for the check-and-act to prevent two concurrent requests from both
    // seeing an idle state and firing duplicate playsound commands.
    let mut current_guard = state.music_current.lock().await;

    if current_guard.is_none() {
        // Nothing playing — start immediately.
        let _ = music::play_all(&state.config, entry.id).await;
        *current_guard = Some(CurrentTrack {
            queue_id:      0, // not popped from DB
            sound_id:      entry.id.to_string(),
            display_name:  entry.display_name.to_string(),
            artist:        entry.artist.to_string(),
            requested_by:  actor.email.clone(),
            started_at:    std::time::Instant::now(),
            duration_secs: entry.duration_secs,
        });
        drop(current_guard);
    } else {
        // Something is playing — append to the persistent queue.
        drop(current_guard);
        music_queue::enqueue(&state.pool, entry.id, entry.display_name, &actor.email).await?;
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

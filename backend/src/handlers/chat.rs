use std::sync::Arc;
use std::time::Duration;

use axum::{
    extract::{Query, State},
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
    db::{chat, players},
    error::{AppError, Result},
    gcloud::ssh,
    state::AppState,
};

// ── GET /api/chat/history ──────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct HistoryQuery {
    /// Number of messages to return. Clamped to 1–200. Defaults to 50.
    #[serde(default = "default_history_limit")]
    limit: i64,
    /// Cursor: return messages with id strictly less than this value.
    /// Omit to get the most recent `limit` messages.
    before: Option<i64>,
}

fn default_history_limit() -> i64 { 50 }

/// Returns recent broadcast messages in chronological order.
///
/// Query params:
///   `limit`  — number of messages (default 50, max 200)
///   `before` — cursor: only return messages older than this message id
pub async fn history(
    State(state): State<AppState>,
    actor: AuthUser,
    Query(params): Query<HistoryQuery>,
) -> Result<Json<Vec<chat::ChatMessage>>> {
    crate::auth::middleware::require_perm(&actor, "chat.read")?;
    let limit = params.limit.clamp(1, 200);
    let msgs = match params.before {
        Some(before_id) => chat::recent_before(&state.pool, before_id, limit).await?,
        None            => chat::recent(&state.pool, limit).await?,
    };
    Ok(Json(msgs))
}

// ── GET /api/chat/stream ───────────────────────────────────────────────────────

/// Server-sent events stream of new chat messages.
/// Clients open this once, then receive each new event as `data: <json>\n\n`.
pub async fn stream(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<impl IntoResponse> {
    crate::auth::middleware::require_perm(&actor, "chat.read")?;

    let rx = state.chat_tx.subscribe();
    let broadcast_stream = BroadcastStream::new(rx);

    let sse_stream = broadcast_stream.filter_map(|result| -> Option<std::result::Result<Event, std::convert::Infallible>> {
        match result {
            Ok(msg) => {
                match serde_json::to_string(&*msg) {
                    Ok(json) => Some(Ok(Event::default().data(json))),
                    Err(e) => {
                        warn!("chat SSE: serialize error: {e}");
                        None
                    }
                }
            }
            Err(e) => {
                // Client fell behind. Send a synthetic "lagged" marker so the
                // frontend knows to re-fetch history.
                let n = match e {
                    tokio_stream::wrappers::errors::BroadcastStreamRecvError::Lagged(n) => n,
                };
                warn!("chat SSE: client lagged by {n} messages");
                Some(Ok(Event::default()
                    .event("lagged")
                    .data(format!("{{\"missed\":{n}}}"))
                ))
            }
        }
    });

    Ok(Sse::new(sse_stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text(":keepalive"),
    ))
}

// ── POST /api/chat/send ────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct SendBody {
    /// The message text (max 256 chars).
    pub content:    String,
    /// When Some(ign), the message is a DM via /msg and is NOT persisted.
    pub target_ign: Option<String>,
}

/// Send a message to the Minecraft server.
///
/// Broadcast: formatted as `tellraw @a [...]`, persisted, and pushed to SSE.
/// DM: formatted as `/msg <target> ...`, not persisted.
pub async fn send(
    State(state): State<AppState>,
    actor: AuthUser,
    Json(body): Json<SendBody>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "chat.send")?;

    // Validate content.
    let content = body.content.trim().replace('\n', " ").replace('\r', "");
    if content.is_empty() {
        return Err(AppError::BadRequest("Message cannot be empty".into()));
    }
    if content.len() > 256 {
        return Err(AppError::BadRequest("Message exceeds 256 characters".into()));
    }

    // Resolve display name: prefer linked IGN, fall back to display portion of email.
    let links = players::list_for_user(&state.pool, &actor.email).await?;
    let linked_ign = links.first().map(|l| l.ign.clone());

    let display_as = match &linked_ign {
        Some(ign) => ign.clone(),
        None => {
            // Use the part before @ in the email as a fallback display name.
            actor
                .email
                .split('@')
                .next()
                .unwrap_or(&actor.email)
                .to_string()
        }
    };

    match &body.target_ign {
        // ── Direct message (not persisted) ────────────────────────────────────
        Some(target) => {
            // Sanitise target IGN (alphanumeric + underscore only).
            let safe_target: String = target
                .chars()
                .filter(|c| c.is_alphanumeric() || *c == '_')
                .take(16)
                .collect();
            if safe_target.is_empty() {
                return Err(AppError::BadRequest("Invalid target IGN".into()));
            }

            let safe_content = escape_for_fifo(&content);
            let cmd = format!("msg {safe_target} [{display_as}] {safe_content}");
            let _ = ssh::fifo_command(&state.config, &cmd).await;
        }

        // ── Broadcast (persisted) ──────────────────────────────────────────────
        None => {
            // Build a tellraw JSON component so the message renders correctly
            // in-game without injection risk.
            let tellraw = build_tellraw(&display_as, &linked_ign, &content);
            let cmd = format!("tellraw @a {tellraw}");

            if ssh::fifo_command(&state.config, &cmd).await.is_err() {
                // Server is offline — still save to history so web users see it.
                warn!("chat send: FIFO unavailable, saving to history only");
            }

            // Persist and broadcast to SSE subscribers.
            let msg = chat::insert(
                &state.pool,
                "web",
                &actor.email,
                &display_as,
                &content,
            )
            .await?;

            let _ = state.chat_tx.send(Arc::new(msg));
        }
    }

    Ok(StatusCode::NO_CONTENT)
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/// Escape a string for safe embedding in the FIFO command.
/// Strips single quotes (which can break the shell wrapper in fifo_command).
fn escape_for_fifo(s: &str) -> String {
    s.replace('\'', "\u{2019}") // replace straight apostrophe with right curly quote
}

/// Build a `tellraw @a` JSON payload that renders as:
///   [web] IGN: message        (when sender has a linked IGN)
///   [web] username: message   (fallback)
fn build_tellraw(display_as: &str, linked_ign: &Option<String>, content: &str) -> String {
    // JSON-encode strings individually to safely handle quotes, backslashes, etc.
    let tag_json    = serde_json::to_string("[web] ").unwrap();
    let name_json   = serde_json::to_string(&format!("{display_as}: ")).unwrap();
    let content_json = serde_json::to_string(content).unwrap();

    let name_color = if linked_ign.is_some() { "yellow" } else { "gray" };

    format!(
        r#"[{{"text":{tag_json},"color":"gray"}},{{"text":{name_json},"color":"{name_color}","bold":true}},{{"text":{content_json},"color":"white"}}]"#,
        tag_json = tag_json,
        name_json = name_json,
        content_json = content_json,
        name_color = name_color,
    )
}

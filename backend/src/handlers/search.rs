//! Global search — one endpoint backing the Cmd+K command palette.
//!
//! GET /api/search?q=…  (authenticated)
//!
//! Searches across players, map pins, events (countdowns / bounty boards /
//! lobbies) and — for users who can view the roster — site users. Returns a
//! flat, ranked-ish list of hits the frontend groups by `kind` and navigates to
//! via `route`. All values are bound parameters with LIKE wildcards escaped.

use axum::{
    extract::{Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    auth::middleware::AuthUser,
    error::{AppError, Result},
    state::AppState,
};

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: String,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct SearchHit {
    pub kind: String,            // player | pin | event | user
    pub label: String,
    pub sublabel: Option<String>,
    pub route: String,           // frontend route to navigate to
}

/// Escape LIKE wildcards so a literal `%`/`_` in the query isn't treated as one.
fn like_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

pub async fn search(
    State(state): State<AppState>,
    actor: AuthUser,
    Query(p): Query<SearchQuery>,
) -> Result<Json<Vec<SearchHit>>> {
    let q = p.q.trim();
    if q.is_empty() {
        return Ok(Json(vec![]));
    }
    if q.len() > 64 {
        return Err(AppError::BadRequest("search query too long".into()));
    }
    let like = format!("%{}%", like_escape(q));
    let mut hits: Vec<SearchHit> = Vec::new();

    // ── Players (any authenticated user may locate players) ───────────────────
    let players: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT ign FROM player_snapshots WHERE ign LIKE ? ESCAPE '\\' ORDER BY ign LIMIT 6",
    )
    .bind(&like)
    .fetch_all(&state.pool)
    .await?;
    for (ign,) in players {
        hits.push(SearchHit {
            kind: "player".into(),
            label: ign.clone(),
            sublabel: Some("Player".into()),
            route: format!("/players/{ign}"),
        });
    }

    // ── Map pins ──────────────────────────────────────────────────────────────
    let pins: Vec<(String,)> = sqlx::query_as(
        "SELECT label FROM map_pins WHERE label LIKE ? ESCAPE '\\' ORDER BY label LIMIT 6",
    )
    .bind(&like)
    .fetch_all(&state.pool)
    .await?;
    for (label,) in pins {
        hits.push(SearchHit {
            kind: "pin".into(),
            label,
            sublabel: Some("Map pin".into()),
            route: "/map".into(),
        });
    }

    // ── Events: countdowns + bounty boards + lobbies ──────────────────────────
    for (sql, kind_label) in [
        ("SELECT title FROM countdowns WHERE title LIKE ? ESCAPE '\\' ORDER BY title LIMIT 5", "Countdown"),
        ("SELECT title FROM bounty_boards WHERE title LIKE ? ESCAPE '\\' ORDER BY title LIMIT 5", "Bounty board"),
        ("SELECT name FROM pre_game_lobbies WHERE name LIKE ? ESCAPE '\\' ORDER BY name LIMIT 5", "Lobby"),
    ] {
        let rows: Vec<(String,)> = sqlx::query_as(sql).bind(&like).fetch_all(&state.pool).await?;
        for (title,) in rows {
            hits.push(SearchHit {
                kind: "event".into(),
                label: title,
                sublabel: Some(kind_label.into()),
                route: "/events".into(),
            });
        }
    }

    // ── Users (only for roster viewers) ───────────────────────────────────────
    if actor.has("users.view") {
        let users: Vec<(String, String)> = sqlx::query_as(
            "SELECT email, display_name FROM users
              WHERE email LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\'
              ORDER BY display_name LIMIT 6",
        )
        .bind(&like)
        .bind(&like)
        .fetch_all(&state.pool)
        .await?;
        for (email, name) in users {
            hits.push(SearchHit {
                kind: "user".into(),
                label: if name.is_empty() { email.clone() } else { name },
                sublabel: Some(email),
                route: "/admin".into(),
            });
        }
    }

    Ok(Json(hits))
}

//! In-game QR code / clickable-link SSO.
//!
//! Flow:
//!   1. Admin clicks "Send sign-in link" on a player's profile.
//!   2. POST /api/players/:ign/link-token → generates a one-time token (10 min TTL),
//!      sends the player a written book in-game with a clickable URL.
//!   3. Player clicks the link in-game → browser opens GET /auth/link/:token.
//!   4. Token validated → JWT session issued → redirect to the app.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Redirect, Response},
    Json,
};
use axum_extra::extract::{
    cookie::{Cookie, SameSite},
    CookieJar,
};
use chrono::Utc;
use serde::Serialize;
use uuid::Uuid;

use crate::{
    auth::middleware::{issue_jwt, AuthUser, JWT_COOKIE},
    db::{link_tokens, users},
    error::{AppError, Result},
    minecraft::console,
    state::AppState,
};

const TOKEN_TTL_MINS: i64 = 10;

// ── POST /api/players/:ign/link-token ────────────────────────────────────────

#[derive(Serialize)]
pub struct LinkTokenResponse {
    pub token: String,
    pub url:   String,
    pub expires_at: String,
    pub book_sent: bool,
}

pub async fn create(
    State(state): State<AppState>,
    actor:        AuthUser,
    Path(ign):    Path<String>,
) -> Result<(StatusCode, Json<LinkTokenResponse>)> {
    crate::auth::middleware::require_perm(&actor, "users.invite")?;

    // Look up the email linked to this IGN
    let link: Option<(String,)> = sqlx::query_as(
        "SELECT email FROM player_links WHERE LOWER(ign) = LOWER(?)",
    )
    .bind(&ign)
    .fetch_optional(&state.pool)
    .await?;

    let email = link
        .map(|(e,)| e)
        .ok_or_else(|| AppError::NotFound(format!(
            "No user linked to player {ign}. Link them in the Team tab first.",
        )))?;

    // Verify the user exists
    let user = users::get(&state.pool, &email)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("User {email} not found")))?;

    // Generate token
    let token = Uuid::new_v4().to_string();
    let now = Utc::now();
    let expires = now + chrono::Duration::minutes(TOKEN_TTL_MINS);
    let expires_str = expires.format("%Y-%m-%d %H:%M:%S").to_string();

    link_tokens::create(&state.pool, &token, &email, &ign, &expires_str).await?;

    // Build the sign-in URL
    let base_url = &state.config.site_url;
    let url = format!("{base_url}/auth/link/{token}");

    // Send the player a written book in-game with a clickable link
    let book_sent = send_signin_book(&state.config, &ign, &url, &user.display_name).await;

    // Cleanup old expired tokens (best-effort)
    let _ = link_tokens::cleanup_expired(&state.pool).await;

    Ok((StatusCode::CREATED, Json(LinkTokenResponse {
        token,
        url,
        expires_at: expires_str,
        book_sent,
    })))
}

/// Send a written book to the player with a clickable sign-in link.
async fn send_signin_book(
    cfg:          &crate::config::Config,
    ign:          &str,
    url:          &str,
    display_name: &str,
) -> bool {
    // Minecraft 1.21 written_book component format using data components
    // The book has a title, author, and pages with clickable text
    let page_json = serde_json::json!([
        {"text": "redstoneCipher\n\n", "color": "gold", "bold": true},
        {"text": "Hi ", "color": "dark_gray"},
        {"text": display_name, "color": "blue"},
        {"text": "!\n\n", "color": "dark_gray"},
        {"text": "Click the link below to sign in to the web portal:\n\n", "color": "dark_gray"},
        {
            "text": "[Open Portal]",
            "color": "blue",
            "bold": true,
            "underlined": true,
            "clickEvent": {
                "action": "open_url",
                "value": url
            },
            "hoverEvent": {
                "action": "show_text",
                "contents": {"text": "Click to sign in", "color": "green"}
            }
        },
        {"text": "\n\nThis link expires in 10 minutes.", "color": "gray", "italic": true}
    ]);

    let page_str = page_json.to_string().replace('\'', "");

    // Paper 1.21+ uses component-based data format
    let cmd = format!(
        "give {ign} written_book[written_book_content={{title:\"redstoneCipher Sign-In\",author:\"redstoneCipher\",pages:['{}']}}] 1",
        page_str,
    );

    match console::send(cfg, &cmd).await {
        Ok(true) => {
            tracing::info!("link_token: sent sign-in book to {ign}");
            true
        }
        Ok(false) => {
            tracing::warn!("link_token: failed to send book to {ign} (server offline?)");
            false
        }
        Err(e) => {
            tracing::warn!("link_token: give command error for {ign}: {e}");
            false
        }
    }
}

// ── GET /auth/link/:token ────────────────────────────────────────────────────

pub async fn redeem(
    State(state): State<AppState>,
    jar:          CookieJar,
    Path(token):  Path<String>,
) -> Response {
    let lt = match link_tokens::get(&state.pool, &token).await {
        Ok(Some(t)) => t,
        _ => return error_page("Invalid or expired link."),
    };

    if lt.used {
        return error_page("This link has already been used.");
    }

    // Check expiry
    let expires = chrono::NaiveDateTime::parse_from_str(&lt.expires_at, "%Y-%m-%d %H:%M:%S")
        .ok()
        .map(|nd| nd.and_utc());

    if let Some(exp) = expires {
        if Utc::now() > exp {
            return error_page("This link has expired. Ask an admin to send a new one.");
        }
    }

    // Mark as used
    if let Err(e) = link_tokens::mark_used(&state.pool, &token).await {
        tracing::error!("link_token: mark_used failed: {e}");
        return error_page("Internal error. Please try again.");
    }

    // Look up user's role
    let role = match users::get(&state.pool, &lt.email).await {
        Ok(Some(u)) => u.role,
        _ => {
            return error_page("User account not found. Contact an admin.");
        }
    };

    // Issue JWT
    let jwt = match issue_jwt(&lt.email, &role, &state.config.jwt_secret) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("link_token: JWT issue failed: {e}");
            return error_page("Failed to create session.");
        }
    };

    let session_cookie = Cookie::build((JWT_COOKIE, jwt))
        .http_only(true)
        .secure(true)
        .same_site(SameSite::Lax)
        .path("/")
        .max_age(time::Duration::hours(8))
        .build();

    tracing::info!("link_token: {} signed in via link (player {})", lt.email, lt.ign);
    (jar.add(session_cookie), Redirect::to("/")).into_response()
}

fn error_page(msg: &str) -> Response {
    let encoded = urlencoding::encode(msg);
    Redirect::to(&format!("/login?error=link&message={encoded}")).into_response()
}

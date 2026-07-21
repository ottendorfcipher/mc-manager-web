//! Modrinth integration settings — optional PAT for higher rate limits.
//!
//! The Modrinth v2 API is public and works without a token, but an
//! authenticated Personal Access Token (PAT) gives:
//!   • 600 req/min instead of 300 req/min (shared)
//!   • Stable identity in rate-limit accounting
//!
//! Stored as `modrinth.pat` in app_settings (AES-256-GCM encrypted).
//! The actual token is never returned in any response — only a boolean
//! `token_set` flag and a short hint prefix.

use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};

use crate::{
    auth::middleware::AuthUser,
    db::settings,
    error::Result,
    state::AppState,
};

pub const SETTING_KEY: &str = "modrinth.pat";

// ── GET /api/admin/modrinth-settings ─────────────────────────────────────────

#[derive(Serialize)]
pub struct ModrinthStatus {
    /// Whether a PAT is stored.
    pub token_set:  bool,
    /// Last 4 chars of the token, for recognition only (never the prefix).
    pub token_hint: Option<String>,
    /// Whether the Modrinth API is reachable right now (live test).
    pub api_reachable: bool,
    /// Number of Paper-compatible plugins indexed on Modrinth
    /// (from a lightweight search with limit=0).
    pub plugin_count: Option<u32>,
}

pub async fn get(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<Json<ModrinthStatus>> {
    crate::auth::middleware::require_perm(&actor, "discord.configure")?;

    let enc = &state.config.settings_enc_key;
    let stored = settings::get(&state.pool, enc, SETTING_KEY).await?;

    let (token_set, token_hint) = match &stored {
        None    => (false, None),
        Some(t) => {
            // Show only the last 4 chars — never the entropy-rich prefix.
            let hint = if t.len() > 4 { format!("…{}", &t[t.len() - 4..]) } else { "…".to_string() };
            (true, Some(hint))
        }
    };

    // Live connectivity test — attempt a minimal Modrinth search.
    let (api_reachable, plugin_count) =
        test_modrinth_connection(stored.as_deref()).await;

    Ok(Json(ModrinthStatus { token_set, token_hint, api_reachable, plugin_count }))
}

// ── PUT /api/admin/modrinth-settings ─────────────────────────────────────────

#[derive(Deserialize)]
pub struct ModrinthSettingsUpdate {
    /// New PAT — omit or empty to keep existing.
    pub token: Option<String>,
}

pub async fn put(
    State(state): State<AppState>,
    actor: AuthUser,
    Json(body): Json<ModrinthSettingsUpdate>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "discord.configure")?;

    if let Some(t) = body.token.as_deref().filter(|s| !s.is_empty()) {
        settings::set(&state.pool, &state.config.settings_enc_key, SETTING_KEY, t, &actor.email).await?;
        tracing::info!(actor = %actor.email, "Modrinth PAT saved");
    }

    Ok(StatusCode::NO_CONTENT)
}

// ── DELETE /api/admin/modrinth-settings ──────────────────────────────────────

pub async fn delete(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "discord.configure")?;

    sqlx::query("DELETE FROM app_settings WHERE key = ?")
        .bind(SETTING_KEY)
        .execute(&state.pool)
        .await
        .map_err(|e| crate::error::AppError::Internal(e.into()))?;

    tracing::info!(actor = %actor.email, "Modrinth PAT removed");
    Ok(StatusCode::NO_CONTENT)
}

// ── Helper: retrieve stored PAT for use by modrinth.rs ───────────────────────

/// Load the stored Modrinth PAT, if any.  Returns None when not configured;
/// the client will fall back to unauthenticated requests.
pub async fn get_pat(state: &AppState) -> Option<String> {
    settings::get(&state.pool, &state.config.settings_enc_key, SETTING_KEY)
        .await
        .ok()
        .flatten()
}

// ── Live connectivity test ────────────────────────────────────────────────────

/// Hit `GET /v2/search?limit=0&facets=…` to verify the API is reachable
/// and get a rough plugin count.  Timeout: 5 s.  Never errors the handler.
async fn test_modrinth_connection(pat: Option<&str>) -> (bool, Option<u32>) {
    let client = crate::minecraft::modrinth::build_client();
    let facets = r#"[["categories:paper","categories:spigot","categories:bukkit"],["versions:1.21","versions:1.21.1","versions:1.21.4"]]"#;
    let url = format!(
        "https://api.modrinth.com/v2/search?limit=0&facets={}",
        urlencoding::encode(facets),
    );

    let mut req = client.get(&url);
    if let Some(t) = pat {
        req = req.header("Authorization", t);
    }

    match tokio::time::timeout(
        std::time::Duration::from_secs(5),
        req.send(),
    ).await {
        Ok(Ok(resp)) if resp.status().is_success() => {
            let count = resp.json::<serde_json::Value>().await.ok()
                .and_then(|v| v["total_hits"].as_u64())
                .map(|n| n as u32);
            (true, count)
        }
        _ => (false, None),
    }
}

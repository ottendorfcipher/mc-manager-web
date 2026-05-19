//! Discord integration settings — secure storage and hot-reload.
//!
//! ## Security model
//! * `GET`  returns only boolean flags (`bot_token_set`, `webhook_url_set`) and
//!   the non-secret channel ID.  The bot token and webhook URL are **never**
//!   returned in any response.
//! * `PUT`  accepts only the fields the caller wants to change.  Omitting a
//!   field (or sending an empty string) leaves the stored value unchanged.
//!   This is the standard "replace-only" API pattern used for credentials.
//! * Both endpoints require the `discord.configure` permission (global_admin
//!   only by default).
//! * Values are stored AES-256-GCM encrypted via `db::settings`.
//! * On successful `PUT` the in-memory relay and gateway are updated
//!   immediately — no service restart required.

use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};

use crate::{
    auth::middleware::AuthUser,
    db::settings,
    discord::{DiscordRelay, DiscordRuntimeConfig},
    error::Result,
    state::AppState,
};

// ── GET /api/admin/discord-settings ──────────────────────────────────────────

#[derive(Serialize)]
pub struct DiscordSettingsStatus {
    /// Whether a bot token is stored (never the actual value).
    pub bot_token_set:   bool,
    /// Whether a webhook URL is stored (never the actual value).
    pub webhook_url_set: bool,
    /// Channel ID — not secret, shown in the UI for verification.
    pub channel_id:      Option<String>,
}

pub async fn get(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<Json<DiscordSettingsStatus>> {
    crate::auth::middleware::require_perm(&actor, "discord.configure")?;

    let enc = &state.config.settings_enc_key;
    let pool = &state.pool;

    // Only check presence — never return actual values.
    let token_set   = settings::get(pool, enc, "discord.bot_token").await?.is_some();
    let webhook_set = settings::get(pool, enc, "discord.webhook_url").await?.is_some();
    let channel_id  = settings::get(pool, enc, "discord.channel_id").await?;

    Ok(Json(DiscordSettingsStatus {
        bot_token_set:   token_set,
        webhook_url_set: webhook_set,
        channel_id,
    }))
}

// ── PUT /api/admin/discord-settings ──────────────────────────────────────────

#[derive(Deserialize)]
pub struct DiscordSettingsUpdate {
    /// New bot token — omit or send empty string to keep existing.
    pub bot_token:   Option<String>,
    /// New webhook URL — omit or send empty string to keep existing.
    pub webhook_url: Option<String>,
    /// New channel ID as a numeric string — omit to keep existing.
    pub channel_id:  Option<String>,
}

pub async fn put(
    State(state): State<AppState>,
    actor: AuthUser,
    Json(body): Json<DiscordSettingsUpdate>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "discord.configure")?;

    let enc  = &state.config.settings_enc_key;
    let pool = &state.pool;
    let by   = &actor.email;

    // Update only the fields that were supplied and non-empty.
    if let Some(t) = body.bot_token.as_deref().filter(|s| !s.is_empty()) {
        settings::set(pool, enc, "discord.bot_token", t, by).await?;
    }
    if let Some(w) = body.webhook_url.as_deref().filter(|s| !s.is_empty()) {
        settings::set(pool, enc, "discord.webhook_url", w, by).await?;
    }
    if let Some(c) = body.channel_id.as_deref().filter(|s| !s.is_empty()) {
        // Validate it parses as u64 before storing.
        c.parse::<u64>().map_err(|_| {
            crate::error::AppError::BadRequest("channel_id must be a numeric Discord snowflake".into())
        })?;
        settings::set(pool, enc, "discord.channel_id", c, by).await?;
    }

    // Re-load the full config (env vars take priority over DB).
    let db_cfg = settings::get_discord_config(pool, enc).await?;
    let new_runtime: Option<DiscordRuntimeConfig> =
        match (
            state.config.discord_bot_token.as_deref(),
            state.config.discord_webhook_url.as_deref(),
            state.config.discord_channel_id,
        ) {
            (Some(t), Some(w), Some(c)) => Some(DiscordRuntimeConfig {
                bot_token:   t.to_string(),
                webhook_url: w.to_string(),
                channel_id:  c,
            }),
            _ => db_cfg.map(|d| DiscordRuntimeConfig {
                bot_token:   d.bot_token,
                webhook_url: d.webhook_url,
                channel_id:  d.channel_id,
            }),
        };

    // Hot-swap the outbound relay.
    {
        let mut relay_guard = state.discord.write().await;
        *relay_guard = new_runtime.as_ref().map(|cfg| {
            DiscordRelay::new(cfg.webhook_url.clone(), cfg.channel_id)
        });
    }

    // Notify the gateway manager — it will cancel the existing Serenity
    // client and start a fresh one with the new token/channel.
    let _ = state.discord_config_tx.send(new_runtime);

    tracing::info!(actor = %actor.email, "Discord settings updated");
    Ok(StatusCode::NO_CONTENT)
}

//! First-run setup.
//!
//! When Google OAuth is not configured yet, the app serves a setup wizard before
//! the login screen. The wizard saves config to the database (encrypted). At the
//! next startup that saved config is overlaid onto `Config`, so it takes effect
//! after a quick restart without editing any files.

use sqlx::SqlitePool;

use crate::config::Config;
use crate::db::settings;

// Encrypted app_settings keys for wizard-saved config.
pub const K_GOOGLE_ID: &str = "setup.google_client_id";
pub const K_GOOGLE_SECRET: &str = "setup.google_client_secret";
pub const K_SITE_URL: &str = "setup.site_url";
pub const K_REDIRECT_URI: &str = "setup.redirect_uri";
pub const K_ADMIN: &str = "setup.bootstrap_admin_email";
pub const K_CF_TEAM: &str = "setup.cloudflare_team_domain";
pub const K_CF_ID: &str = "setup.cloudflare_client_id";
pub const K_CF_SECRET: &str = "setup.cloudflare_client_secret";

/// True when Google OAuth is not usable yet, so the setup wizard should show
/// instead of the login screen.
pub fn needs_setup(cfg: &Config) -> bool {
    is_placeholder(&cfg.google_client_id)
}

/// Recognises the placeholder client ids used before real setup.
fn is_placeholder(id: &str) -> bool {
    id.is_empty() || id == "setup" || id == "test" || id.starts_with("your_google_client_id")
}

/// Overlay any wizard-saved config from the DB onto `cfg`. Call once at startup
/// after the pool is ready. Missing keys leave the env-provided value in place.
pub async fn overlay(cfg: &mut Config, pool: &SqlitePool, enc_key: &[u8; 32]) {
    async fn get(pool: &SqlitePool, enc_key: &[u8; 32], key: &str) -> Option<String> {
        settings::get(pool, enc_key, key)
            .await
            .ok()
            .flatten()
            .filter(|s| !s.is_empty())
    }
    if let Some(v) = get(pool, enc_key, K_GOOGLE_ID).await {
        cfg.google_client_id = v;
    }
    if let Some(v) = get(pool, enc_key, K_GOOGLE_SECRET).await {
        cfg.google_client_secret = v;
    }
    if let Some(v) = get(pool, enc_key, K_SITE_URL).await {
        cfg.site_url = v.clone();
        cfg.cors_origins = vec![v];
    }
    if let Some(v) = get(pool, enc_key, K_REDIRECT_URI).await {
        cfg.redirect_uri = v;
    }
    if let Some(v) = get(pool, enc_key, K_ADMIN).await {
        cfg.bootstrap_admin_email = Some(v);
    }
    if let Some(v) = get(pool, enc_key, K_CF_TEAM).await {
        cfg.cloudflare_team_domain = Some(v);
    }
    if let Some(v) = get(pool, enc_key, K_CF_ID).await {
        cfg.cloudflare_client_id = Some(v);
    }
    if let Some(v) = get(pool, enc_key, K_CF_SECRET).await {
        cfg.cloudflare_client_secret = Some(v);
    }
}

/// Generate a random one-time setup token (48 hex chars) for the first-run
/// wizard when the operator did not set `SETUP_TOKEN`. Printed to the server log
/// at startup so only someone who can read the log can complete setup.
pub fn generate_setup_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

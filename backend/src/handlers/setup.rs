//! First-run setup wizard endpoints (public, active only while unconfigured).

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    db::settings,
    error::{AppError, Result},
    setup,
    state::AppState,
};

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct SetupStatus {
    /// Whether the SPA should show the wizard instead of the login screen.
    pub needs_setup: bool,
    /// The exact redirect URI to register with Google, based on the site URL.
    pub redirect_uri: String,
    pub site_url: String,
    /// Whether a setup token must be supplied to submit the wizard.
    pub token_required: bool,
}

/// GET /auth/setup/status
pub async fn status(State(state): State<AppState>) -> Json<SetupStatus> {
    Json(SetupStatus {
        needs_setup: setup::needs_setup(&state.config),
        redirect_uri: state.config.redirect_uri.clone(),
        site_url: state.config.site_url.clone(),
        token_required: state.config.setup_token.is_some(),
    })
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct SetupForm {
    pub site_url: String,
    pub google_client_id: String,
    pub google_client_secret: String,
    pub bootstrap_admin_email: String,
    #[serde(default)]
    pub cloudflare_team_domain: Option<String>,
    #[serde(default)]
    pub cloudflare_client_id: Option<String>,
    #[serde(default)]
    pub cloudflare_client_secret: Option<String>,
    #[serde(default)]
    pub setup_token: Option<String>,
}

/// POST /auth/setup — saves wizard config to the DB and restarts to apply it.
/// Allowed only while the app is unconfigured, so it cannot be used to
/// reconfigure a live deployment.
pub async fn save(
    State(state): State<AppState>,
    Json(form): Json<SetupForm>,
) -> Result<Json<serde_json::Value>> {
    if !setup::needs_setup(&state.config) {
        return Err(AppError::Forbidden("Setup is already complete".into()));
    }
    if let Some(expected) = state.config.setup_token.as_deref() {
        if form.setup_token.as_deref() != Some(expected) {
            return Err(AppError::Forbidden("Invalid setup token".into()));
        }
    }

    // Validate at the boundary.
    let site = form.site_url.trim().trim_end_matches('/');
    if !(site.starts_with("http://") || site.starts_with("https://")) {
        return Err(AppError::BadRequest("Site URL must start with http:// or https://".into()));
    }
    let email = form.bootstrap_admin_email.trim();
    if !email.contains('@') || !email.contains('.') {
        return Err(AppError::BadRequest("Enter a valid admin email".into()));
    }
    let client_id = form.google_client_id.trim();
    let client_secret = form.google_client_secret.trim();
    if client_id.is_empty() || client_secret.is_empty() {
        return Err(AppError::BadRequest("Google client ID and secret are required".into()));
    }

    let pool = &state.pool;
    let key = &state.config.settings_enc_key;
    let redirect = format!("{site}/auth/callback");
    settings::set(pool, key, setup::K_SITE_URL, site, "setup-wizard").await?;
    settings::set(pool, key, setup::K_REDIRECT_URI, &redirect, "setup-wizard").await?;
    settings::set(pool, key, setup::K_GOOGLE_ID, client_id, "setup-wizard").await?;
    settings::set(pool, key, setup::K_GOOGLE_SECRET, client_secret, "setup-wizard").await?;
    settings::set(pool, key, setup::K_ADMIN, email, "setup-wizard").await?;

    let cf = (
        form.cloudflare_team_domain.as_deref().map(str::trim).filter(|s| !s.is_empty()),
        form.cloudflare_client_id.as_deref().map(str::trim).filter(|s| !s.is_empty()),
        form.cloudflare_client_secret.as_deref().map(str::trim).filter(|s| !s.is_empty()),
    );
    if let (Some(team), Some(id), Some(secret)) = cf {
        settings::set(pool, key, setup::K_CF_TEAM, team, "setup-wizard").await?;
        settings::set(pool, key, setup::K_CF_ID, id, "setup-wizard").await?;
        settings::set(pool, key, setup::K_CF_SECRET, secret, "setup-wizard").await?;
    }

    // Restart so the startup overlay picks up the saved config. The container
    // restart policy brings the process back within a couple of seconds.
    tokio::spawn(async {
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
        tracing::info!("setup complete; restarting to apply configuration");
        std::process::exit(0);
    });

    Ok(Json(serde_json::json!({ "ok": true })))
}

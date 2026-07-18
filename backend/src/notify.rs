//! Outbound email notifications (transactional alerts).
//!
//! Uses the same Resend integration as onboarding invites. Every entry point is
//! a no-op when `RESEND_API_KEY` is unset, so notifications are opt-in by
//! configuration and never block or fail the action that triggered them.

use serde_json::json;

use crate::{config::Config, db::users, state::AppState};

/// Send one email to a set of recipients via Resend. Returns `Err` with a
/// human-readable message on failure; callers log it rather than propagate.
pub async fn send_email(
    cfg: &Config,
    http: &reqwest::Client,
    to: &[String],
    subject: &str,
    html: &str,
    text: &str,
) -> std::result::Result<(), String> {
    let api_key = cfg
        .resend_api_key
        .as_deref()
        .ok_or("RESEND_API_KEY is not configured")?;

    let payload = json!({
        "from":     cfg.email_from.as_str(),
        "to":       to,
        "subject":  subject,
        "html":     html,
        "text":     text,
    });

    let resp = http
        .post("https://api.resend.com/emails")
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if resp.status().is_success() {
        Ok(())
    } else {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        Err(format!("Resend API {status}: {body}"))
    }
}

/// Email all admins (role level ≥ admin) that a new player is waiting for
/// approval. No-op when email isn't configured. Fire-and-forget — designed to
/// be `tokio::spawn`ed so it never delays the watchdog response.
pub async fn admins_new_pending(state: &AppState, ign: &str) {
    let ign_safe = html_escape(ign);
    let site = state.config.site_url.trim_end_matches('/');
    let subject = format!("New player waiting for approval: {ign_safe}");
    let html = format!(
        "<p><strong>{ign_safe}</strong> just connected to the Minecraft server and \
         is waiting for approval.</p>\
         <p><a href=\"{site}/admin\">Review pending players →</a></p>"
    );
    let text = format!(
        "{ign_safe} just connected and is waiting for approval.\n\nReview at {site}/admin"
    );
    notify_admins(state, "pending_player", &subject, &html, &text).await;
}

/// Email every admin (role ≥ admin) who has the given notification `category`
/// enabled in their preferences. No-op when email isn't configured. Designed to
/// be `tokio::spawn`ed so it never delays the triggering action.
pub async fn notify_admins(
    state: &AppState,
    category: &'static str,
    subject: &str,
    html: &str,
    text: &str,
) {
    if state.config.resend_api_key.is_none() {
        return; // email not configured — nothing to do
    }

    let users = match users::list(&state.pool).await {
        Ok(list) => list,
        Err(e) => {
            tracing::warn!(error = %e, "notify: could not load admin list");
            return;
        }
    };

    let mut recipients: Vec<String> = Vec::new();
    for u in users.into_iter().filter(|u| users::role_level(&u.role) >= 3) {
        let prefs = crate::db::notification_prefs::get(&state.pool, &u.email)
            .await
            .unwrap_or_default();
        if prefs.enabled(category) {
            recipients.push(u.email);
        }
    }
    if recipients.is_empty() {
        return;
    }

    if let Err(e) = send_email(&state.config, &state.http, &recipients, subject, html, text).await {
        tracing::warn!(error = %e, category, "notify: notify_admins email failed");
    } else {
        tracing::info!(category, recipients = recipients.len(), "notify: emailed admins");
    }
}

/// Minimal HTML escaping for interpolated values.
pub fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

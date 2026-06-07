//! Outbound email notifications (transactional alerts).
//!
//! Uses the same Resend integration as onboarding invites. Every entry point is
//! a no-op when `RESEND_API_KEY` is unset, so notifications are opt-in by
//! configuration and never block or fail the action that triggered them.

use serde_json::json;

use crate::{config::Config, db::users, state::AppState};

const FROM: &str = "redstoneCipher <onboarding@example.com>";

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
        "from":     FROM,
        "reply_to": ["onboarding@example.com"],
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
    if state.config.resend_api_key.is_none() {
        return; // email not configured — nothing to do
    }

    let admins = match users::list(&state.pool).await {
        Ok(list) => list
            .into_iter()
            .filter(|u| users::role_level(&u.role) >= 3)
            .map(|u| u.email)
            .collect::<Vec<_>>(),
        Err(e) => {
            tracing::warn!(error = %e, "notify: could not load admin list");
            return;
        }
    };
    if admins.is_empty() {
        return;
    }

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

    if let Err(e) = send_email(&state.config, &state.http, &admins, &subject, &html, &text).await {
        tracing::warn!(error = %e, ign = %ign, "notify: admins_new_pending email failed");
    } else {
        tracing::info!(ign = %ign, recipients = admins.len(), "notify: emailed admins about new pending player");
    }
}

/// Minimal HTML escaping for interpolated values.
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

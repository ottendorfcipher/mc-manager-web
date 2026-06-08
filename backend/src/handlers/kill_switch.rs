use axum::{extract::State, Json};
use serde::Deserialize;

use crate::{
    auth::middleware::{require_perm, AuthUser},
    db::kill_switch::{self, KillSwitch},
    error::Result,
    state::AppState,
};

/// GET /api/kill-switch — anyone with `killswitch.view`.
pub async fn get(State(state): State<AppState>, actor: AuthUser) -> Result<Json<KillSwitch>> {
    require_perm(&actor, "killswitch.view")?;
    Ok(Json(kill_switch::status(&state.pool).await?))
}

#[derive(Debug, Deserialize)]
pub struct EngageRequest {
    pub reason: String,
}

/// POST /api/kill-switch — requires `killswitch.toggle`.
pub async fn engage(
    State(state): State<AppState>,
    actor: AuthUser,
    Json(body): Json<EngageRequest>,
) -> Result<Json<KillSwitch>> {
    require_perm(&actor, "killswitch.toggle")?;
    kill_switch::engage(
        &state.pool,
        &body.reason,
        &format!("manual:{}", actor.email),
    )
    .await?;

    // Notify opted-in admins (fire-and-forget; no-op without RESEND_API_KEY).
    {
        let state2 = state.clone();
        let who = crate::notify::html_escape(&actor.email);
        let reason = crate::notify::html_escape(&body.reason);
        tokio::spawn(async move {
            let site = state2.config.site_url.trim_end_matches('/').to_string();
            let subject = "redstoneCipher kill switch ENGAGED".to_string();
            let html = format!(
                "<p>The global kill switch was <strong>engaged</strong> by {who}.</p>\
                 <p>Reason: {reason}</p><p><a href=\"{site}/\">Open redstoneCipher →</a></p>"
            );
            let text = format!("Kill switch engaged by {who}. Reason: {reason}");
            crate::notify::notify_admins(&state2, "kill_switch", &subject, &html, &text).await;
        });
    }

    Ok(Json(kill_switch::status(&state.pool).await?))
}

/// DELETE /api/kill-switch — requires `killswitch.toggle`.
pub async fn release(State(state): State<AppState>, actor: AuthUser) -> Result<Json<KillSwitch>> {
    require_perm(&actor, "killswitch.toggle")?;
    kill_switch::release(&state.pool, &actor.email).await?;
    Ok(Json(kill_switch::status(&state.pool).await?))
}

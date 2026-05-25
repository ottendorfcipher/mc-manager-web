//! Background task that fires due scheduled jobs every minute.
//!
//! On each minute tick:
//!   1. List enabled jobs with next_fire_at <= now.
//!   2. For each: execute the action, record next_fire_at + last_status.
//!
//! Action types are dispatched here.  The list is intentionally small
//! (each maps to an existing subsystem) so adding new ones is just a match arm.

use std::time::Duration;
use tracing::warn;

use crate::{
    db::scheduled_jobs,
    minecraft::{console, cron::Cron},
    state::AppState,
};

pub fn spawn_scheduled_task(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        interval.tick().await; // skip the immediate first tick

        loop {
            interval.tick().await;
            if let Err(e) = tick_once(&state).await {
                warn!("scheduled: tick error: {e:?}");
            }
        }
    });
}

async fn tick_once(state: &AppState) -> anyhow::Result<()> {
    let now = chrono::Utc::now();
    let now_str = now.format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let due = scheduled_jobs::due_before(&state.pool, &now_str).await?;
    for job in due {
        let outcome = run_action(state, &job).await;
        let next_at = Cron::parse(&job.cron_expr).ok()
            .and_then(|c| c.next_after(now))
            .map(|t| t.format("%Y-%m-%dT%H:%M:%SZ").to_string())
            .unwrap_or_else(|| "9999-12-31T00:00:00Z".into());
        let status = match outcome {
            Ok(())  => "ok".to_string(),
            Err(e) => format!("error: {e}"),
        };
        let _ = scheduled_jobs::record_fire(
            &state.pool, job.id, &now_str, &next_at, &status,
        ).await;
    }
    Ok(())
}

/// Public wrapper used by the "Run now" button.  Bypasses scheduling, just
/// fires the job action.
pub async fn run_job_inline(
    state: &AppState,
    job:   &scheduled_jobs::ScheduledJob,
) -> anyhow::Result<()> {
    run_action(state, job).await
}

async fn run_action(state: &AppState, job: &scheduled_jobs::ScheduledJob) -> anyhow::Result<()> {
    let payload: serde_json::Value = serde_json::from_str(&job.action_payload)
        .unwrap_or_else(|_| serde_json::json!({}));
    match job.action_type.as_str() {
        "console" => {
            let cmd = payload.get("command").and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing 'command'"))?;
            console::send(&state.config, cmd).await?;
        }
        "announce" => {
            let text = payload.get("text").and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing 'text'"))?;
            let json = serde_json::json!({"text": text, "color": "yellow"}).to_string();
            console::send(&state.config, &format!("tellraw @a {json}")).await?;
        }
        "discord" => {
            let msg = payload.get("message").and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing 'message'"))?;
            if let Some(relay) = state.discord.read().await.as_ref() {
                relay.relay("redstoneCipher", None, msg).await;
            } else {
                return Err(anyhow::anyhow!("Discord not configured"));
            }
        }
        "backup" => {
            let slug = payload.get("world_slug").and_then(|v| v.as_str());
            let slug = match slug {
                Some(s) => s.to_string(),
                None    => crate::db::worlds::get_active(&state.pool).await?
                    .ok_or_else(|| anyhow::anyhow!("no active world"))?.slug,
            };
            crate::minecraft::world_switch::create_world_backup(&state.config, &slug).await?;
        }
        "countdown" => {
            let cid = payload.get("countdown_id").and_then(|v| v.as_i64())
                .ok_or_else(|| anyhow::anyhow!("missing 'countdown_id'"))?;
            crate::handlers::events::do_start(state, cid, "scheduler").await?;
        }
        other => return Err(anyhow::anyhow!("unknown action_type '{other}'")),
    }
    Ok(())
}

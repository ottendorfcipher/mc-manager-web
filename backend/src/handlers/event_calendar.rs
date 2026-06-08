//! Calendar of upcoming scheduled automations.
//!
//! GET /api/events/calendar?days=30  (members with events.status.view)
//!
//! Expands each enabled scheduled job's cron expression into its upcoming
//! occurrences within the window, so the frontend can render them on a calendar.

use axum::{
    extract::{Query, State},
    Json,
};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    auth::middleware::AuthUser,
    db::scheduled_jobs,
    error::Result,
    minecraft::cron::Cron,
    state::AppState,
};

#[derive(Deserialize)]
pub struct CalendarQuery {
    #[serde(default = "default_days")]
    pub days: i64,
}
fn default_days() -> i64 { 30 }

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct CalendarEvent {
    pub title:       String,
    pub kind:        String, // "automation"
    pub action_type: String,
    pub when:        String, // RFC3339 (UTC)
}

/// Per-job occurrence cap so an every-minute cron can't explode the response.
const MAX_PER_JOB: usize = 120;

pub async fn calendar(
    State(state): State<AppState>,
    actor: AuthUser,
    Query(q): Query<CalendarQuery>,
) -> Result<Json<Vec<CalendarEvent>>> {
    crate::auth::middleware::require_perm(&actor, "events.status.view")?;

    let days = q.days.clamp(1, 90);
    let now = Utc::now();
    let until = now + Duration::days(days);

    let jobs = scheduled_jobs::list(&state.pool).await?;
    let mut out: Vec<CalendarEvent> = Vec::new();

    for job in jobs.iter().filter(|j| j.enabled != 0) {
        let Ok(cron) = Cron::parse(&job.cron_expr) else { continue };
        let mut t = now;
        for _ in 0..MAX_PER_JOB {
            match cron.next_after(t) {
                Some(next) if next <= until => {
                    out.push(CalendarEvent {
                        title:       job.name.clone(),
                        kind:        "automation".into(),
                        action_type: job.action_type.clone(),
                        when:        next.to_rfc3339(),
                    });
                    t = next;
                }
                _ => break,
            }
        }
    }

    out.sort_by(|a, b| a.when.cmp(&b.when));
    Ok(Json(out))
}

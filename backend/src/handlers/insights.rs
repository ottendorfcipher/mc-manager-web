//! Player activity insights — playtime + peak-hours aggregates.
//!
//! GET /api/players/insights?days=30  (member+; `nav.players`)

use axum::{
    extract::{Query, State},
    Json,
};
use serde::Deserialize;

use crate::{
    auth::middleware::{require_perm, AuthUser},
    db::player_sessions::{self, ActivityInsights},
    error::Result,
    state::AppState,
};

#[derive(Deserialize)]
pub struct InsightsQuery {
    #[serde(default = "default_days")]
    pub days: i64,
}
fn default_days() -> i64 {
    30
}

pub async fn get(
    State(state): State<AppState>,
    actor: AuthUser,
    Query(q): Query<InsightsQuery>,
) -> Result<Json<ActivityInsights>> {
    require_perm(&actor, "nav.players")?;
    Ok(Json(player_sessions::insights(&state.pool, q.days).await?))
}

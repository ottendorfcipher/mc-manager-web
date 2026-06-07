//! Liveness + readiness probes.
//!
//! These power the deploy script's post-restart health check, nginx/uptime
//! monitoring, and any future load balancer.  They are intentionally
//! **unauthenticated** and registered in `lib.rs` *after* the auth / rate-limit
//! / Tailscale-guard layers, so a local `curl http://127.0.0.1:<port>/health`
//! always succeeds regardless of VPN state or throttling.
//!
//!   • `GET /health` — liveness: 200 as long as the process can serve requests.
//!   • `GET /ready`  — readiness: 200 only if the database answers a trivial
//!     query; 503 otherwise (so a deploy can fail fast on a broken DB).

use std::sync::OnceLock;
use std::time::Instant;

use axum::{extract::State, http::StatusCode, Json};
use serde_json::json;

use crate::state::AppState;

/// Process start time, primed once via [`init`] at router-build time so uptime
/// is measured from boot rather than from the first probe.
fn start() -> Instant {
    static START: OnceLock<Instant> = OnceLock::new();
    *START.get_or_init(Instant::now)
}

/// Prime the start-time clock.  Called from `build_router`.
pub fn init() {
    let _ = start();
}

/// Seconds since the process started serving.
pub fn uptime_secs() -> u64 {
    start().elapsed().as_secs()
}

/// GET /health — liveness.
pub async fn health() -> Json<serde_json::Value> {
    Json(json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
        "uptime_secs": uptime_secs(),
    }))
}

/// GET /ready — readiness (checks DB connectivity; reports pool stats).
pub async fn ready(State(state): State<AppState>) -> (StatusCode, Json<serde_json::Value>) {
    match sqlx::query_scalar::<_, i64>("SELECT 1")
        .fetch_one(&state.pool)
        .await
    {
        Ok(_) => {
            // Background-runner heartbeat ages (seconds since last loop tick).
            let runners: serde_json::Map<String, serde_json::Value> =
                crate::heartbeat::snapshot()
                    .into_iter()
                    .map(|(name, age)| (name.to_string(), json!(age)))
                    .collect();
            (
                StatusCode::OK,
                Json(json!({
                    "status": "ready",
                    "db": "ok",
                    "uptime_secs": uptime_secs(),
                    "db_pool": { "connections": state.pool.size(), "idle": state.pool.num_idle() },
                    "runner_heartbeat_age_secs": runners,
                })),
            )
        }
        Err(e) => {
            tracing::warn!(error = %e, "readiness probe: database unreachable");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "status": "unavailable", "db": "unreachable" })),
            )
        }
    }
}

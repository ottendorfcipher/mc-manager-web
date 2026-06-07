//! Prometheus-format `/metrics` endpoint.
//!
//! Exposes cheap, always-available operational gauges read straight from
//! `AppState` — no extra dependency and no per-runner instrumentation. Like the
//! health probes it is registered *after* the auth/rate-limit/Tailscale layers
//! in `lib.rs`, so a node-local Prometheus scraper can reach it without a JWT.
//! It is not proxied by nginx, so it is only reachable over localhost/Tailscale.
//!
//! Metrics:
//!   • redstonecipher_uptime_seconds          — process uptime
//!   • redstonecipher_build_info{version}     — 1 (version as a label)
//!   • redstonecipher_db_pool_connections     — open SQLite pool connections
//!   • redstonecipher_db_pool_idle            — idle pool connections
//!   • redstonecipher_sse_subscribers{channel}— live SSE listeners per channel
//!   • redstonecipher_event_active{kind}      — 1 while an event runner is live

use axum::{extract::State, http::header, response::IntoResponse};

use crate::handlers::health;
use crate::state::AppState;

/// GET /metrics — Prometheus text exposition format (v0.0.4).
pub async fn metrics(State(state): State<AppState>) -> impl IntoResponse {
    let mut out = String::with_capacity(1024);

    let mut gauge = |name: &str, help: &str, labels: &str, value: i64, body: &mut String| {
        body.push_str(&format!("# HELP {name} {help}\n"));
        body.push_str(&format!("# TYPE {name} gauge\n"));
        body.push_str(&format!("{name}{labels} {value}\n"));
    };

    gauge(
        "redstonecipher_uptime_seconds",
        "Process uptime in seconds.",
        "",
        health::uptime_secs() as i64,
        &mut out,
    );
    gauge(
        "redstonecipher_build_info",
        "Build information; value is always 1.",
        &format!("{{version=\"{}\"}}", env!("CARGO_PKG_VERSION")),
        1,
        &mut out,
    );
    gauge(
        "redstonecipher_db_pool_connections",
        "Open SQLite connection-pool connections.",
        "",
        state.pool.size() as i64,
        &mut out,
    );
    gauge(
        "redstonecipher_db_pool_idle",
        "Idle SQLite connection-pool connections.",
        "",
        state.pool.num_idle() as i64,
        &mut out,
    );

    // Live SSE subscriber counts per broadcast channel.
    out.push_str("# HELP redstonecipher_sse_subscribers Live SSE subscribers per channel.\n");
    out.push_str("# TYPE redstonecipher_sse_subscribers gauge\n");
    for (channel, count) in [
        ("chat", state.chat_tx.receiver_count()),
        ("music", state.music_tx.receiver_count()),
        ("countdown", state.countdown_tx.receiver_count()),
        ("rising_oceans", state.rising_oceans_tx.receiver_count()),
        ("bounty_board", state.bounty_board_tx.receiver_count()),
    ] {
        out.push_str(&format!(
            "redstonecipher_sse_subscribers{{channel=\"{channel}\"}} {count}\n"
        ));
    }

    // Active-event gauges (1 while a runner holds live state).
    let countdown = state.countdown_active.lock().await.is_some() as i64;
    let rising = state.rising_oceans_active.lock().await.is_some() as i64;
    let bounty = state.bounty_board_active.lock().await.is_some() as i64;
    let music = state.music_current.lock().await.is_some() as i64;
    out.push_str("# HELP redstonecipher_event_active Whether a given event/runner currently holds live state.\n");
    out.push_str("# TYPE redstonecipher_event_active gauge\n");
    for (kind, v) in [
        ("countdown", countdown),
        ("rising_oceans", rising),
        ("bounty_board", bounty),
        ("music_playing", music),
    ] {
        out.push_str(&format!(
            "redstonecipher_event_active{{kind=\"{kind}\"}} {v}\n"
        ));
    }

    // Background-runner heartbeats — seconds since each runner last completed a
    // loop iteration. Event runners (countdown/rising/bounty) only beat while
    // active, so their age grows while idle; the always-on runners (chat_watcher,
    // music_zone, scheduled, pin_hud) should stay low.
    out.push_str("# HELP redstonecipher_runner_heartbeat_age_seconds Seconds since a background runner last beat.\n");
    out.push_str("# TYPE redstonecipher_runner_heartbeat_age_seconds gauge\n");
    for (runner, age) in crate::heartbeat::snapshot() {
        out.push_str(&format!(
            "redstonecipher_runner_heartbeat_age_seconds{{runner=\"{runner}\"}} {age}\n"
        ));
    }

    (
        [(header::CONTENT_TYPE, "text/plain; version=0.0.4")],
        out,
    )
}

use std::net::IpAddr;

use axum::{
    body::Body,
    extract::State,
    http::{Method, Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

use crate::{db::kill_switch, state::AppState};

/// Network-layer guard.
///
/// Cloud Run’s sandbox prevents `tailscale serve` from accepting inbound
/// WireGuard connections, so Tailscale IP-based gating is not viable.
/// Instead, authentication is handled by Google OAuth (JWT cookies) via
/// the auth middleware on all `/api/*` routes.  The `/internal/budget-alert`
/// webhook is protected by a shared-secret token.
///
/// This middleware is intentionally a pass-through.  It’s kept as a
/// named layer so a future migration (e.g. to Cloud Run on GKE where
/// Tailscale *can* accept inbound connections) only needs to flip this
/// one function back to an IP check.
pub async fn tailscale_guard(req: Request<Body>, next: Next) -> Response {
    next.run(req).await
}

/// Blocks any mutating HTTP method when the kill-switch is engaged.
/// Allowed pass-through when engaged:
///   - `GET`/`HEAD` (read-only)
///   - `DELETE /api/kill-switch` (so operators can release it)
///   - `/auth/*` (sign-in / sign-out)
pub async fn kill_switch_guard(
    State(state): State<AppState>,
    req: Request<Body>,
    next: Next,
) -> Response {
    let method = req.method().clone();
    let path = req.uri().path().to_owned();

    let is_read_only = matches!(method, Method::GET | Method::HEAD | Method::OPTIONS);
    let is_exempt = path.starts_with("/auth/") || path == "/api/kill-switch";

    if !is_read_only && !is_exempt {
        match kill_switch::status(&state.pool).await {
            Ok(ks) if ks.is_engaged() => {
                return (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(json!({
                        "error":  "Tool is disabled by the kill-switch",
                        "reason": ks.reason,
                        "source": ks.source,
                    })),
                )
                    .into_response();
            }
            Ok(_) => {}
            Err(e) => {
                tracing::error!(error = %e, "Kill-switch lookup failed; allowing request");
            }
        }
    }

    next.run(req).await
}

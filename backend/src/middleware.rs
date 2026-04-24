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

/// Restricts every HTTP route to requests arriving through the Tailscale
/// WireGuard overlay network.
///
/// How it works
/// ─────────────
/// `tailscale serve` (running in the container) acts as an HTTPS reverse proxy
/// for the Tailscale MagicDNS address and injects an `X-Forwarded-For` header
/// containing the caller's Tailscale CGNAT IP (100.64.0.0/10).
///
/// Decision table
/// ─────────────────────────────────────────────────────────────────────────
///  X-Forwarded-For absent            → local/direct connection → ALLOW
///    (local dev, Cloud Run TCP health probes — these never set this header)
///  X-Forwarded-For first IP 100.64/10 → Tailscale user           → ALLOW
///  X-Forwarded-For first IP outside   → public internet          → 403
/// ─────────────────────────────────────────────────────────────────────────
///
/// The `/internal/budget-alert` endpoint is exempted so GCP Pub/Sub (which
/// sends budget notifications from GCP IP ranges) can still reach the webhook.
/// That endpoint has its own shared-secret token authentication.
pub async fn tailscale_guard(req: Request<Body>, next: Next) -> Response {
    // Budget webhook is invoked by GCP Pub/Sub from non-Tailscale IPs.
    if req.uri().path() == "/internal/budget-alert" {
        return next.run(req).await;
    }

    let forwarded_ip = req
        .headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        // Take only the leftmost (original client) entry in the XFF chain
        .and_then(|s| s.split(',').next())
        .and_then(|s| s.trim().parse::<IpAddr>().ok());

    match forwarded_ip {
        // No XFF header → local dev or Cloud Run internal probe → allow
        None => next.run(req).await,
        // Tailscale CGNAT IP → allow
        Some(ip) if is_tailscale_ip(ip) => next.run(req).await,
        // Any other IP → reject
        Some(ip) => {
            tracing::warn!(
                source_ip = %ip,
                path = req.uri().path(),
                "Blocked: request is not from a Tailscale node"
            );
            (
                StatusCode::FORBIDDEN,
                "This service is only accessible through the Tailscale network.\n",
            )
                .into_response()
        }
    }
}

/// Returns `true` iff `ip` falls within Tailscale's CGNAT allocation.
/// Range: 100.64.0.0/10  (100.64.0.0 – 100.127.255.255)
fn is_tailscale_ip(ip: IpAddr) -> bool {
    if let IpAddr::V4(v4) = ip {
        let [a, b, ..] = v4.octets();
        a == 100 && (64..=127).contains(&b)
    } else {
        false // Tailscale uses IPv4 CGNAT only
    }
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

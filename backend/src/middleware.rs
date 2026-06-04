use axum::{
    body::Body,
    extract::{ConnectInfo, State},
    http::{Method, Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

use crate::{db::kill_switch, state::AppState};

/// Network-layer guard — currently a pass-through.
/// Authentication is handled by Google OAuth (JWT cookies) on all /api/* routes.
pub async fn tailscale_guard(req: Request<Body>, next: Next) -> Response {
    next.run(req).await
}

/// Add strict security headers to every response.
///
/// These complement HTTPS + HttpOnly cookies to close common web attack
/// vectors:
///   • CSP  — blocks inline scripts and limits load origins → XSS mitigation
///   • HSTS — forces HTTPS for 1 year, include subdomains
///   • X-Frame-Options — clickjacking prevention (belt-and-suspenders with CSP)
///   • X-Content-Type-Options — MIME-sniffing prevention
///   • Referrer-Policy — no referrer on cross-origin requests (privacy + info-leakage)
///   • Permissions-Policy — disables browser features not used by the app
pub async fn security_headers(req: Request<Body>, next: Next) -> Response {
    let mut response = next.run(req).await;
    let headers = response.headers_mut();

    // Content-Security-Policy
    // - default-src ‘self’: only load resources from our own origin
    // - script-src ‘self’: no inline scripts, no eval
    // - connect-src ‘self’ https://api.modrinth.com: API calls we legitimately make
    // - img-src ‘self’ data: https://mc-heads.net https://cdn.modrinth.com: player heads + plugin icons
    // - frame-ancestors ‘none’: no framing by anyone (stronger than X-Frame-Options)
    headers.insert(
        "Content-Security-Policy",
        "default-src ‘self’; \
         script-src ‘self’; \
         style-src ‘self’ ‘unsafe-inline’; \
         connect-src ‘self’ https://api.modrinth.com; \
         img-src ‘self’ data: blob: https://mc-heads.net https://cdn.modrinth.com https://lh3.googleusercontent.com; \
         font-src ‘self’; \
         frame-ancestors ‘none’; \
         base-uri ‘self’; \
         form-action ‘self’"
            .parse()
            .unwrap(),
    );

    // HSTS — 1 year, includeSubDomains, preload-ready
    headers.insert(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains".parse().unwrap(),
    );

    // Belt-and-suspenders clickjacking protection (not all browsers support CSP frame-ancestors yet)
    headers.insert("X-Frame-Options", "DENY".parse().unwrap());

    // Block MIME-type sniffing attacks
    headers.insert("X-Content-Type-Options", "nosniff".parse().unwrap());

    // Don’t send Referer header cross-origin
    headers.insert("Referrer-Policy", "strict-origin-when-cross-origin".parse().unwrap());

    // Disable browser features the app doesn’t use
    headers.insert(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), payment=(), usb=()".parse().unwrap(),
    );

    // Remove server version fingerprinting (belt-and-suspenders — nginx also strips this)
    headers.remove("x-powered-by");
    headers.remove("server");

    response
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
    // The middleware is applied to the /api sub-router (nested), so Axum
    // strips the /api prefix before reaching this middleware.  The path here
    // is therefore "/kill-switch", not "/api/kill-switch".
    // /auth/* routes live on the outer router and never reach this middleware.
    let is_exempt = path == "/kill-switch";

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

//! Read-only Tailscale endpoints.
//!
//! Used by the dashboard banner that warns "your device isn't on the VPN
//! right now" so a player whose Tailscale just dropped can see the
//! actual cause instead of assuming the MC server is down.

use axum::Json;

use crate::{
    auth::middleware::AuthUser,
    error::Result,
    gcloud::tailscale::{self, TsDevice},
};

/// GET /api/tailscale/my-devices
///
/// Returns the requesting user's own Tailscale nodes (matched by
/// LoginName == user.email).  Returns an empty array — not an error —
/// when the user has a web account but no Tailnet membership: the UI
/// hides the whole banner in that case.
pub async fn my_devices(actor: AuthUser) -> Result<Json<Vec<TsDevice>>> {
    let devices = tailscale::devices_for_user(&actor.email).await
        .unwrap_or_else(|e| {
            // Surface the error to logs but never to the UI — a tailscale
            // CLI hiccup shouldn't make the dashboard render an error.
            tracing::warn!(error = %e, "tailscale: my_devices lookup failed");
            Vec::new()
        });
    Ok(Json(devices))
}

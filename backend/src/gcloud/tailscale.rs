//! Read-only wrapper around the local `tailscale` CLI.
//!
//! Used by the dashboard "your device is offline" banner so a user
//! who's silently fallen off the VPN can see why the MC server "feels
//! down" without having to know what Tailscale is.
//!
//! We invoke `tailscale status --json` (cheap, < 100 ms in practice)
//! and project the bits we care about into a stable wire shape.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::process::Command;
use ts_rs::TS;

use crate::error::{AppError, Result};

const TS_CLI_TIMEOUT: Duration = Duration::from_secs(5);

/// One Tailscale node we report to the UI.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TsDevice {
    pub hostname:   String,
    pub os:         String,
    pub ips:        Vec<String>,
    pub online:     bool,
    /// ISO-8601 timestamp from Tailscale.  `None` for nodes that have
    /// never connected (their `LastSeen` is the zero-value `0001-01-01`).
    pub last_seen:  Option<String>,
    /// True when this node is the local Tailscale agent we ran the
    /// CLI on — i.e. the web VPS itself.  Helpful for UI filtering.
    pub is_self:    bool,
}

/// Return the list of Tailscale peers owned by the given user email,
/// plus the local node if it's owned by them.  Returns an empty list
/// when no Tailscale user matches — that's a valid state (the user has
/// a web account but no Tailnet membership) and not an error.
pub async fn devices_for_user(email: &str) -> Result<Vec<TsDevice>> {
    let raw = run_status_json().await?;
    let parsed: TsStatusRaw = serde_json::from_str(&raw)
        .map_err(|e| AppError::ExternalCommand(format!("tailscale status JSON: {e}")))?;

    // Resolve the user ID from the email.  Tailscale stores it on the
    // `User` map keyed by ID; we walk it by LoginName.
    let user_id = parsed.user.iter()
        .find_map(|(id, u)| {
            if u.login_name.eq_ignore_ascii_case(email) { id.parse::<i64>().ok() } else { None }
        });
    let user_id = match user_id {
        Some(id) => id,
        None => return Ok(Vec::new()),
    };

    let mut out: Vec<TsDevice> = Vec::new();

    // Include self if owned by this user.
    if parsed.self_node.user_id == user_id {
        out.push(to_device(&parsed.self_node, true));
    }

    for peer in parsed.peer.values() {
        if peer.user_id != user_id { continue; }
        out.push(to_device(peer, false));
    }

    // Stable sort: online first, then most-recently-seen.
    out.sort_by(|a, b| {
        b.online.cmp(&a.online)
            .then_with(|| b.last_seen.cmp(&a.last_seen))
    });
    Ok(out)
}

fn to_device(p: &TsPeerRaw, is_self: bool) -> TsDevice {
    // Tailscale uses 0001-01-01 as "never" — surface that as None so
    // the UI doesn't render a nonsense date.
    let last_seen = if p.last_seen.starts_with("0001-") {
        None
    } else {
        Some(p.last_seen.clone())
    };
    TsDevice {
        hostname:  p.host_name.clone(),
        os:        p.os.clone(),
        ips:       p.tailscale_ips.clone(),
        // The CLI sometimes reports nodes as offline that pinged
        // seconds ago.  `Online` is the authoritative flag in the
        // JSON output, so we trust it as-is.
        online:    p.online,
        last_seen,
        is_self,
    }
}

async fn run_status_json() -> Result<String> {
    let fut = Command::new("tailscale")
        .args(["status", "--json"])
        .output();
    let out = tokio::time::timeout(TS_CLI_TIMEOUT, fut)
        .await
        .map_err(|_| AppError::ExternalCommand("tailscale CLI timed out".into()))?
        .map_err(|e| AppError::ExternalCommand(format!("tailscale CLI spawn: {e}")))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(AppError::ExternalCommand(format!(
            "tailscale status failed: {}", stderr.trim()
        )));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

// ── Raw JSON shapes (subset of the full `tailscale status --json` payload) ───

#[derive(Deserialize)]
struct TsStatusRaw {
    #[serde(rename = "Self")]
    self_node: TsPeerRaw,
    #[serde(rename = "Peer")]
    peer:      std::collections::HashMap<String, TsPeerRaw>,
    #[serde(rename = "User")]
    user:      std::collections::HashMap<String, TsUserRaw>,
}

#[derive(Deserialize, Default)]
struct TsPeerRaw {
    #[serde(rename = "HostName", default)]
    host_name:     String,
    #[serde(rename = "OS", default)]
    os:            String,
    #[serde(rename = "UserID", default)]
    user_id:       i64,
    #[serde(rename = "TailscaleIPs", default)]
    tailscale_ips: Vec<String>,
    #[serde(rename = "Online", default)]
    online:        bool,
    #[serde(rename = "LastSeen", default)]
    last_seen:     String,
}

#[derive(Deserialize)]
struct TsUserRaw {
    #[serde(rename = "LoginName", default)]
    login_name:    String,
}

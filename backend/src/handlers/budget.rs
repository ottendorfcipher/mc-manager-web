use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;

use crate::{
    db::kill_switch,
    state::AppState,
};

/// Pub/Sub push message envelope.
///
/// See: https://cloud.google.com/pubsub/docs/push
#[derive(Debug, Deserialize)]
pub struct PubSubEnvelope {
    pub message: PubSubMessage,
    pub subscription: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PubSubMessage {
    /// Base64-encoded JSON body (the actual Budget Alert payload).
    pub data: Option<String>,
    #[serde(default)]
    pub attributes: std::collections::HashMap<String, String>,
    #[serde(rename = "messageId")]
    pub message_id: Option<String>,
}

/// Budget alert body emitted by Cloud Billing. We deserialise only the fields
/// we act on; unknown fields are ignored.
///
/// Schema: https://cloud.google.com/billing/docs/how-to/budgets-programmatic-notifications#notification_format
#[derive(Debug, Deserialize)]
struct BudgetAlert {
    #[serde(rename = "costAmount")]
    cost_amount: f64,
    #[serde(rename = "budgetAmount")]
    budget_amount: f64,
    #[serde(rename = "budgetDisplayName")]
    #[allow(dead_code)]
    budget_display_name: Option<String>,
    #[serde(rename = "alertThresholdExceeded")]
    alert_threshold_exceeded: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct BudgetWebhookQuery {
    /// Shared secret supplied by the operator when creating the push
    /// subscription (`?token=...`). Keeps arbitrary callers from hitting us.
    pub token: String,
}

/// POST /internal/budget-alert?token=SHARED_SECRET
///
/// Validates the shared secret, parses the Budget Alert body, and engages the
/// kill-switch when the alert threshold is >= 1.0 (100%).
pub async fn webhook(
    State(state): State<AppState>,
    Query(q): Query<BudgetWebhookQuery>,
    Json(env): Json<PubSubEnvelope>,
) -> impl IntoResponse {
    // Compare against the server-side secret sourced from env at startup.
    let Some(expected) = state.config.budget_webhook_token.as_deref() else {
        tracing::warn!("Budget webhook invoked but BUDGET_WEBHOOK_TOKEN is not configured");
        return (StatusCode::NOT_FOUND, "budget webhook disabled").into_response();
    };
    if !constant_time_eq(q.token.as_bytes(), expected.as_bytes()) {
        return (StatusCode::UNAUTHORIZED, "invalid token").into_response();
    }

    let Some(b64) = env.message.data.as_deref() else {
        // Some notifications arrive with attributes only; nothing to act on.
        return (StatusCode::NO_CONTENT, ()).into_response();
    };
    let decoded = match STANDARD.decode(b64) {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!(error = %e, "Budget alert: base64 decode failed");
            return (StatusCode::BAD_REQUEST, "bad base64").into_response();
        }
    };

    let alert: BudgetAlert = match serde_json::from_slice(&decoded) {
        Ok(a) => a,
        Err(e) => {
            tracing::warn!(error = %e, "Budget alert: JSON parse failed");
            return (StatusCode::BAD_REQUEST, "bad alert schema").into_response();
        }
    };

    let ratio = if alert.budget_amount > 0.0 {
        alert.cost_amount / alert.budget_amount
    } else {
        0.0
    };
    tracing::info!(
        cost = alert.cost_amount,
        budget = alert.budget_amount,
        ratio,
        threshold = alert.alert_threshold_exceeded,
        "Budget alert received",
    );

    // Engage at >= 100%. Lower thresholds (e.g. 50/90) only log.
    let should_engage =
        alert.alert_threshold_exceeded.unwrap_or(ratio) >= 1.0 || ratio >= 1.0;
    if should_engage {
        let reason = format!(
            "Budget exceeded: ${:.2} of ${:.2}",
            alert.cost_amount, alert.budget_amount
        );
        if let Err(e) = kill_switch::engage(&state.pool, &reason, "budget-webhook").await {
            tracing::error!(error = %e, "Failed to engage kill-switch from budget webhook");
            return (StatusCode::INTERNAL_SERVER_ERROR, "engage failed").into_response();
        }
    }

    (StatusCode::NO_CONTENT, ()).into_response()
}

/// Constant-time byte comparison. A naive `==` would leak the secret via
/// timing side-channels to any remote attacker who can measure our response.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::constant_time_eq;

    #[test]
    fn equal_slices_match() {
        assert!(constant_time_eq(b"secret", b"secret"));
    }

    #[test]
    fn different_content_does_not_match() {
        assert!(!constant_time_eq(b"secret", b"SECRET"));
    }

    #[test]
    fn different_length_does_not_match() {
        assert!(!constant_time_eq(b"short", b"longer"));
    }

    #[test]
    fn empty_slices_match() {
        assert!(constant_time_eq(b"", b""));
    }

    #[test]
    fn one_empty_does_not_match_nonempty() {
        assert!(!constant_time_eq(b"", b"x"));
        assert!(!constant_time_eq(b"x", b""));
    }

    #[test]
    fn single_bit_difference_does_not_match() {
        // Tokens that differ by exactly one bit in one byte
        assert!(!constant_time_eq(b"\x00", b"\x01"));
    }
}

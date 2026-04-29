use axum::{extract::State, Json};

use crate::{
    auth::middleware::AuthUser,
    gcloud::ssh,
    state::AppState,
};

/// GET /api/metrics  — returns a single metrics snapshot (polled by the frontend).
///
/// Previously this was an SSE stream, but SSE holds connections open which
/// conflicts with Cloud Run's scale-to-zero and container recycling.
/// The frontend now polls this endpoint every 15 s instead.
pub async fn snapshot(
    State(state): State<AppState>,
    _: AuthUser,
) -> Json<serde_json::Value> {
    match ssh::fetch_metrics(&state.config).await {
        Ok(m) => Json(serde_json::to_value(&m).unwrap_or_default()),
        Err(e) => {
            tracing::warn!(error = %e, "Failed to fetch metrics via SSH");
            Json(serde_json::json!({ "error": "unreachable" }))
        }
    }
}

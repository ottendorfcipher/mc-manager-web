use axum::{extract::State, Json};
use crate::{auth::middleware::AuthUser, error::Result, minecraft::players, state::AppState};

pub async fn list(
    State(state): State<AppState>,
    _: AuthUser,
) -> Result<Json<Vec<players::McPlayer>>> {
    Ok(Json(players::fetch_all(&state.config).await?))
}

use crate::{auth::middleware::AuthUser, error::Result, minecraft::players, state::AppState};
use axum::{extract::State, Json};

pub async fn list(
    State(state): State<AppState>,
    _: AuthUser,
) -> Result<Json<Vec<players::McPlayer>>> {
    Ok(Json(players::fetch_all(&state.config).await?))
}

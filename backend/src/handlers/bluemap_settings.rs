use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::{
    auth::middleware::AuthUser,
    db::prefs,
    error::{AppError, Result},
    state::AppState,
};

const ADVANCED_UI_KEY: &str = "bluemap.advanced_ui_enabled";

#[derive(Debug, Serialize)]
pub struct BlueMapSettings {
    pub advanced_ui_enabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct UpdateBlueMapSettings {
    pub advanced_ui_enabled: bool,
}

pub async fn get(State(state): State<AppState>, _actor: AuthUser) -> Result<Json<BlueMapSettings>> {
    let raw = prefs::get(&state.pool, ADVANCED_UI_KEY).await?;
    Ok(Json(BlueMapSettings {
        advanced_ui_enabled: raw.as_deref() == Some("true"),
    }))
}

pub async fn update(
    State(state): State<AppState>,
    actor: AuthUser,
    Json(body): Json<UpdateBlueMapSettings>,
) -> Result<Json<BlueMapSettings>> {
    if actor.role != "global_admin" {
        return Err(AppError::Forbidden(
            "Only global admins can change BlueMap settings".into(),
        ));
    }

    prefs::set(
        &state.pool,
        ADVANCED_UI_KEY,
        if body.advanced_ui_enabled {
            "true"
        } else {
            "false"
        },
    )
    .await?;

    Ok(Json(BlueMapSettings {
        advanced_ui_enabled: body.advanced_ui_enabled,
    }))
}

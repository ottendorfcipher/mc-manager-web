use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Redirect},
    Json,
};
use axum_extra::extract::{cookie::{Cookie, SameSite}, CookieJar};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    auth::{
        google::{authorization_url, exchange_code, generate_pkce},
        middleware::{issue_jwt, AuthUser, JWT_COOKIE},
    },
    db::{users, users::GLOBAL_ADMIN},
    error::{AppError, Result},
    state::AppState,
};

const PKCE_COOKIE:  &str = "rc_pkce_verifier";
const STATE_COOKIE: &str = "rc_oauth_state";

/// GET /auth/login  — redirect the browser to Google's consent screen
pub async fn login(State(state): State<AppState>) -> impl IntoResponse {
    let pkce = generate_pkce();
    let url  = authorization_url(&state.config, &pkce.challenge, &pkce.state);

    let jar = CookieJar::new()
        .add(build_temp_cookie(PKCE_COOKIE,  pkce.verifier))
        .add(build_temp_cookie(STATE_COOKIE, pkce.state));

    (jar, Redirect::to(&url))
}

#[derive(Deserialize)]
pub struct CallbackParams {
    code:  String,
    state: String,
}

/// GET /auth/callback  — exchange code, issue JWT, redirect to frontend
pub async fn callback(
    State(state): State<AppState>,
    jar: CookieJar,
    Query(params): Query<CallbackParams>,
) -> Result<impl IntoResponse> {
    // CSRF check
    let stored_state = jar
        .get(STATE_COOKIE)
        .map(|c| c.value().to_owned())
        .ok_or(AppError::Unauthenticated)?;

    if stored_state != params.state {
        return Err(AppError::Unauthenticated);
    }

    let verifier = jar
        .get(PKCE_COOKIE)
        .map(|c| c.value().to_owned())
        .ok_or(AppError::Unauthenticated)?;

    // Exchange code for Google user info
    let guser = exchange_code(
        &state.config,
        &params.code,
        &verifier,
        &state.http,
    )
    .await
    .map_err(|e| AppError::Internal(e))?;

    // Authorise: must exist in DB (or be the permanent global admin)
    let user = users::get(&state.pool, &guser.email).await?;
    let role = match user {
        Some(ref u) => u.role.clone(),
        None if guser.email == GLOBAL_ADMIN => "global_admin".to_string(),
        None => return Err(AppError::Forbidden(format!(
            "{} is not authorised. Ask the admin to add you.",
            guser.email
        ))),
    };

    // Upsert Google identity (sub, avatar) and last_login
    users::update_google_identity(
        &state.pool,
        &guser.email,
        &guser.sub,
        guser.picture.as_deref(),
    )
    .await?;

    let token = issue_jwt(&guser.email, &role, &state.config.jwt_secret)
        .map_err(|e| AppError::Internal(e))?;

    let session_cookie = Cookie::build((JWT_COOKIE, token))
        .http_only(true)
        .same_site(SameSite::Lax)   // Lax allows redirect after OAuth
        .path("/")
        .max_age(time::Duration::hours(8))
        .build();

    let jar = jar
        .add(session_cookie)
        .remove(Cookie::from(PKCE_COOKIE))
        .remove(Cookie::from(STATE_COOKIE));

    Ok((jar, Redirect::to("/")))
}

/// DELETE /auth/logout
pub async fn logout(jar: CookieJar) -> impl IntoResponse {
    let jar = jar.remove(Cookie::from(JWT_COOKIE));
    (jar, StatusCode::NO_CONTENT)
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct MeResponse {
    pub email:        String,
    pub role:         String,
    pub display_name: String,
    pub avatar_url:   Option<String>,
    pub permissions:  Permissions,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct Permissions {
    pub can_manage_users:   bool,
    pub can_control_server: bool,
    pub can_write_config:   bool,
    pub can_restore_backup: bool,
    pub can_manage_admins:  bool,
}

/// GET /api/me
pub async fn me(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<Json<MeResponse>> {
    let user = users::get(&state.pool, &actor.email)
        .await?
        .ok_or_else(|| AppError::NotFound("User record not found".into()))?;

    Ok(Json(MeResponse {
        email:        user.email,
        display_name: user.display_name,
        avatar_url:   user.avatar_url,
        permissions: Permissions {
            can_manage_users:   actor.can_manage_users(),
            can_control_server: actor.can_control_server(),
            can_write_config:   actor.can_write_config(),
            can_restore_backup: actor.can_restore_backup(),
            can_manage_admins:  actor.can_manage_admins(),
        },
        role: user.role,
    }))
}

fn build_temp_cookie(name: &'static str, value: String) -> Cookie<'static> {
    Cookie::build((name, value))
        .http_only(true)
        .same_site(SameSite::Lax)
        .path("/")
        .max_age(time::Duration::minutes(10))
        .build()
}

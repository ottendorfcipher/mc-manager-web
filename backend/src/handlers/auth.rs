use axum::{
    extract::{Query, State},
    response::{IntoResponse, Redirect, Response},
    Json,
};
use axum_extra::extract::{
    cookie::{Cookie, SameSite},
    CookieJar,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    auth::{
        google::{
            authorization_url, decode_oauth_state, encode_oauth_state, exchange_code, generate_pkce,
        },
        middleware::{issue_jwt, AuthUser, JWT_COOKIE},
    },
    db::users,
    error::{AppError, Result},
    state::AppState,
};

/// Recoverable sign-in failure codes surfaced to the SPA via `?error=`.
/// Keep this list in sync with `frontend/src/features/auth/useLoginError.ts`.
mod err_code {
    pub const STATE_MISMATCH: &str = "state_mismatch";
    pub const TOKEN_EXCHANGE: &str = "token_exchange";
    pub const NOT_INVITED: &str = "not_invited";
    pub const OAUTH_DENIED: &str = "oauth_denied";
}

/// Redirect to the login page with an error code.
/// No temp cookies to clear — state is carried in the OAuth `state` JWT.
fn login_error(code: &str) -> Response {
    Redirect::to(&format!("/login?error={code}")).into_response()
}

/// GET /auth/login  — redirect the browser to Google's consent screen.
///
/// The PKCE verifier is embedded in the OAuth `state` parameter as a signed
/// JWT (valid 10 min) rather than in browser cookies.  Firebase Hosting strips
/// all Set-Cookie headers on Cloud Run rewrites except `__session`, so cookies
/// can’t be used for the short-lived PKCE/state values.
pub async fn login(State(state): State<AppState>) -> impl IntoResponse {
    let pkce = generate_pkce();

    // Embed verifier in a signed JWT used as the OAuth state param.
    // On callback Google echoes it back verbatim, so no browser storage needed.
    let state_jwt = match encode_oauth_state(&pkce.verifier, &state.config.jwt_secret) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!(error = %e, "Failed to encode OAuth state");
            return login_error(err_code::STATE_MISMATCH);
        }
    };
    let url = authorization_url(&state.config, &pkce.challenge, &state_jwt);
    Redirect::to(&url).into_response()
}

#[derive(Deserialize)]
pub struct CallbackParams {
    code: Option<String>,
    state: Option<String>,
    /// Google sends `error=access_denied` when the user dismisses consent.
    error: Option<String>,
}

/// GET /auth/callback  — exchange code, issue JWT, redirect to frontend.
/// Recoverable failures redirect to `/login?error=<code>` instead of 5xx so
/// the SPA can render a human-readable banner.
pub async fn callback(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: axum::http::HeaderMap,
    Query(params): Query<CallbackParams>,
) -> Response {
    // The user clicked "Cancel" on Google's consent screen.
    if params.error.is_some() {
        return login_error(err_code::OAUTH_DENIED);
    }

    let (code, state_jwt) = match (params.code, params.state) {
        (Some(c), Some(s)) => (c, s),
        _ => return login_error(err_code::STATE_MISMATCH),
    };

    // Decode + verify the signed state JWT to recover the PKCE verifier.
    // The signature check also serves as CSRF protection — only our server
    // could have produced a valid token.
    let verifier = match decode_oauth_state(&state_jwt, &state.config.jwt_secret) {
        Ok(claims) => claims.verifier,
        Err(e) => {
            tracing::warn!(error = %e, "OAuth state JWT invalid");
            return login_error(err_code::STATE_MISMATCH);
        }
    };

    // Exchange code for Google user info
    let guser = match exchange_code(&state.config, &code, &verifier, &state.http).await {
        Ok(u) => u,
        Err(e) => {
            tracing::warn!(error = %e, "Google token exchange failed");
            return login_error(err_code::TOKEN_EXCHANGE);
        }
    };

    // Authorise: must exist in DB (or be the permanent global admin)
    let user = match users::get(&state.pool, &guser.email).await {
        Ok(u) => u,
        Err(e) => {
            tracing::error!(error = %e, "DB lookup failed during callback");
            return AppError::from(e).into_response();
        }
    };
    let role = match user {
        Some(ref u) => u.role.clone(),
        None if !users::global_admin().is_empty() && guser.email == users::global_admin() => {
            "global_admin".to_string()
        }
        None => return login_error(err_code::NOT_INVITED),
    };

    // Upsert Google identity (sub, avatar) and last_login
    if let Err(e) = users::update_google_identity(
        &state.pool,
        &guser.email,
        &guser.sub,
        guser.picture.as_deref(),
    )
    .await
    {
        tracing::error!(error = %e, "Failed to update Google identity");
        return AppError::from(e).into_response();
    }

    let token = match issue_jwt(&guser.email, &role, &state.config.jwt_secret) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!(error = %e, "Failed to issue JWT");
            return AppError::Internal(e).into_response();
        }
    };

    // Record the sign-in for the "recent sign-ins" view (best-effort, off the
    // hot path). IP comes from nginx's forwarding headers.
    {
        let ua = headers
            .get(axum::http::header::USER_AGENT)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.chars().take(256).collect::<String>());
        let ip = headers
            .get("x-forwarded-for")
            .or_else(|| headers.get("x-real-ip"))
            .and_then(|v| v.to_str().ok())
            .map(|s| s.split(',').next().unwrap_or("").trim().to_string());
        let pool = state.pool.clone();
        let email = guser.email.clone();
        tokio::spawn(async move {
            if let Err(e) = crate::db::login_events::record(&pool, &email, ip.as_deref(), ua.as_deref()).await {
                tracing::warn!(error = %e, "failed to record login event");
            }
        });
    }

    // `__session` is the only cookie Firebase Hosting forwards through Cloud
    // Run rewrites.  All other names are stripped on both requests and responses.
    let session_cookie = Cookie::build((JWT_COOKIE, token))
        .http_only(true)
        .secure(true)
        .same_site(SameSite::Lax) // Lax allows redirect after OAuth
        .path("/")
        .max_age(time::Duration::hours(8))
        .build();

    (jar.add(session_cookie), Redirect::to("/")).into_response()
}

/// GET /auth/logout — clears the session cookie and redirects to /login
pub async fn logout(jar: CookieJar) -> impl IntoResponse {
    let jar = jar.remove(Cookie::from(JWT_COOKIE));
    (jar, Redirect::to("/login"))
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct MeResponse {
    pub email: String,
    pub role: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub permissions: Permissions,
    pub permission_keys: Vec<String>,
    /// When an admin is impersonating another user, this contains the
    /// real admin's email so the frontend can show the proxy banner.
    pub impersonating_as: Option<String>,
    /// The real admin's email — identical to `email` when not impersonating.
    pub real_email: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct Permissions {
    pub can_manage_users: bool,
    pub can_control_server: bool,
    pub can_write_config: bool,
    pub can_restore_backup: bool,
    pub can_manage_admins: bool,
}

/// GET /api/me
pub async fn me(State(state): State<AppState>, actor: AuthUser) -> Result<Json<MeResponse>> {
    let user = users::get(&state.pool, &actor.email)
        .await?
        .ok_or_else(|| AppError::NotFound("User record not found".into()))?;

    let mut permission_keys: Vec<String> = actor.permissions.iter().cloned().collect();
    permission_keys.sort();

    Ok(Json(MeResponse {
        email: user.email,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        permissions: Permissions {
            can_manage_users: actor.can_manage_users(),
            can_control_server: actor.can_control_server(),
            can_write_config: actor.can_write_config(),
            can_restore_backup: actor.can_restore_backup(),
            can_manage_admins: actor.can_manage_admins(),
        },
        permission_keys,
        role: user.role,
        impersonating_as: actor.impersonating_as.clone(),
        real_email: if actor.is_impersonating() { Some(actor.real_email.clone()) } else { None },
    }))
}

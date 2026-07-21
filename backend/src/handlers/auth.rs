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

    finish_login(
        &state,
        jar,
        headers,
        &guser.email,
        Some(&guser.sub),
        guser.picture.as_deref(),
    )
    .await
}

/// Shared tail of every login flow: authorize the email against the invite
/// list, refresh the user's identity, issue the session cookie, and redirect.
async fn finish_login(
    state: &AppState,
    jar: CookieJar,
    headers: axum::http::HeaderMap,
    email: &str,
    sub: Option<&str>,
    avatar: Option<&str>,
) -> Response {
    // Authorize: must exist in the DB, or be the configured global admin.
    let user = match users::get(&state.pool, email).await {
        Ok(u) => u,
        Err(e) => {
            tracing::error!(error = %e, "DB lookup failed during callback");
            return AppError::from(e).into_response();
        }
    };
    let role = match user {
        Some(ref u) => u.role.clone(),
        None if !users::global_admin().is_empty() && email == users::global_admin() => {
            "global_admin".to_string()
        }
        None => {
            tracing::warn!(email = %email, "sign-in denied: email is not invited");
            return login_error(err_code::NOT_INVITED);
        }
    };

    // Refresh identity. Google carries a subject id and avatar; other providers
    // just touch last_login.
    let identity = match sub {
        Some(s) => users::update_google_identity(&state.pool, email, s, avatar).await,
        None => users::update_last_login(&state.pool, email).await,
    };
    if let Err(e) = identity {
        tracing::error!(error = %e, "Failed to update user identity");
        return AppError::from(e).into_response();
    }

    let token = match issue_jwt(email, &role, &state.config.jwt_secret) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!(error = %e, "Failed to issue JWT");
            return AppError::Internal(e).into_response();
        }
    };

    record_login_event(state, headers, email);
    issue_session(jar, token, state.config.cookie_secure)
}

/// Builds the `__session` cookie and redirects home. Shared by every login path.
/// `__session` is the only cookie some hosting layers forward through rewrites,
/// so the session always uses that name.
fn issue_session(jar: CookieJar, token: String, secure: bool) -> Response {
    let cookie = Cookie::build((JWT_COOKIE, token))
        .http_only(true)
        .secure(secure)
        .same_site(SameSite::Lax) // Lax allows the redirect after OAuth
        .path("/")
        .max_age(time::Duration::hours(8))
        .build();
    (jar.add(cookie), Redirect::to("/")).into_response()
}

/// Record a sign-in for the "recent sign-ins" view. Best-effort, off the hot
/// path. The client IP comes from the reverse proxy's forwarding headers.
fn record_login_event(state: &AppState, headers: axum::http::HeaderMap, email: &str) {
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
    let email = email.to_string();
    tokio::spawn(async move {
        if let Err(e) = crate::db::login_events::record(&pool, &email, ip.as_deref(), ua.as_deref()).await {
            tracing::warn!(error = %e, "failed to record login event");
        }
    });
}

// ── Cloudflare Access OIDC ───────────────────────────────────────────────────

/// GET /auth/login/cloudflare — redirect the browser to Cloudflare Access.
pub async fn login_cloudflare(State(state): State<AppState>) -> Response {
    if !state.config.cloudflare_enabled() {
        return login_error(err_code::OAUTH_DENIED);
    }
    // Reuse the signed-state machinery for CSRF. Cloudflare is a confidential
    // client (no PKCE), so a random nonce fills the verifier slot.
    let nonce = generate_pkce().state;
    let state_jwt = match encode_oauth_state(&nonce, &state.config.jwt_secret) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!(error = %e, "Failed to encode Cloudflare OAuth state");
            return login_error(err_code::STATE_MISMATCH);
        }
    };
    match crate::auth::cloudflare::authorization_url(&state.config, &state_jwt) {
        Some(url) => Redirect::to(&url).into_response(),
        None => login_error(err_code::OAUTH_DENIED),
    }
}

/// GET /auth/callback/cloudflare — exchange the code, then finish the session.
pub async fn callback_cloudflare(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: axum::http::HeaderMap,
    Query(params): Query<CallbackParams>,
) -> Response {
    if params.error.is_some() {
        return login_error(err_code::OAUTH_DENIED);
    }
    let (code, state_jwt) = match (params.code, params.state) {
        (Some(c), Some(s)) => (c, s),
        _ => return login_error(err_code::STATE_MISMATCH),
    };
    // Verify the state signature for CSRF. The nonce value itself is unused.
    if let Err(e) = decode_oauth_state(&state_jwt, &state.config.jwt_secret) {
        tracing::warn!(error = %e, "Cloudflare OAuth state JWT invalid");
        return login_error(err_code::STATE_MISMATCH);
    }
    let cfuser =
        match crate::auth::cloudflare::exchange_code(&state.config, &code, &state.http).await {
            Ok(u) => u,
            Err(e) => {
                tracing::warn!(error = %e, "Cloudflare token exchange failed");
                return login_error(err_code::TOKEN_EXCHANGE);
            }
        };
    finish_login(&state, jar, headers, &cfuser.email, None, None).await
}

/// Which login options are available. Public, so the login page can decide
/// which buttons to show.
#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct ProvidersResponse {
    pub google: bool,
    pub cloudflare: bool,
}

/// GET /auth/providers
pub async fn providers(State(state): State<AppState>) -> Json<ProvidersResponse> {
    Json(ProvidersResponse {
        google: true,
        cloudflare: state.config.cloudflare_enabled(),
    })
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

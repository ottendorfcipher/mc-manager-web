use anyhow::Context;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::config::Config;

const GOOGLE_AUTH_URL: &str  = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO:  &str = "https://www.googleapis.com/oauth2/v3/userinfo";

/// PKCE pair returned to the login handler.
/// The verifier is stored in a temporary cookie; the challenge is sent to Google.
pub struct PkceChallenge {
    pub verifier:  String,
    pub challenge: String,
    pub state:     String,
}

pub fn generate_pkce() -> PkceChallenge {
    let mut verifier_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut verifier_bytes);
    let verifier = URL_SAFE_NO_PAD.encode(verifier_bytes);

    let hash = Sha256::digest(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(hash);

    let mut state_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut state_bytes);
    let state = URL_SAFE_NO_PAD.encode(state_bytes);

    PkceChallenge { verifier, challenge, state }
}

pub fn authorization_url(cfg: &Config, challenge: &str, state: &str) -> String {
    format!(
        "{auth}?client_id={client_id}&redirect_uri={redirect}&response_type=code\
         &scope=openid%20email%20profile&code_challenge={challenge}\
         &code_challenge_method=S256&state={state}&access_type=online",
        auth        = GOOGLE_AUTH_URL,
        client_id   = cfg.google_client_id,
        redirect    = urlencoding::encode(&cfg.redirect_uri),
        challenge   = challenge,
        state       = state,
    )
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
pub struct GoogleUser {
    pub sub:     String,
    pub email:   String,
    pub name:    Option<String>,
    pub picture: Option<String>,
}

/// Exchange the authorisation code for an access token, then fetch the user profile.
pub async fn exchange_code(
    cfg: &Config,
    code: &str,
    verifier: &str,
    http: &reqwest::Client,
) -> anyhow::Result<GoogleUser> {
    let response = http
        .post(GOOGLE_TOKEN_URL)
        .form(&[
            ("code",          code),
            ("client_id",     &cfg.google_client_id),
            ("client_secret", &cfg.google_client_secret),
            ("redirect_uri",  &cfg.redirect_uri),
            ("grant_type",    "authorization_code"),
            ("code_verifier", verifier),
        ])
        .send()
        .await
        .context("Token request failed")?;

    let status = response.status();
    if !status.is_success() {
        // Capture Google's JSON error body so operators can see the real cause
        // (redirect_uri_mismatch, invalid_grant, invalid_client, …).
        let body = response.text().await.unwrap_or_default();
        tracing::warn!(
            status = %status,
            redirect_uri = %cfg.redirect_uri,
            body = %body,
            "Google token endpoint rejected the exchange",
        );
        anyhow::bail!("Token endpoint returned {status}: {body}");
    }

    let token_res: TokenResponse = response
        .json()
        .await
        .context("Token response parse failed")?;

    let user_info: GoogleUser = http
        .get(GOOGLE_USERINFO)
        .bearer_auth(&token_res.access_token)
        .send()
        .await
        .context("Userinfo request failed")?
        .error_for_status()
        .context("Userinfo endpoint returned error")?
        .json()
        .await
        .context("Userinfo response parse failed")?;

    Ok(user_info)
}

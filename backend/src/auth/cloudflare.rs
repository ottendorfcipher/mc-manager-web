//! Cloudflare Access (Zero Trust) OIDC login provider.
//!
//! Cloudflare has no consumer OAuth. Its login is Cloudflare Access, configured
//! as a SaaS OIDC application. That gives a confidential client (client id and
//! secret) plus per-team endpoints of the form:
//!
//!   https://<team>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client-id>/{authorization,token,userinfo}
//!
//! The flow mirrors the Google provider, minus PKCE (a confidential client uses
//! the client secret instead). CSRF is covered by the same signed `state` JWT.

use anyhow::Context;
use serde::Deserialize;

use crate::config::Config;

/// Normalize a team value into a host. Accepts "myteam",
/// "myteam.cloudflareaccess.com", or a full URL, and returns the bare host.
fn team_host(team: &str) -> String {
    let t = team.trim().trim_end_matches('/');
    let t = t.strip_prefix("https://").unwrap_or(t);
    let t = t.strip_prefix("http://").unwrap_or(t);
    if t.ends_with(".cloudflareaccess.com") {
        t.to_string()
    } else {
        format!("{t}.cloudflareaccess.com")
    }
}

/// Base OIDC URL for this team + client, or `None` when Cloudflare is unconfigured.
fn base_url(cfg: &Config) -> Option<String> {
    let team = cfg.cloudflare_team_domain.as_deref()?;
    let client_id = cfg.cloudflare_client_id.as_deref()?;
    Some(format!(
        "https://{}/cdn-cgi/access/sso/oidc/{}",
        team_host(team),
        client_id
    ))
}

/// Build the authorization URL to redirect the browser to Cloudflare's login.
/// `state` is the signed state JWT used for CSRF protection.
pub fn authorization_url(cfg: &Config, state: &str) -> Option<String> {
    let base = base_url(cfg)?;
    let client_id = cfg.cloudflare_client_id.as_deref()?;
    let redirect = cfg.cloudflare_redirect_uri();
    Some(format!(
        "{base}/authorization?client_id={client_id}&redirect_uri={redirect}\
         &response_type=code&scope=openid%20email%20profile&state={state}",
        redirect = urlencoding::encode(&redirect),
    ))
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
}

/// Identity returned from Cloudflare's userinfo endpoint. Only the email is
/// required; the invite gate keys on it. Extra fields in the response are
/// ignored.
#[derive(Debug, Deserialize)]
pub struct CloudflareUser {
    pub email: String,
}

/// Exchange the authorization code for a token, then fetch the user's profile.
pub async fn exchange_code(
    cfg: &Config,
    code: &str,
    http: &reqwest::Client,
) -> anyhow::Result<CloudflareUser> {
    let base = base_url(cfg).context("Cloudflare login is not configured")?;
    let client_id = cfg
        .cloudflare_client_id
        .as_deref()
        .context("CLOUDFLARE_CLIENT_ID is not set")?;
    let client_secret = cfg
        .cloudflare_client_secret
        .as_deref()
        .context("CLOUDFLARE_CLIENT_SECRET is not set")?;
    let redirect = cfg.cloudflare_redirect_uri();

    let response = http
        .post(format!("{base}/token"))
        .form(&[
            ("code", code),
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("redirect_uri", &redirect),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .context("Cloudflare token request failed")?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        tracing::warn!(status = %status, body = %body, "Cloudflare token endpoint rejected the exchange");
        anyhow::bail!("Cloudflare token endpoint returned {status}: {body}");
    }

    let token: TokenResponse = response
        .json()
        .await
        .context("Cloudflare token response parse failed")?;

    let user: CloudflareUser = http
        .get(format!("{base}/userinfo"))
        .bearer_auth(&token.access_token)
        .send()
        .await
        .context("Cloudflare userinfo request failed")?
        .error_for_status()
        .context("Cloudflare userinfo endpoint returned an error")?
        .json()
        .await
        .context("Cloudflare userinfo response parse failed")?;

    Ok(user)
}

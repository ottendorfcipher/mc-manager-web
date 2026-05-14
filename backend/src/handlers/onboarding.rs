use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    auth::middleware::AuthUser,
    config::Config,
    db::{audit, users},
    error::{AppError, Result},
    minecraft::console,
    state::AppState,
};

// ── Request / response ────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct InviteRequest {
    pub email:             String,
    pub role:              Option<String>,
    pub display_name:      Option<String>,
    /// Minecraft IGN to add to the whitelist immediately.
    pub ign:               Option<String>,
    /// Attempt to generate a Tailscale user-invite link (requires TAILSCALE_API_KEY).
    #[serde(default)]
    pub tailscale_invite:  bool,
    /// Attempt to send a welcome email (requires RESEND_API_KEY).
    #[serde(default = "default_true")]
    pub send_email:        bool,
}

fn default_true() -> bool { true }

#[derive(Serialize)]
pub struct InviteResult {
    pub user:                 users::User,
    pub email_sent:           bool,
    pub whitelist_added:      bool,
    /// Present when a Tailscale user invite was successfully created.
    pub tailscale_invite_url: Option<String>,
    /// Non-fatal warnings (e.g. "RESEND_API_KEY not configured").
    pub warnings:             Vec<String>,
}

// ── POST /api/onboarding/invite ───────────────────────────────────────────────

/// Unified invite endpoint.
///
/// Steps (all non-fatal except user creation):
/// 1. Create / return site user
/// 2. Whitelist MC IGN if provided
/// 3. Generate Tailscale user invite if TAILSCALE_API_KEY configured
/// 4. Send HTML welcome email if RESEND_API_KEY configured
pub async fn invite(
    State(state): State<AppState>,
    actor: AuthUser,
    Json(body): Json<InviteRequest>,
) -> Result<(StatusCode, Json<InviteResult>)> {
    crate::auth::middleware::require_perm(&actor, "users.invite")?;

    let email = body.email.trim().to_lowercase();
    if !email.contains('@') {
        return Err(AppError::BadRequest("Invalid email address".into()));
    }

    let role = body.role.unwrap_or_else(|| "member".to_string());

    let mut warnings: Vec<String> = Vec::new();

    // ── 1. Create / retrieve site user ───────────────────────────────────────

    let user = match users::get(&state.pool, &email).await? {
        Some(existing) => existing,
        None => users::create(
            &state.pool,
            &actor.email,
            users::CreateUser {
                email:        email.clone(),
                role:         role.clone(),
                display_name: body.display_name.clone(),
            },
        )
        .await?,
    };

    audit::log(
        &state.pool,
        &actor.email,
        "onboarding_invite",
        Some(&email),
        None,
    )
    .await?;

    // ── 2. Minecraft whitelist ────────────────────────────────────────────────

    let mut whitelist_added = false;
    if let Some(ign) = &body.ign {
        let ign = ign.trim();
        if !ign.is_empty() {
            let mc_cmd = format!("whitelist add {ign}");
            match console::send(&state.config, &mc_cmd).await {
                Ok(_) => {
                    whitelist_added = true;
                    audit::log(
                        &state.pool,
                        &actor.email,
                        "whitelist_add",
                        Some(ign),
                        Some(&email),
                    )
                    .await?;
                }
                Err(e) => {
                    warnings.push(format!("Minecraft whitelist: {e}"));
                }
            }
        }
    }

    // ── 3. Tailscale user invite ──────────────────────────────────────────────

    let tailscale_invite_url = if body.tailscale_invite {
        match create_tailscale_invite(&state.config, &email).await {
            Ok(url) => Some(url),
            Err(e)  => {
                warnings.push(format!("Tailscale invite: {e}"));
                None
            }
        }
    } else {
        None
    };

    // ── 4. Send welcome email ─────────────────────────────────────────────────

    let email_sent = if body.send_email {
        match send_invite_email(
            &state.config,
            &state.http,
            &email,
            &user.display_name,
            tailscale_invite_url.as_deref(),
            body.ign.as_deref(),
        )
        .await
        {
            Ok(()) => {
                let _ = users::set_invited_at(&state.pool, &email).await;
                true
            }
            Err(e) => {
                warnings.push(format!("Email: {e}"));
                false
            }
        }
    } else {
        false
    };

    Ok((
        StatusCode::CREATED,
        Json(InviteResult {
            user,
            email_sent,
            whitelist_added,
            tailscale_invite_url,
            warnings,
        }),
    ))
}

// ── Tailscale API ─────────────────────────────────────────────────────────────

async fn create_tailscale_invite(
    cfg: &Config,
    email: &str,
) -> std::result::Result<String, String> {
    let api_key = cfg
        .tailscale_api_key
        .as_deref()
        .ok_or("TAILSCALE_API_KEY is not configured")?;

    let tailnet = urlencoding::encode(&cfg.tailscale_tailnet);
    let url = format!("https://api.tailscale.com/api/v2/tailnet/{tailnet}/user-invites");

    let resp = reqwest::Client::new()
        .post(&url)
        .bearer_auth(api_key)
        .json(&json!([{ "role": "member", "email": email }]))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Tailscale API {status}: {body}"));
    }

    let invites: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    invites
        .as_array()
        .and_then(|a| a.first())
        .and_then(|v| v.get("inviteUrl"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Tailscale response missing inviteUrl".to_string())
}

// ── Resend email ──────────────────────────────────────────────────────────────

async fn send_invite_email(
    cfg: &Config,
    http: &reqwest::Client,
    to_email: &str,
    display_name: &str,
    tailscale_invite_url: Option<&str>,
    ign: Option<&str>,
) -> std::result::Result<(), String> {
    let api_key = cfg
        .resend_api_key
        .as_deref()
        .ok_or("RESEND_API_KEY is not configured")?;

    let html = build_invite_email(cfg, display_name, tailscale_invite_url, ign);
    let text = build_invite_text(cfg, display_name, tailscale_invite_url, ign);

    // Subject: avoid spam-trigger words ("invite", "free", "click").
    // Plain, concrete subject lines score better with inbox filters.
    let subject = if ign.is_some() {
        format!("redstoneCipher access for {} — setup guide", html_escape(display_name))
    } else {
        format!("redstoneCipher — welcome, {}! Here's how to get started", html_escape(display_name))
    };

    let payload = json!({
        "from":     "redstoneCipher <onboarding@example.com>",
        "reply_to": ["onboarding@example.com"],
        "to":       [to_email],
        "subject":  subject,
        "html":     html,
        // Plain-text alternative — required for non-spam classification.
        // Gmail and most filters heavily penalise HTML-only emails.
        "text":     text,
    });

    let resp = http
        .post("https://api.resend.com/emails")
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if resp.status().is_success() {
        Ok(())
    } else {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        Err(format!("Resend API {status}: {body}"))
    }
}

// ── HTML email template ───────────────────────────────────────────────────────

fn build_invite_email(
    cfg: &Config,
    display_name: &str,
    tailscale_invite_url: Option<&str>,
    ign: Option<&str>,
) -> String {
    let site_url     = &cfg.site_url;
    let tailscale_ip = &cfg.tailscale_ip;
    let login_url    = format!("{site_url}/login");

    // ── Tailscale section ──────────────────────────────────────────────────────
    let tailscale_section = if let Some(ts_url) = tailscale_invite_url {
        format!(r#"
          <tr><td style="padding:24px 0 8px;">
            <p style="margin:0;font-size:13px;color:#6B6E78;">
              We've generated a personal Tailscale invite for you. Click below to join the
              private network that secures the Minecraft server.
            </p>
          </td></tr>
          <tr><td style="padding:0 0 8px;text-align:center;">
            <a href="{ts_url}" style="display:inline-block;padding:12px 28px;
               background:#5B9BF0;color:#fff;font-weight:600;font-size:14px;
               border-radius:8px;text-decoration:none;">
              Accept Tailscale Invite
            </a>
          </td></tr>"#,
            ts_url = ts_url
        )
    } else {
        r#"
          <tr><td style="padding:24px 0 8px;">
            <p style="margin:0;font-size:13px;color:#6B6E78;">
              Ask your server admin to add you to the Tailscale network, or share
              <a href="https://tailscale.com/download" style="color:#5B9BF0;">tailscale.com/download</a>
              with them so they can generate your invite.
            </p>
          </td></tr>"#.to_string()
    };

    // ── MC whitelist note ──────────────────────────────────────────────────────
    let mc_whitelist_note = ign
        .map(|i| format!(
            r#"<p style="margin:8px 0 0;font-size:13px;color:#6B6E78;">
               Your Minecraft username <strong style="color:#1C1E27;">{i}</strong> has already
               been added to the server whitelist.
             </p>"#
        ))
        .unwrap_or_default();

    format!(r#"<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F5F2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F5F2;padding:40px 20px;">
  <tr><td align="center">
  <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

    <!-- Header -->
    <tr><td style="background:#1C1E27;border-radius:12px 12px 0 0;padding:28px 32px;text-align:center;">
      <span style="font-size:24px;font-weight:700;color:#fff;letter-spacing:-0.5px;">
        ⛏ redstoneCipher
      </span>
      <p style="margin:6px 0 0;font-size:13px;color:#9BA0B0;">
        Private Minecraft Server Management
      </p>
    </td></tr>

    <!-- Body -->
    <tr><td style="background:#fff;padding:32px;">
      <table width="100%" cellpadding="0" cellspacing="0">

        <!-- Welcome -->
        <tr><td>
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1C1E27;">
            Welcome to redstoneCipher, {display_name}!
          </h1>
          <p style="margin:0 0 24px;font-size:14px;color:#6B6E78;line-height:1.6;">
            You've been added to a private Minecraft server managed through redstoneCipher.
            Follow the three steps below to get connected.
          </p>
        </td></tr>

        <!-- Divider -->
        <tr><td style="border-top:1px solid #F0EDE9;padding-bottom:24px;"></td></tr>

        <!-- Step 1: Sign in -->
        <tr><td>
          <table cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td width="36" valign="top">
                <div style="width:28px;height:28px;border-radius:50%;background:#5B9BF0;
                            color:#fff;font-weight:700;font-size:14px;text-align:center;
                            line-height:28px;">1</div>
              </td>
              <td valign="top" style="padding-left:12px;">
                <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#1C1E27;">
                  Sign in to the portal
                </p>
                <p style="margin:0 0 12px;font-size:13px;color:#6B6E78;">
                  Use your Google account to activate your access.
                </p>
                <a href="{login_url}" style="display:inline-block;padding:10px 24px;
                   background:#5B9BF0;color:#fff;font-weight:600;font-size:13px;
                   border-radius:8px;text-decoration:none;">
                  Sign in with Google
                </a>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Divider -->
        <tr><td style="border-top:1px solid #F0EDE9;padding:24px 0 0;"></td></tr>

        <!-- Step 2: Tailscale -->
        <tr><td>
          <table cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td width="36" valign="top">
                <div style="width:28px;height:28px;border-radius:50%;background:#36B37E;
                            color:#fff;font-weight:700;font-size:14px;text-align:center;
                            line-height:28px;">2</div>
              </td>
              <td valign="top" style="padding-left:12px;">
                <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#1C1E27;">
                  Install Tailscale
                </p>
                <p style="margin:0 0 8px;font-size:13px;color:#6B6E78;">
                  The Minecraft server is accessible only over Tailscale — a secure
                  private network. It's free and takes about 2 minutes to set up.
                </p>
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding-right:8px;">
                      <a href="https://tailscale.com/download/mac" style="display:inline-block;
                         padding:6px 14px;border:1px solid #D9D5D0;border-radius:6px;
                         font-size:12px;color:#1C1E27;text-decoration:none;">
                        🍎 macOS
                      </a>
                    </td>
                    <td style="padding-right:8px;">
                      <a href="https://tailscale.com/download/windows" style="display:inline-block;
                         padding:6px 14px;border:1px solid #D9D5D0;border-radius:6px;
                         font-size:12px;color:#1C1E27;text-decoration:none;">
                        🪟 Windows
                      </a>
                    </td>
                    <td style="padding-right:8px;">
                      <a href="https://apps.apple.com/app/tailscale/id1470499037" style="display:inline-block;
                         padding:6px 14px;border:1px solid #D9D5D0;border-radius:6px;
                         font-size:12px;color:#1C1E27;text-decoration:none;">
                        📱 iOS
                      </a>
                    </td>
                    <td>
                      <a href="https://play.google.com/store/apps/details?id=com.tailscale.ipn.android" style="display:inline-block;
                         padding:6px 14px;border:1px solid #D9D5D0;border-radius:6px;
                         font-size:12px;color:#1C1E27;text-decoration:none;">
                        🤖 Android
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
          {tailscale_section}
        </td></tr>

        <!-- Divider -->
        <tr><td style="border-top:1px solid #F0EDE9;padding:24px 0 0;"></td></tr>

        <!-- Step 3: Minecraft -->
        <tr><td>
          <table cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td width="36" valign="top">
                <div style="width:28px;height:28px;border-radius:50%;background:#FBBF24;
                            color:#1C1E27;font-weight:700;font-size:14px;text-align:center;
                            line-height:28px;">3</div>
              </td>
              <td valign="top" style="padding-left:12px;">
                <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#1C1E27;">
                  Connect to Minecraft
                </p>
                <p style="margin:0 0 8px;font-size:13px;color:#6B6E78;">
                  Once Tailscale is running, open <strong>Minecraft Java Edition</strong>
                  and connect to:
                </p>
                <div style="background:#F7F5F2;border-radius:8px;padding:12px 16px;
                            font-family:monospace;font-size:15px;font-weight:700;color:#5B9BF0;">
                  {tailscale_ip}
                </div>
                <p style="margin:4px 0 0;font-size:12px;color:#9B9EA6;">
                  Port 25565 · Java Edition · Requires Tailscale to be connected
                </p>
                {mc_whitelist_note}
              </td>
            </tr>
          </table>
        </td></tr>

      </table>
    </td></tr>

    <!-- Footer -->
    <tr><td style="background:#F7F5F2;border-radius:0 0 12px 12px;
                   padding:20px 32px;text-align:center;">
      <p style="margin:0;font-size:12px;color:#9B9EA6;">
        This invite was sent via
        <a href="{site_url}" style="color:#5B9BF0;text-decoration:none;">redstoneCipher</a>.
        ·
        <a href="{site_url}/privacy" style="color:#9B9EA6;">Privacy Notice</a>
      </p>
    </td></tr>

  </table>
  </td></tr>
  </table>
</body>
</html>"#,
        display_name     = html_escape(display_name),
        login_url        = login_url,
        tailscale_section = tailscale_section,
        tailscale_ip     = tailscale_ip,
        mc_whitelist_note = mc_whitelist_note,
        site_url         = site_url,
    )
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Plain-text alternative for the invite email.
/// Every HTML email must include a text/plain part — its absence is the
/// single biggest spam-filter signal after failed authentication.
fn build_invite_text(
    cfg: &Config,
    display_name: &str,
    tailscale_invite_url: Option<&str>,
    ign: Option<&str>,
) -> String {
    let site_url     = &cfg.site_url;
    let tailscale_ip = &cfg.tailscale_ip;
    let login_url    = format!("{site_url}/login");

    let tailscale_section = match tailscale_invite_url {
        Some(url) => format!(
            "A Tailscale network access link has been generated for you:\n{url}\n\nClick that link to join the private network, then install Tailscale from tailscale.com/download if you haven't already."
        ),
        None => "Install Tailscale from tailscale.com/download and ask your admin to add you to the network.".to_string(),
    };

    let ign_note = ign
        .map(|i| format!("\nYour Minecraft username ({i}) has been added to the server whitelist.\n"))
        .unwrap_or_default();

    format!(
        "Hi {display_name},\n\n\
         You now have access to a private Minecraft server managed through redstoneCipher.\n\n\
         STEP 1 — Sign in to the portal\n\
         {login_url}\n\n\
         STEP 2 — Install Tailscale and join the network\n\
         {tailscale_section}\n{ign_note}\n\
         STEP 3 — Connect to Minecraft\n\
         Open Minecraft Java Edition and connect to: {tailscale_ip}\n\
         Port 25565 · Requires Tailscale to be connected\n\n\
         ---\n\
         This message was sent by redstoneCipher ({site_url}).\n\
         Privacy notice: {site_url}/privacy\n",
    )
}

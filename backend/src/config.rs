use std::path::PathBuf;

/// All configuration is loaded from environment variables at startup.
/// The application panics immediately if a required value is missing —
/// fail-fast beats debugging mysterious runtime errors (Pragmatic Programmer §34).
#[derive(Clone, Debug)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub database_url: String,
    pub jwt_secret: String,
    pub google_client_id: String,
    pub google_client_secret: String,
    pub redirect_uri: String,
    /// Email address seeded as the first `global_admin` on startup. Set via
    /// `BOOTSTRAP_ADMIN_EMAIL`. When `None`, no account is auto-promoted and the
    /// first admin must be added another way.
    pub bootstrap_admin_email: Option<String>,
    /// Browser origins allowed to call the API with credentials. Set via
    /// `CORS_ORIGINS` (comma separated). Defaults to `SITE_URL`.
    pub cors_origins: Vec<String>,
    // ── Cloudflare Access (Zero Trust) OIDC login ──────────────────────────────
    /// Cloudflare team name, either short ("myteam") or full
    /// ("myteam.cloudflareaccess.com"). All three cloudflare_* values must be
    /// set to enable the "Sign in with Cloudflare" button.
    pub cloudflare_team_domain: Option<String>,
    pub cloudflare_client_id: Option<String>,
    pub cloudflare_client_secret: Option<String>,
    /// Override for the Cloudflare OIDC callback URL. Defaults to
    /// `{site_url}/auth/callback/cloudflare`.
    pub cloudflare_redirect_uri: Option<String>,
    /// Shared secret for the Pub/Sub budget webhook. When `None` the webhook
    /// endpoint returns 404, keeping the surface area small in dev.
    pub budget_webhook_token: Option<String>,
    pub gcloud_bin: PathBuf,
    pub gcp_project: String,
    pub gcp_zone: String,
    pub gcp_instance: String,
    pub tailscale_ip: String,
    /// Remote path on mc-server-1 where daily backups are stored.
    pub mc_backup_dir: String,
    /// Remote path of the Minecraft server data directory on mc-server-1.
    pub mc_server_dir: String,
    /// Remote path where helper scripts (get-player-data.py, give-item.py) live.
    pub mc_scripts_dir: String,
    /// Local path on the web server where BlueMap tiles are served from.
    pub map_tiles_dir: String,
    /// Shared secret for the mc-server-1 watchdog webhook.
    /// When `None` the endpoint returns 401 for every request.
    pub watchdog_token: Option<String>,
    /// Root directory on mc-server-1 where inactive worlds are stored.
    pub mc_worlds_dir: String,
    /// Root directory on mc-server-1 under which per-world backup subdirs live.
    pub mc_backups_base_dir: String,
    // ── Onboarding / invite ────────────────────────────────────────────────────
    /// Resend API key for sending invite emails.
    /// When `None`, email sending is skipped (invite still created in DB).
    pub resend_api_key: Option<String>,
    /// Tailscale API key for creating tailnet user invites.
    /// When `None`, the Tailscale invite step is omitted.
    pub tailscale_api_key: Option<String>,
    /// Tailscale tailnet identifier (e.g. "example.com" or admin email).
    pub tailscale_tailnet: String,
    /// Public base URL of this site, used in invite email links.
    pub site_url: String,
    /// Sender for outbound email (Resend). Set via `EMAIL_FROM`.
    pub email_from: String,
    /// Whether the session cookie carries the `Secure` attribute. Set via
    /// `COOKIE_SECURE`. Keep `true` in production; set `false` only for a local
    /// plain-HTTP run, where browsers would otherwise drop a Secure cookie.
    pub cookie_secure: bool,
    /// Enables a temporary read-only "Continue as guest" login for bootstrapping
    /// before OAuth is set up. Set via `GUEST_LOGIN`. Off by default, and also
    /// auto-disables the first time a real OAuth user signs in.
    pub guest_login: bool,
    // ── Discord bridge ─────────────────────────────────────────────────────────
    /// Discord bot token, webhook URL, and channel ID from env vars.
    /// These override any values stored in the database (useful for
    /// initial bootstrap and CI).  When all three are None the bridge
    /// starts unconfigured and waits for credentials via the admin UI.
    pub discord_bot_token:   Option<String>,
    pub discord_webhook_url: Option<String>,
    pub discord_channel_id:  Option<u64>,
    // ── Settings encryption ─────────────────────────────────────────────────────
    /// AES-256-GCM key derived from `jwt_secret` at startup.
    /// Cached here so handlers can encrypt/decrypt without recomputing.
    pub settings_enc_key: [u8; 32],
}

impl Config {
    /// Load and validate configuration from environment.
    /// Panics with a clear message on any missing required variable.
    pub fn from_env() -> Self {
        dotenvy::dotenv().ok();

        Self {
            host: env_or("HOST", "127.0.0.1"),
            port: env_parse("PORT", 8787),
            database_url: require_env("DATABASE_URL"),
            jwt_secret: require_env("JWT_SECRET"),
            google_client_id: require_env("GOOGLE_CLIENT_ID"),
            google_client_secret: require_env("GOOGLE_CLIENT_SECRET"),
            redirect_uri: env_or("REDIRECT_URI", "http://localhost:8787/auth/callback"),
            bootstrap_admin_email: std::env::var("BOOTSTRAP_ADMIN_EMAIL")
                .ok()
                .filter(|s| !s.is_empty()),
            cors_origins: parse_cors_origins(),
            cloudflare_team_domain: opt_env("CLOUDFLARE_TEAM_DOMAIN"),
            cloudflare_client_id: opt_env("CLOUDFLARE_CLIENT_ID"),
            cloudflare_client_secret: opt_env("CLOUDFLARE_CLIENT_SECRET"),
            cloudflare_redirect_uri: opt_env("CLOUDFLARE_REDIRECT_URI"),
            budget_webhook_token: std::env::var("BUDGET_WEBHOOK_TOKEN")
                .ok()
                .filter(|s| !s.is_empty()),
            gcloud_bin: PathBuf::from(env_or(
                "GCLOUD_BIN",
                &format!("{}/google-cloud-sdk/bin/gcloud", home_dir()),
            )),
            gcp_project: env_or("GCP_PROJECT", "example-project"),
            gcp_zone: env_or("GCP_ZONE", "us-central1-a"),
            gcp_instance: env_or("GCP_INSTANCE", "mc-server"),
            tailscale_ip: env_or("TAILSCALE_IP", "127.0.0.1"),
            mc_backup_dir: env_or("MC_BACKUP_DIR", "/opt/minecraft/backups/daily"),
            mc_server_dir: env_or("MC_SERVER_DIR", "/opt/minecraft/server"),
            mc_scripts_dir: env_or("MC_SCRIPTS_DIR", "/opt/minecraft/scripts"),
            map_tiles_dir: env_or("MAP_TILES_DIR", "/opt/redstonecipher/www/map"),
            watchdog_token: std::env::var("WATCHDOG_TOKEN")
                .ok()
                .filter(|s| !s.is_empty()),
            mc_worlds_dir: env_or("MC_WORLDS_DIR", "/opt/minecraft/worlds"),
            mc_backups_base_dir: env_or("MC_BACKUPS_BASE_DIR", "/opt/minecraft/backups"),
            resend_api_key: std::env::var("RESEND_API_KEY")
                .ok()
                .filter(|s| !s.is_empty()),
            tailscale_api_key: std::env::var("TAILSCALE_API_KEY")
                .ok()
                .filter(|s| !s.is_empty()),
            tailscale_tailnet: env_or("TAILSCALE_TAILNET", "your-tailnet"),
            site_url: env_or("SITE_URL", "http://localhost:8787"),
            email_from: env_or("EMAIL_FROM", "redstoneCipher <onboarding@example.com>"),
            cookie_secure: env_parse("COOKIE_SECURE", true),
            guest_login: env_parse("GUEST_LOGIN", false),
            discord_bot_token: std::env::var("DISCORD_BOT_TOKEN")
                .ok()
                .filter(|s| !s.is_empty()),
            discord_webhook_url: std::env::var("DISCORD_WEBHOOK_URL")
                .ok()
                .filter(|s| !s.is_empty()),
            discord_channel_id: std::env::var("DISCORD_CHANNEL_ID")
                .ok()
                .filter(|s| !s.is_empty())
                .and_then(|s| s.parse::<u64>().ok()),
            settings_enc_key: {
                let jwt = std::env::var("JWT_SECRET")
                    .unwrap_or_default();
                crate::db::settings::derive_key(&jwt)
            },
        }
    }
}

impl Config {
    /// True when Cloudflare Access OIDC login is fully configured.
    pub fn cloudflare_enabled(&self) -> bool {
        self.cloudflare_team_domain.is_some()
            && self.cloudflare_client_id.is_some()
            && self.cloudflare_client_secret.is_some()
    }

    /// The Cloudflare OIDC callback URL. Uses `CLOUDFLARE_REDIRECT_URI` when set,
    /// otherwise derives it from `SITE_URL`.
    pub fn cloudflare_redirect_uri(&self) -> String {
        self.cloudflare_redirect_uri.clone().unwrap_or_else(|| {
            format!("{}/auth/callback/cloudflare", self.site_url.trim_end_matches('/'))
        })
    }
}

fn home_dir() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/root".to_string())
}

/// Read an optional env var, treating empty strings as unset.
fn opt_env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|s| !s.is_empty())
}

/// Parse `CORS_ORIGINS` (comma separated) into a list of allowed origins.
/// Falls back to `SITE_URL` when unset so a single-origin deploy needs no extra
/// configuration.
fn parse_cors_origins() -> Vec<String> {
    let raw = std::env::var("CORS_ORIGINS").unwrap_or_default();
    let mut origins: Vec<String> = raw
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if origins.is_empty() {
        origins.push(env_or("SITE_URL", "http://localhost:8787"));
    }
    origins
}

fn require_env(key: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| {
        panic!("Required environment variable '{key}' is not set. Check your .env file.")
    })
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn env_parse<T: std::str::FromStr + std::fmt::Debug>(key: &str, default: T) -> T
where
    T::Err: std::fmt::Debug,
{
    std::env::var(key)
        .ok()
        .map(|v| {
            v.parse::<T>()
                .unwrap_or_else(|e| panic!("Failed to parse env var '{key}' = '{v}': {e:?}"))
        })
        .unwrap_or(default)
}

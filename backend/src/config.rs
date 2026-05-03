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
    /// Shared secret for the Pub/Sub budget webhook. When `None` the webhook
    /// endpoint returns 404, keeping the surface area small in dev.
    pub budget_webhook_token: Option<String>,
    pub gcloud_bin: PathBuf,
    pub gcp_project: String,
    pub gcp_zone: String,
    pub gcp_instance: String,
    pub tailscale_ip: String,
    /// Remote path on mc-server-1 where daily backups are stored.
    /// Used for listing, downloading, and creating backups over SSH.
    pub mc_backup_dir: String,
    /// Shared secret for the mc-server-1 watchdog webhook.
    /// When `None` the endpoint returns 401 for every request.
    pub watchdog_token: Option<String>,
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
            redirect_uri: env_or(
                "REDIRECT_URI",
                "https://example.com/auth/callback",
            ),
            budget_webhook_token: std::env::var("BUDGET_WEBHOOK_TOKEN").ok().filter(|s| !s.is_empty()),
            gcloud_bin: PathBuf::from(env_or(
                "GCLOUD_BIN",
                &format!("{}/google-cloud-sdk/bin/gcloud", home_dir()),
            )),
            gcp_project: env_or("GCP_PROJECT", "example-project"),
            gcp_zone: env_or("GCP_ZONE", "us-central1-a"),
            gcp_instance: env_or("GCP_INSTANCE", "mc-server-spot"),
            tailscale_ip: env_or("TAILSCALE_IP", "100.64.0.3"),
            mc_backup_dir: env_or("MC_BACKUP_DIR", "/opt/minecraft/backups/daily"),
            watchdog_token: std::env::var("WATCHDOG_TOKEN").ok().filter(|s| !s.is_empty()),
        }
    }
}

fn home_dir() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/Users/user".to_string())
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
            v.parse::<T>().unwrap_or_else(|e| {
                panic!("Failed to parse env var '{key}' = '{v}': {e:?}")
            })
        })
        .unwrap_or(default)
}

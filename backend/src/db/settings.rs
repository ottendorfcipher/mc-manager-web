//! Encrypted key-value settings store backed by `app_settings`.
//!
//! Values are encrypted with AES-256-GCM before being written to SQLite.
//! The encryption key is derived from `JWT_SECRET` so no separate secret
//! is required.  Raw plaintext values never leave this module — callers
//! receive them decrypted in memory and the API layer must never echo them
//! back to the client.
//!
//! Stored format per value:  `<hex-12-byte-nonce>:<hex-ciphertext+tag>`

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use rand::RngCore;
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;

use crate::error::{AppError, Result};

// ── Encryption key ────────────────────────────────────────────────────────────

/// Derive a 32-byte AES-256-GCM key from `jwt_secret`.
///
/// Uses domain-separated SHA-256 so the settings key is independent of
/// whatever uses the JWT secret directly.  Changing `JWT_SECRET` will make
/// existing settings unreadable — rotate the secret together.
pub fn derive_key(jwt_secret: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(jwt_secret.as_bytes());
    hasher.update(b"::redstonecipher-settings-v1");
    hasher.finalize().into()
}

// ── Encrypt / decrypt ────────────────────────────────────────────────────────

fn encrypt(key: &[u8; 32], plaintext: &str) -> Result<String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|_| AppError::Internal(anyhow::anyhow!("settings encrypt failed")))?;
    Ok(format!("{}:{}", hex::encode(nonce_bytes), hex::encode(ciphertext)))
}

fn decrypt(key: &[u8; 32], stored: &str) -> Result<String> {
    let (nonce_hex, ct_hex) = stored
        .split_once(':')
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("malformed encrypted setting")))?;
    let nonce_bytes = hex::decode(nonce_hex)
        .map_err(|_| AppError::Internal(anyhow::anyhow!("bad nonce hex in setting")))?;
    let ciphertext = hex::decode(ct_hex)
        .map_err(|_| AppError::Internal(anyhow::anyhow!("bad ciphertext hex in setting")))?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce  = Nonce::from_slice(&nonce_bytes);
    let plain  = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| AppError::Internal(anyhow::anyhow!("settings decrypt failed — wrong key?")))?;
    String::from_utf8(plain)
        .map_err(|_| AppError::Internal(anyhow::anyhow!("decrypted setting is not valid UTF-8")))
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

/// Retrieve and decrypt a setting.  Returns `None` if the key is not set.
pub async fn get(pool: &SqlitePool, enc_key: &[u8; 32], key: &str) -> Result<Option<String>> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value_enc FROM app_settings WHERE key = ?")
            .bind(key)
            .fetch_optional(pool)
            .await?;
    match row {
        None => Ok(None),
        Some((enc,)) => Ok(Some(decrypt(enc_key, &enc)?)),
    }
}

/// Encrypt and upsert a setting.
pub async fn set(
    pool:    &SqlitePool,
    enc_key: &[u8; 32],
    key:     &str,
    value:   &str,
    actor:   &str,
) -> Result<()> {
    let enc = encrypt(enc_key, value)?;
    sqlx::query(
        "INSERT INTO app_settings (key, value_enc, updated_by)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_enc  = excluded.value_enc,
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
           updated_by = excluded.updated_by",
    )
    .bind(key)
    .bind(enc)
    .bind(actor)
    .execute(pool)
    .await?;
    Ok(())
}

// ── Discord-specific helpers ──────────────────────────────────────────────────

/// The three Discord credentials loaded from `app_settings`.
#[derive(Debug, Clone)]
pub struct DiscordDbConfig {
    pub bot_token:   String,
    pub webhook_url: String,
    pub channel_id:  u64,
}

/// Load all three Discord settings at once.
/// Returns `None` if any of the three required values is not configured.
pub async fn get_discord_config(
    pool:    &SqlitePool,
    enc_key: &[u8; 32],
) -> Result<Option<DiscordDbConfig>> {
    let token   = get(pool, enc_key, "discord.bot_token").await?;
    let webhook = get(pool, enc_key, "discord.webhook_url").await?;
    let channel = get(pool, enc_key, "discord.channel_id").await?;

    match (token, webhook, channel) {
        (Some(t), Some(w), Some(c)) => {
            let channel_id = c.parse::<u64>().map_err(|_| {
                AppError::Internal(anyhow::anyhow!("discord.channel_id is not a valid u64"))
            })?;
            Ok(Some(DiscordDbConfig {
                bot_token:   t,
                webhook_url: w,
                channel_id,
            }))
        }
        _ => Ok(None),
    }
}

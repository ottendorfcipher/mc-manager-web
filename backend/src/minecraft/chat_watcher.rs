//! chat_watcher — background task that tails Minecraft's latest.log over SSH
//! and publishes parsed events to the chat broadcast channel.
//!
//! Reconnects automatically with exponential backoff capped at 30 s so a
//! server restart or network blip is handled without manual intervention.

use std::sync::Arc;
use std::time::Duration;

use regex::Regex;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::broadcast;
use tokio::time::sleep;
use tracing::{info, warn};

use crate::config::Config;
use crate::db::chat::{self, ChatMessage};

/// SSH key and known-hosts paths (match the values in gcloud/ssh.rs).
const MC_SSH_KEY:        &str = "/opt/redstonecipher/mc_ssh_key";
const MC_KNOWN_HOSTS:    &str = "/opt/redstonecipher/mc_known_hosts";

/// Spawn the watcher as a detached Tokio task.
/// Errors inside the task are logged and trigger a reconnect; they do not
/// propagate to the caller.
pub fn spawn(
    config: Config,
    pool:   sqlx::SqlitePool,
    tx:     broadcast::Sender<Arc<ChatMessage>>,
) {
    tokio::spawn(async move {
        run_with_reconnect(config, pool, tx).await;
    });
}

async fn run_with_reconnect(
    config: Config,
    pool:   sqlx::SqlitePool,
    tx:     broadcast::Sender<Arc<ChatMessage>>,
) {
    // Compile patterns once for the lifetime of the task.
    // Paper 1.21 chat: [HH:MM:SS INFO]: <IGN> message
    let chat_re   = Regex::new(r"^\[[\d:]+\] \[.*?INFO\]: <(\w+)> (.+)$").unwrap();
    // Join / leave events
    let join_re   = Regex::new(r"^\[[\d:]+\] \[.*?INFO\]: (\w+) joined the game$").unwrap();
    let leave_re  = Regex::new(r"^\[[\d:]+\] \[.*?INFO\]: (\w+) left the game$").unwrap();

    let mut backoff = Duration::from_secs(2);
    const MAX_BACKOFF: Duration = Duration::from_secs(30);

    loop {
        match tail_once(&config, &pool, &tx, &chat_re, &join_re, &leave_re).await {
            Ok(()) => {
                // tail exited cleanly (e.g. SSH closed) — reconnect
                warn!("chat_watcher: tail exited, reconnecting in {:?}", backoff);
            }
            Err(e) => {
                warn!("chat_watcher: error — {e}, reconnecting in {:?}", backoff);
            }
        }
        sleep(backoff).await;
        backoff = (backoff * 2).min(MAX_BACKOFF);
    }
}

/// Open one SSH `tail -F` session and process lines until it exits.
async fn tail_once(
    config:   &Config,
    pool:     &sqlx::SqlitePool,
    tx:       &broadcast::Sender<Arc<ChatMessage>>,
    chat_re:  &Regex,
    join_re:  &Regex,
    leave_re: &Regex,
) -> anyhow::Result<()> {
    let dest = format!("root@{}", config.tailscale_ip);
    let log_path = format!(
        "{}/logs/latest.log",
        config.mc_server_dir
    );

    let mut child = Command::new("ssh")
        .args([
            "-i", MC_SSH_KEY,
            "-o", "StrictHostKeyChecking=yes",
            "-o", &format!("UserKnownHostsFile={MC_KNOWN_HOSTS}"),
            "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=15",
            "-o", "ServerAliveInterval=30",
            "-o", "ServerAliveCountMax=3",
            &dest,
            "tail", "-F", "-n", "0", &log_path,
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()?;

    let stdout = child.stdout.take().expect("stdout is piped");
    let mut lines = BufReader::new(stdout).lines();

    info!("chat_watcher: connected, tailing {log_path}");

    while let Some(line) = lines.next_line().await? {
        process_line(pool, tx, &line, chat_re, join_re, leave_re).await;
    }

    // SSH process ended — wait to collect status but don't error on non-zero.
    let _ = child.wait().await;
    Ok(())
}

async fn process_line(
    pool:     &sqlx::SqlitePool,
    tx:       &broadcast::Sender<Arc<ChatMessage>>,
    line:     &str,
    chat_re:  &Regex,
    join_re:  &Regex,
    leave_re: &Regex,
) {
    let result = if let Some(cap) = chat_re.captures(line) {
        let ign     = cap[1].to_string();
        let content = cap[2].to_string();
        Some(("mc", ign.clone(), ign, content))
    } else if let Some(cap) = join_re.captures(line) {
        let ign = cap[1].to_string();
        Some(("server", ign.clone(), ign.clone(), format!("{ign} joined the game")))
    } else if let Some(cap) = leave_re.captures(line) {
        let ign = cap[1].to_string();
        Some(("server", ign.clone(), ign.clone(), format!("{ign} left the game")))
    } else {
        None
    };

    if let Some((source, author, display_as, content)) = result {
        match chat::insert(pool, source, &author, &display_as, &content).await {
            Ok(msg) => {
                // Ignore send errors — no active SSE subscribers is fine.
                let _ = tx.send(Arc::new(msg));
            }
            Err(e) => {
                warn!("chat_watcher: DB insert failed: {e}");
            }
        }
    }
}

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
use crate::db::{chat::{self, ChatMessage}, players};
use crate::minecraft::{aliases, console};

/// SSH key and known-hosts paths (match the values in gcloud/ssh.rs).
const MC_SSH_KEY:        &str = "/opt/redstonecipher/mc_ssh_key";
const MC_KNOWN_HOSTS:    &str = "/opt/redstonecipher/mc_known_hosts";

/// Spawn the watcher as a detached Tokio task.
/// Errors inside the task are logged and trigger a reconnect; they do not
/// propagate to the caller.
pub fn spawn(
    config:  Config,
    pool:    sqlx::SqlitePool,
    tx:      broadcast::Sender<Arc<ChatMessage>>,
    discord: std::sync::Arc<tokio::sync::RwLock<Option<crate::discord::DiscordRelay>>>,
) {
    tokio::spawn(async move {
        run_with_reconnect(config, pool, tx, discord).await;
    });
}

async fn run_with_reconnect(
    config:  Config,
    pool:    sqlx::SqlitePool,
    tx:      broadcast::Sender<Arc<ChatMessage>>,
    discord: std::sync::Arc<tokio::sync::RwLock<Option<crate::discord::DiscordRelay>>>,
) {
    // Compile patterns once for the lifetime of the task.
    // Paper 1.21 chat: [HH:MM:SS INFO]: <IGN> message
    let chat_re   = Regex::new(r"^\[[\d:]+\] \[.*?INFO\]: <(\w+)> (.+)$").unwrap();
    // Join / leave events
    let join_re   = Regex::new(r"^\[[\d:]+\] \[.*?INFO\]: (\w+) joined the game$").unwrap();
    let leave_re  = Regex::new(r"^\[[\d:]+\] \[.*?INFO\]: (\w+) left the game$").unwrap();
    // In-game alias command: /alias <name>  or  /alias clear
    // Paper logs this as: "[HH:MM:SS] [Server thread/INFO]: IGN issued server command: /alias Name"
    let alias_re  = Regex::new(r"^\[[\d:]+\] \[.*?INFO\]: (\w+) issued server command: /alias (.+)$").unwrap();

    let mut backoff = Duration::from_secs(2);
    const MAX_BACKOFF: Duration = Duration::from_secs(30);

    loop {
        match tail_once(&config, &pool, &tx, &chat_re, &join_re, &leave_re, &alias_re, &discord).await {
            // (config is threaded into tail_once and process_line so the
            //  join handler can re-apply each player's saved gamemode.)
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
    alias_re: &Regex,
    discord:  &std::sync::Arc<tokio::sync::RwLock<Option<crate::discord::DiscordRelay>>>,
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
        process_line(config, pool, tx, &line, chat_re, join_re, leave_re, alias_re, discord).await
    }

    // SSH process ended — wait to collect status but don't error on non-zero.
    let _ = child.wait().await;
    Ok(())
}

async fn process_line(
    config:   &Config,
    pool:     &sqlx::SqlitePool,
    tx:       &broadcast::Sender<Arc<ChatMessage>>,
    line:     &str,
    chat_re:  &Regex,
    join_re:  &Regex,
    leave_re: &Regex,
    alias_re: &Regex,
    discord:  &std::sync::Arc<tokio::sync::RwLock<Option<crate::discord::DiscordRelay>>>,
) {
    // (source, author, display_as, content, is_player_chat)
    let result = if let Some(cap) = chat_re.captures(line) {
        let ign     = cap[1].to_string();
        let content = cap[2].to_string();
        Some(("mc", ign.clone(), ign, content, true))
    } else if let Some(cap) = join_re.captures(line) {
        let ign = cap[1].to_string();

        // Re-apply the player's saved default gamemode.  MC doesn't
        // remember the per-player gamemode across disconnects on a
        // server with a single default-gamemode setting, so without
        // this every reconnect drops the player back to the server
        // default — overriding whatever they picked in the web UI.
        //
        // Fire-and-forget so a slow SSH round-trip can't block the
        // tail loop.  Skip if the IGN isn't linked to any account
        // (e.g. a fresh-admitted player) — they get the server default.
        let cfg2  = config.clone();
        let pool2 = pool.clone();
        let ign2  = ign.clone();
        tokio::spawn(async move {
            // Tiny delay so the player exists as an entity before any
            // commands target them.  100 ms is generous — Paper has them
            // in the world by the time the join log line lands.
            tokio::time::sleep(Duration::from_millis(100)).await;

            // 1. Re-apply saved gamemode.
            match players::get_gamemode_by_ign(&pool2, &ign2).await {
                Ok(Some(gm)) => {
                    match console::set_gamemode(&cfg2, &ign2, &gm).await {
                        Ok(true)  => info!("chat_watcher: applied saved gamemode '{gm}' to {ign2}"),
                        Ok(false) => warn!("chat_watcher: gamemode FIFO failure for {ign2}"),
                        Err(e)    => warn!("chat_watcher: failed to apply gamemode for {ign2}: {e}"),
                    }
                }
                Ok(None)  => {}
                Err(e)    => warn!("chat_watcher: gamemode lookup failed for {ign2}: {e}"),
            }

            // 2. Re-apply alias team so the display name persists across
            //    server/client restarts.
            if let Some(alias) = aliases::get_alias(&pool2, &ign2).await {
                aliases::apply_alias_in_game(&cfg2, &ign2, &alias).await;
            }
        });

        Some(("server", ign.clone(), ign.clone(), format!("{ign} joined the game"), false))
    } else if let Some(cap) = leave_re.captures(line) {
        let ign = cap[1].to_string();
        Some(("server", ign.clone(), ign.clone(), format!("{ign} left the game"), false))
    } else if let Some(cap) = alias_re.captures(line) {
        // Player typed /alias <name> or /alias clear in-game.
        // Paper logs unknown commands as issued-server-command regardless of
        // whether they're registered — the command just produces an "Unknown
        // command" output for the player, but we intercept it here and handle
        // it server-side, then respond via tellraw.
        let ign  = cap[1].to_string();
        let arg  = cap[2].trim().to_string();

        let cfg2  = config.clone();
        let pool2 = pool.clone();
        let ign2  = ign.clone();
        let arg2  = arg.clone();
        tokio::spawn(async move {
            let is_clear = matches!(arg2.to_ascii_lowercase().as_str(), "clear" | "-" | "none");

            if is_clear {
                match aliases::clear_alias(&pool2, &cfg2, &ign2).await {
                    Ok(_) => {
                        info!("chat_watcher: {ign2} cleared their alias in-game");
                        let msg = serde_json::json!({
                            "text": "Your alias has been removed. Your Minecraft name is now shown.",
                            "color": "green"
                        });
                        let cmd = format!("tellraw {ign2} {msg}");
                        let _ = crate::gcloud::ssh::fifo_command(&cfg2, &cmd).await;
                    }
                    Err(e) => warn!("chat_watcher: alias clear for {ign2} failed: {e}"),
                }
            } else if arg2.is_empty() || arg2.len() > 32 || arg2.chars().any(|c| c.is_control()) {
                let msg = serde_json::json!({
                    "text": "Usage: /alias <name>  or  /alias clear   (name: 1-32 chars)",
                    "color": "red"
                });
                let cmd = format!("tellraw {ign2} {msg}");
                let _ = crate::gcloud::ssh::fifo_command(&cfg2, &cmd).await;
            } else {
                match aliases::set_alias(&pool2, &cfg2, &ign2, &arg2).await {
                    Ok(_) => {
                        info!("chat_watcher: {ign2} set alias to '{arg2}' in-game");
                        let msg = serde_json::json!({
                            "text": format!("Alias set to: {arg2}"),
                            "color": "green"
                        });
                        let cmd = format!("tellraw {ign2} {msg}");
                        let _ = crate::gcloud::ssh::fifo_command(&cfg2, &cmd).await;
                    }
                    Err(e) => warn!("chat_watcher: alias set for {ign2} failed: {e}"),
                }
            }
        });

        // Don't produce a chat message for this — it's a command, not chat.
        None
    } else {
        None
    };

    if let Some((source, author, display_as, content, is_player_chat)) = result {
        match chat::insert(pool, source, &author, &display_as, &content).await {
            Ok(msg) => {
                // Ignore send errors — no active SSE subscribers is fine.
                let _ = tx.send(Arc::new(msg));

                // Relay to Discord (fire-and-forget).
                let relay_opt = discord.read().await.clone();
                if let Some(relay) = relay_opt {
                    let dname    = display_as.clone();
                    let dcontent = content.clone();
                    if is_player_chat {
                        // MC player message — show their Minecraft head as the avatar.
                        tokio::spawn(async move {
                            let avatar = format!("https://mc-heads.net/head/{dname}/64");
                            relay.relay(&dname, Some(&avatar), &dcontent).await;
                        });
                    } else {
                        // Server event (join/leave) — italicise the body in Discord.
                        tokio::spawn(async move {
                            relay.relay("Server", None, &format!("_{dcontent}_")).await;
                        });
                    }
                }
            }
            Err(e) => {
                warn!("chat_watcher: DB insert failed: {e}");
            }
        }
    }
}

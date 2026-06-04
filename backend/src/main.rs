use redstonecipher_server as lib;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Structured logging — level controlled by RUST_LOG env var
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let cfg = lib::config::Config::from_env();

    let pool = lib::db::init(&cfg.database_url).await?;

    // Sync any new .tar.gz archives from mc-server-1 that aren't yet in the DB.
    // Non-fatal: if mc-server-1 is offline at startup the service still starts.
    let synced = lib::minecraft::backup::sync_into_db(&pool, &cfg).await;
    if synced > 0 {
        tracing::info!("Synced {synced} new backup(s) from mc-server-1 into database");
    }

    // ── Resolve Discord configuration ───────────────────────────────────────────────────────────
    // Precedence: env vars (highest) > DB-stored credentials (lowest).
    // Env vars are kept so existing deployments keep working without UI interaction.
    let db_discord = lib::db::settings::get_discord_config(&pool, &cfg.settings_enc_key)
        .await
        .unwrap_or_else(|e| { tracing::warn!("Could not load Discord config from DB: {e}"); None });

    let initial_discord_cfg: Option<lib::discord::DiscordRuntimeConfig> =
        match (cfg.discord_bot_token.clone(), cfg.discord_webhook_url.clone(), cfg.discord_channel_id) {
            (Some(t), Some(w), Some(c)) => {
                tracing::info!("Discord config: using env vars (channel {})", c);
                Some(lib::discord::DiscordRuntimeConfig { bot_token: t, webhook_url: w, channel_id: c })
            }
            _ => match db_discord {
                Some(db) => {
                    tracing::info!("Discord config: loaded from DB (channel {})", db.channel_id);
                    Some(lib::discord::DiscordRuntimeConfig {
                        bot_token:   db.bot_token,
                        webhook_url: db.webhook_url,
                        channel_id:  db.channel_id,
                    })
                }
                None => {
                    tracing::info!("Discord bridge: not configured — set credentials in Admin → Integrations");
                    None
                }
            },
        };

    let state = lib::AppState::new(pool, cfg.clone(), initial_discord_cfg);

    // Backfill legacy music uploads → UUID-named storage (idempotent).
    lib::minecraft::music::backfill_uuid_storage(&state.pool).await;

    // Spawn the music-player background task that auto-advances the queue.
    lib::minecraft::music::spawn_player_task(
        cfg.clone(),
        state.pool.clone(),
        state.music_current.clone(),
        state.music_tx.clone(),
    );

    // Spawn the countdown background task that ticks every second.
    lib::minecraft::countdown_runner::spawn_countdown_task(
        cfg.clone(),
        state.pool.clone(),
        state.countdown_active.clone(),
        state.countdown_tx.clone(),
    );

    // Spawn the rising-oceans background task.
    lib::minecraft::rising_oceans_runner::spawn_rising_oceans_task(
        cfg.clone(),
        state.pool.clone(),
        state.rising_oceans_active.clone(),
        state.rising_oceans_tx.clone(),
    );

    // Spawn the bounty-board background task.
    lib::minecraft::bounty_runner::spawn_bounty_task(
        cfg.clone(),
        state.pool.clone(),
        state.bounty_board_active.clone(),
        state.bounty_board_tx.clone(),
    );

    // Re-apply all saved player aliases as scoreboard teams on startup.
    // Fire-and-forget — a slow or offline MC server doesn't block boot.
    {
        let pool2 = state.pool.clone();
        let cfg2  = cfg.clone();
        tokio::spawn(async move {
            lib::minecraft::aliases::apply_all_aliases_at_startup(&pool2, &cfg2).await;
        });
    }

    // Spawn the nearest-pin HUD task (self-paced, no channels).
    lib::minecraft::pin_hud_runner::spawn_pin_hud_task(
        cfg.clone(),
        state.pool.clone(),
    );

    // One-time data migration: relocate any OGGs still sitting under the
    // public uploads dir into the private data dir.  Idempotent — once
    // /www/uploads/music/ is drained of .ogg files, this is a no-op.
    {
        tokio::spawn(async move {
            const OLD_DIR: &str = "/opt/redstonecipher/www/uploads/music";
            const NEW_DIR: &str = "/opt/redstonecipher/data/uploads/music";
            let _ = tokio::fs::create_dir_all(NEW_DIR).await;
            let mut moved = 0u32;
            if let Ok(mut rd) = tokio::fs::read_dir(OLD_DIR).await {
                while let Ok(Some(e)) = rd.next_entry().await {
                    let name = e.file_name().to_string_lossy().to_string();
                    // Only relocate .ogg files at the dir root — `images/`
                    // subdir stays where the frontend `<img src>` tags
                    // expect it.
                    if !name.to_ascii_lowercase().ends_with(".ogg") { continue; }
                    let from = e.path();
                    let to   = format!("{NEW_DIR}/{name}");
                    // /www/ and /data/ may live on different filesystems —
                    // `rename(2)` returns EXDEV in that case.  Fall back
                    // to copy + delete, which doesn't care about mounts.
                    match tokio::fs::rename(&from, &to).await {
                        Ok(()) => { moved += 1; }
                        Err(_) => {
                            match tokio::fs::copy(&from, &to).await {
                                Ok(_) => {
                                    if let Err(err) = tokio::fs::remove_file(&from).await {
                                        tracing::warn!("ogg migrate: copied but cleanup failed for {from:?}: {err}");
                                    }
                                    moved += 1;
                                }
                                Err(err) => {
                                    tracing::warn!("ogg migrate: copy {from:?} -> {to}: {err}");
                                }
                            }
                        }
                    }
                }
            }
            if moved > 0 {
                tracing::info!("ogg migrate: moved {moved} file(s) out of the public web root");
            }
        });
    }

    // Self-heal: keep the file referenced by `resource-pack` in
    // server.properties in sync with what's actually on disk.
    //
    // Triggers a rebuild when ANY of these is true:
    //   • server.properties has no usable `resource-pack` URL
    //     (e.g. first boot, or a manually-set external URL),
    //   • the URL's local target file doesn't exist
    //     (frontend deploy with `rsync --delete` wiped it,
    //      or the session dir got pruned), OR
    //   • the file's SHA-1 doesn't match `resource-pack-sha1`
    //     (the property update silently failed at some point —
    //      see the path bug in properties.rs).
    //
    // Without this, MC clients hit a SHA-1 mismatch on the URL,
    // silently skip the pack, and every custom-music zone breaks.
    {
        let pool2 = state.pool.clone();
        let cfg2  = cfg.clone();
        tokio::spawn(async move {
            let session = lib::handlers::music::current_pack_session(&cfg2).await;

            let reason: Option<String> = match &session {
                None => Some("no rotating-session URL in server.properties".into()),
                Some(s) => {
                    let path = s.path();
                    let exists = tokio::fs::try_exists(&path).await.unwrap_or(false);
                    if !exists {
                        Some(format!("pack file missing at {path}"))
                    } else {
                        let file_sha = tokio::process::Command::new("sha1sum")
                            .arg(&path)
                            .output()
                            .await
                            .ok()
                            .map(|o| String::from_utf8_lossy(&o.stdout)
                                .split_whitespace().next().unwrap_or("").to_string())
                            .unwrap_or_default();
                        let props_sha = lib::minecraft::properties::get_all(&cfg2).await
                            .ok()
                            .and_then(|m| m.get("resource-pack-sha1").cloned())
                            .unwrap_or_default();
                        if !file_sha.is_empty() && !props_sha.is_empty() && file_sha != props_sha {
                            Some(format!("SHA mismatch (file={file_sha} props={props_sha})"))
                        } else {
                            None
                        }
                    }
                }
            };

            if let Some(why) = reason {
                tracing::warn!("startup: rebuilding resource pack ({why})");
                if let Err(e) = lib::handlers::music::rebuild_resource_pack(&pool2, &cfg2).await {
                    tracing::error!("startup: pack rebuild failed: {e}");
                }
            }
        });
    }

    // Spawn the music-zone task (region-triggered per-player playback).
    lib::minecraft::music_zone_runner::spawn_music_zone_task(
        cfg.clone(),
        state.pool.clone(),
        state.credits_active.clone(),
    );

    // Spawn the scheduled-jobs runner (cron-style automations).
    lib::minecraft::scheduled_runner::spawn_scheduled_task(state.clone());

    // Spawn the plugin install/remove job runner.
    lib::minecraft::plugin_install::spawn_job_runner(state.pool.clone(), cfg.clone());

    // Spawn the plugin update checker (every 6 hours).
    lib::minecraft::plugin_updater::spawn_plugin_updater(state.pool.clone(), cfg.clone());

    // Seed the default plugin goals if the table is empty.
    if let Err(e) = lib::db::plugin_goals::seed_goals_if_empty(&state.pool).await {
        tracing::warn!("plugin_goals seed failed: {e}");
    }

    // Spawn Discord gateway manager (hot-reload supported via watch channel).
    lib::discord::spawn_manager(
        state.discord_config_tx.subscribe(),
        cfg.clone(),
        state.pool.clone(),
        state.chat_tx.clone(),
    );

    // Clone the relay handle for the chat_watcher (outbound MC → Discord).
    let discord_relay_for_watcher = state.discord.clone();

    // Spawn the background task that tails latest.log and feeds the chat channel.
    lib::minecraft::chat_watcher::spawn(
        cfg.clone(),
        state.pool.clone(),
        state.chat_tx.clone(),
        discord_relay_for_watcher,
    );

    let app = lib::build_router(state);

    let addr = format!("{}:{}", cfg.host, cfg.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("redstoneCipher listening on http://{addr}");

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    Ok(())
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("failed to install Ctrl+C handler");
    tracing::info!("Shutdown signal received");
}

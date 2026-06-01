//! Background task: check for plugin updates every 6 hours.

use std::time::Duration;

use sqlx::SqlitePool;
use tracing::{info, warn};

use crate::{
    config::Config,
    db::installed_plugins,
    minecraft::modrinth,
};

pub fn spawn_plugin_updater(pool: SqlitePool, _cfg: Config) {
    tokio::spawn(async move {
        // Wait a bit after startup before the first sweep.
        tokio::time::sleep(Duration::from_secs(60)).await;

        loop {
            run_update_check(&pool).await;
            tokio::time::sleep(Duration::from_secs(6 * 3600)).await;
        }
    });
}

async fn run_update_check(pool: &SqlitePool) {
    let plugins = match installed_plugins::list(pool).await {
        Ok(v)  => v,
        Err(e) => { warn!("plugin_updater: list failed: {e}"); return; }
    };

    let client = modrinth::build_client();

    for plugin in plugins {
        // Only check plugins that are linked to a Modrinth project.
        let project_key = match plugin.project_key.as_deref() {
            Some(k) => k.to_string(),
            None    => continue,
        };

        let slug = project_key
            .strip_prefix("modrinth:")
            .unwrap_or(&project_key)
            .to_string();

        let latest = match modrinth::get_latest_compatible_version(&client, &slug).await {
            Ok(Some(v)) => v,
            Ok(None)    => continue,
            Err(e)      => {
                warn!("plugin_updater: check failed for {slug}: {e}");
                continue;
            }
        };

        let current_version = plugin.version.as_deref().unwrap_or("");
        let update_available = latest.version_number != current_version
            && !current_version.is_empty();

        if update_available {
            info!(
                "plugin_updater: {} has update: {} → {}",
                plugin.filename, current_version, latest.version_number,
            );
        }

        if let Err(e) = installed_plugins::set_update_available(
            pool, &plugin.filename, update_available,
        ).await {
            warn!("plugin_updater: set_update_available failed for {}: {e}", plugin.filename);
        }

        // Avoid hammering the Modrinth API.
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

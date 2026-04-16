use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

use serde::Serialize;
use ts_rs::TS;

use crate::{config::Config, error::{AppError, Result}};

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct VmStatus {
    pub status: String,
    pub external_ip: Option<String>,
    pub tailscale_ip: String,
}

pub async fn status(cfg: &Config) -> Result<VmStatus> {
    let out = gcloud_run(
        cfg,
        &[
            "compute", "instances", "describe", &cfg.gcp_instance,
            &format!("--project={}", cfg.gcp_project),
            &format!("--zone={}", cfg.gcp_zone),
            "--format=value(status,networkInterfaces[0].accessConfigs[0].natIP)",
        ],
        Duration::from_secs(20),
    )
    .await?;

    let mut parts = out.splitn(2, '\t');
    let vm_status = parts.next().unwrap_or("UNKNOWN").trim().to_string();
    let external_ip = parts.next().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    Ok(VmStatus {
        status: vm_status,
        external_ip,
        tailscale_ip: cfg.tailscale_ip.clone(),
    })
}

pub async fn start(cfg: &Config)  -> Result<()> { vm_action(cfg, "start").await }
pub async fn stop(cfg: &Config)   -> Result<()> { vm_action(cfg, "stop").await }
pub async fn reset(cfg: &Config)  -> Result<()> { vm_action(cfg, "reset").await }

async fn vm_action(cfg: &Config, action: &str) -> Result<()> {
    gcloud_run(
        cfg,
        &[
            "compute", "instances", action, &cfg.gcp_instance,
            &format!("--project={}", cfg.gcp_project),
            &format!("--zone={}", cfg.gcp_zone),
        ],
        Duration::from_secs(120),
    )
    .await?;
    Ok(())
}

async fn gcloud_run(cfg: &Config, args: &[&str], time_limit: Duration) -> Result<String> {
    let fut = Command::new(&cfg.gcloud_bin).args(args).output();

    let output = timeout(time_limit, fut)
        .await
        .map_err(|_| AppError::ExternalCommand("gcloud command timed out".into()))?
        .map_err(|e| AppError::ExternalCommand(e.to_string()))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::ExternalCommand(err));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

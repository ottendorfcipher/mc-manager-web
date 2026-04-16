use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

use crate::{config::Config, error::{AppError, Result}};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// Run an arbitrary shell command on the GCP VM over the IAP tunnel.
/// Returns (stdout, stderr). Non-zero exit is an `AppError::ExternalCommand`.
pub async fn run(cfg: &Config, command: &str) -> Result<(String, String)> {
    run_with_timeout(cfg, command, DEFAULT_TIMEOUT).await
}

pub async fn run_with_timeout(
    cfg: &Config,
    command: &str,
    time_limit: Duration,
) -> Result<(String, String)> {
    let fut = Command::new(&cfg.gcloud_bin)
        .args([
            "compute", "ssh", &cfg.gcp_instance,
            &format!("--project={}", cfg.gcp_project),
            &format!("--zone={}", cfg.gcp_zone),
            "--tunnel-through-iap",
            &format!("--command={}", command),
        ])
        .output();

    let output = timeout(time_limit, fut)
        .await
        .map_err(|_| AppError::ExternalCommand("SSH command timed out".into()))?
        .map_err(|e| AppError::ExternalCommand(e.to_string()))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        let detail = if stdout.is_empty() { &stderr } else { &stdout };
        return Err(AppError::ExternalCommand(
            detail.lines().last().unwrap_or("unknown error").to_string(),
        ));
    }

    Ok((stdout, stderr))
}

/// Write a Minecraft console command to the FIFO pipe.
/// Returns true if APPLIED, false if OFFLINE/NOFIFO (not an error).
pub async fn fifo_command(cfg: &Config, mc_cmd: &str) -> Result<bool> {
    let script = format!(
        "FIFO=/opt/minecraft/console.fifo; \
         if [ -p \"$FIFO\" ]; then \
           echo '{mc_cmd}' | sudo -u minecraft tee -a \"$FIFO\" > /dev/null && echo APPLIED; \
         elif systemctl is-active minecraft > /dev/null 2>&1; then echo NOFIFO; \
         else echo OFFLINE; fi"
    );
    let (out, _) = run_with_timeout(cfg, &script, Duration::from_secs(15)).await?;
    Ok(out.contains("APPLIED"))
}

/// Fetch live metrics in a single SSH call (same script as Python app).
pub async fn fetch_metrics(cfg: &Config) -> Result<MetricsSnapshot> {
    let script = concat!(
        "SVC=$(systemctl is-active minecraft 2>/dev/null || echo inactive); echo \"ACTIVE:$SVC\"; ",
        "TS=$(systemctl show minecraft --property=ActiveEnterTimestamp 2>/dev/null | sed 's/ActiveEnterTimestamp=//'); echo \"UPTIME:$TS\"; ",
        "P=$(ss -tn state established 2>/dev/null | grep -c ':25565 ' || echo 0); echo \"PLAYERS:$P\"; ",
        "MEM=$(ps aux 2>/dev/null | grep '[s]erver.jar' | awk '{print $4}' | head -1); echo \"JAVAMEM:$MEM\"; ",
        "IDLE=$(vmstat 1 2 2>/dev/null | tail -1 | awk '{print $15}'); ",
        "if [ -n \"$IDLE\" ]; then CPU=$((100 - IDLE)); echo \"VMCPU:${CPU}%\"; else echo \"VMCPU:\"; fi"
    );
    let (out, _) = run_with_timeout(cfg, script, Duration::from_secs(30)).await?;
    Ok(MetricsSnapshot::parse(&out))
}

#[derive(Debug, serde::Serialize, ts_rs::TS)]
#[ts(export)]
pub struct MetricsSnapshot {
    pub service_active: bool,
    pub players_online: u32,
    pub uptime_raw: String,
    pub jvm_mem_pct: f32,
    pub vm_cpu_pct: u32,
}

impl MetricsSnapshot {
    fn parse(output: &str) -> Self {
        let mut map = std::collections::HashMap::new();
        for line in output.lines() {
            if let Some((k, v)) = line.split_once(':') {
                map.insert(k.trim().to_lowercase(), v.trim().to_string());
            }
        }
        Self {
            service_active: map.get("active").map(|s| s == "active").unwrap_or(false),
            players_online: map.get("players").and_then(|s| s.parse().ok()).unwrap_or(0),
            uptime_raw: map.get("uptime").cloned().unwrap_or_default(),
            jvm_mem_pct: map.get("javamem").and_then(|s| s.parse().ok()).unwrap_or(0.0),
            vm_cpu_pct: map.get("vmcpu")
                .and_then(|s| s.trim_end_matches('%').parse().ok())
                .unwrap_or(0),
        }
    }
}

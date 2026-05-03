use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

use crate::{config::Config, error::{AppError, Result}};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// SSH key used by the backend service to reach the Minecraft server.
const MC_SSH_KEY: &str = "/opt/redstonecipher/mc_ssh_key";
/// Pinned host keys for the Minecraft server — avoids StrictHostKeyChecking=no.
const MC_KNOWN_HOSTS: &str = "/opt/redstonecipher/mc_known_hosts";

/// Run an arbitrary shell command on the Minecraft server over Tailscale SSH.
/// Returns (stdout, stderr). Non-zero exit is an `AppError::ExternalCommand`.
pub async fn run(cfg: &Config, command: &str) -> Result<(String, String)> {
    run_with_timeout(cfg, command, DEFAULT_TIMEOUT).await
}

pub async fn run_with_timeout(
    cfg: &Config,
    command: &str,
    time_limit: Duration,
) -> Result<(String, String)> {
    let dest = format!("root@{}", cfg.tailscale_ip);
    let fut = Command::new("ssh")
        .args([
            "-i", MC_SSH_KEY,
            "-o", "StrictHostKeyChecking=yes",
            "-o", &format!("UserKnownHostsFile={MC_KNOWN_HOSTS}"),
            "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=10",
            &dest,
            command,
        ])
        .output();

    let output = timeout(time_limit, fut)
        .await
        .map_err(|_| AppError::ExternalCommand("SSH command timed out".into()))?
        .map_err(|e| AppError::ExternalCommand(e.to_string()))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        if !stderr.is_empty() {
            tracing::warn!(stderr = %stderr, "mc ssh stderr");
        }
        let detail = if stdout.is_empty() { &stderr } else { &stdout };
        return Err(AppError::ExternalCommand(
            detail.lines().last().unwrap_or("unknown error").to_string(),
        ));
    }

    Ok((stdout, stderr))
}

/// Write a Minecraft console command to the FIFO pipe.
/// Returns true if APPLIED, false if OFFLINE/NOFIFO (not an error).
///
/// Single quotes in `mc_cmd` are escaped with the POSIX `'\''` idiom so
/// they cannot break out of the surrounding single-quoted shell string.
pub async fn fifo_command(cfg: &Config, mc_cmd: &str) -> Result<bool> {
    let safe_cmd = mc_cmd.replace('\'', r"'\''")
        .replace('\n', " ")   // newlines would inject extra commands
        .replace('\r', "");   // strip CR
    let script = format!(
        "FIFO=/opt/minecraft/console.fifo; \
         if [ -p \"$FIFO\" ]; then \
           echo '{safe_cmd}' | tee -a \"$FIFO\" > /dev/null && echo APPLIED; \
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
    /// `None` when the server is stopped and JVM stats are unavailable.
    pub jvm_mem_pct: Option<f32>,
    /// `None` when vmstat cannot be read (e.g. VM just booted).
    pub vm_cpu_pct: Option<u32>,
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
            jvm_mem_pct: map.get("javamem")
                .and_then(|s| { let s = s.trim(); if s.is_empty() { None } else { s.parse().ok() } }),
            vm_cpu_pct: map.get("vmcpu")
                .and_then(|s| { let s = s.trim().trim_end_matches('%').trim(); if s.is_empty() { None } else { s.parse().ok() } }),
        }
    }

    #[cfg(test)]
    pub fn parse_test(output: &str) -> Self {
        Self::parse(output)
    }
}

#[cfg(test)]
mod tests {
    use super::MetricsSnapshot;

    fn parse(s: &str) -> MetricsSnapshot {
        MetricsSnapshot::parse_test(s)
    }

    #[test]
    fn metrics_parse_active_server() {
        let output = "ACTIVE:active\nUPTIME:Mon 2026-04-28 00:00:00 UTC\nPLAYERS:3\nJAVAMEM:12.5\nVMCPU:42%";
        let m = parse(output);
        assert!(m.service_active);
        assert_eq!(m.players_online, 3);
        assert_eq!(m.uptime_raw, "Mon 2026-04-28 00:00:00 UTC");
        assert!((m.jvm_mem_pct.unwrap() - 12.5).abs() < 0.001);
        assert_eq!(m.vm_cpu_pct, Some(42));
    }

    #[test]
    fn metrics_parse_inactive_server() {
        // When minecraft is stopped: JAVAMEM is empty, VMCPU may still have value.
        let output = "ACTIVE:inactive\nUPTIME:\nPLAYERS:0\nJAVAMEM:\nVMCPU:5%";
        let m = parse(output);
        assert!(!m.service_active);
        assert_eq!(m.players_online, 0);
        assert_eq!(m.jvm_mem_pct, None,  "empty JAVAMEM should be None");
        assert_eq!(m.vm_cpu_pct, Some(5));
    }

    #[test]
    fn metrics_parse_vmstat_unavailable() {
        // vmstat fails → VMCPU: (empty value)
        let output = "ACTIVE:active\nUPTIME:\nPLAYERS:1\nJAVAMEM:8.2\nVMCPU:";
        let m = parse(output);
        assert!(m.service_active);
        assert_eq!(m.vm_cpu_pct, None, "empty VMCPU should be None");
        assert!((m.jvm_mem_pct.unwrap() - 8.2).abs() < 0.001);
    }

    #[test]
    fn metrics_parse_empty_output() {
        let m = parse("");
        assert!(!m.service_active);
        assert_eq!(m.players_online, 0);
        assert_eq!(m.jvm_mem_pct, None);
        assert_eq!(m.vm_cpu_pct, None);
    }

    #[test]
    fn metrics_parse_cpu_100_percent() {
        let output = "ACTIVE:active\nUPTIME:\nPLAYERS:0\nJAVAMEM:\nVMCPU:100%";
        let m = parse(output);
        assert_eq!(m.vm_cpu_pct, Some(100));
    }

    #[test]
    fn metrics_parse_players_zero_is_uint() {
        // grep -c returns 0 when no matches — must parse as u32 not fail
        let output = "ACTIVE:active\nUPTIME:\nPLAYERS:0\nJAVAMEM:4.0\nVMCPU:10%";
        let m = parse(output);
        assert_eq!(m.players_online, 0u32);
    }
}

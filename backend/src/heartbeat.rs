//! Liveness heartbeats for the long-lived background runners.
//!
//! Each runner calls [`beat`] once per loop iteration; [`snapshot`] returns the
//! age (seconds since last beat) for every runner that has ever beaten. This is
//! surfaced in `/metrics` (per-runner gauge) and `/ready` so a hung or panicked
//! runner is observable instead of silently dead.
//!
//! Note: the *event* runners (countdown / rising-oceans / bounty) only loop
//! while an event is active, so their heartbeat ages grow while idle — that's
//! expected. Treat only the always-on runners (chat_watcher, music_zone,
//! scheduled, pin_hud) as health-critical.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

fn registry() -> &'static Mutex<HashMap<&'static str, Instant>> {
    static R: OnceLock<Mutex<HashMap<&'static str, Instant>>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Record that `runner` just completed (or started) a loop iteration.
pub fn beat(runner: &'static str) {
    if let Ok(mut m) = registry().lock() {
        m.insert(runner, Instant::now());
    }
}

/// `(runner, seconds_since_last_beat)` for every runner, sorted by name.
pub fn snapshot() -> Vec<(&'static str, u64)> {
    let mut v: Vec<(&'static str, u64)> = match registry().lock() {
        Ok(m) => m.iter().map(|(k, t)| (*k, t.elapsed().as_secs())).collect(),
        Err(_) => Vec::new(),
    };
    v.sort_by_key(|(k, _)| *k);
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn beat_then_snapshot_reports_runner() {
        beat("unit_test_runner");
        let snap = snapshot();
        assert!(snap.iter().any(|(name, age)| *name == "unit_test_runner" && *age < 5));
    }
}

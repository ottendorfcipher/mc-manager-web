//! Minimal cron-expression parser + next-fire calculator.
//!
//! Supports a 5-field cron string: `M H D M W` (minute, hour, day-of-month,
//! month, day-of-week).  Each field accepts:
//!   • `*`              — wildcard
//!   • `N`              — exact integer
//!   • `N,N,N`          — list
//!   • `*/N`            — step (e.g. `*/15` minute = 0,15,30,45)
//!   • `A-B`            — inclusive range
//!
//! Days-of-week are 0–6 with Sunday = 0.  Both day-of-month and day-of-week
//! act as restrictions when both are non-wildcard (standard cron OR rule).

use chrono::{DateTime, Datelike, Duration, Timelike, Utc};
#[cfg(test)]
use chrono::{NaiveDate, TimeZone};

#[derive(Debug, Clone)]
struct Field(Vec<u32>);

impl Field {
    fn parse(spec: &str, min: u32, max: u32) -> Result<Self, String> {
        let mut out = std::collections::BTreeSet::<u32>::new();
        for part in spec.split(',') {
            let part = part.trim();
            if part == "*" {
                for n in min..=max { out.insert(n); }
                continue;
            }
            if let Some(step_str) = part.strip_prefix("*/") {
                let step: u32 = step_str.parse().map_err(|_| format!("bad step '{part}'"))?;
                if step == 0 { return Err("step cannot be 0".into()); }
                let mut n = min;
                while n <= max { out.insert(n); n += step; }
                continue;
            }
            if let Some((a, b)) = part.split_once('-') {
                let a: u32 = a.parse().map_err(|_| format!("bad range '{part}'"))?;
                let b: u32 = b.parse().map_err(|_| format!("bad range '{part}'"))?;
                if a > b || a < min || b > max { return Err(format!("range out of bounds '{part}'")); }
                for n in a..=b { out.insert(n); }
                continue;
            }
            let n: u32 = part.parse().map_err(|_| format!("bad value '{part}'"))?;
            if n < min || n > max { return Err(format!("value out of bounds '{part}'")); }
            out.insert(n);
        }
        if out.is_empty() { return Err("empty field".into()); }
        Ok(Field(out.into_iter().collect()))
    }

    fn allows(&self, n: u32) -> bool { self.0.binary_search(&n).is_ok() }
}

#[derive(Debug, Clone)]
pub struct Cron {
    pub raw: String,
    minute:  Field,
    hour:    Field,
    dom:     Field,
    month:   Field,
    dow:     Field,
    dom_is_wild: bool,
    dow_is_wild: bool,
}

impl Cron {
    /// Parse `M H D M W`.  Returns Err with a user-friendly message.
    pub fn parse(s: &str) -> Result<Self, String> {
        let parts: Vec<&str> = s.split_whitespace().collect();
        if parts.len() != 5 {
            return Err(format!("expected 5 fields, got {}", parts.len()));
        }
        Ok(Cron {
            raw:     s.to_string(),
            minute:  Field::parse(parts[0], 0, 59)?,
            hour:    Field::parse(parts[1], 0, 23)?,
            dom:     Field::parse(parts[2], 1, 31)?,
            month:   Field::parse(parts[3], 1, 12)?,
            dow:     Field::parse(parts[4], 0, 6)?,
            dom_is_wild: parts[2].trim() == "*",
            dow_is_wild: parts[4].trim() == "*",
        })
    }

    /// Return the next datetime *strictly after* `after` that matches.
    /// Returns None if no match is found within ~5 years.
    pub fn next_after(&self, after: DateTime<Utc>) -> Option<DateTime<Utc>> {
        // Round up to the next whole minute.
        let mut t = (after + Duration::minutes(1))
            .with_second(0)?.with_nanosecond(0)?;

        // Cap iterations conservatively — daily granularity, 5-year horizon.
        for _ in 0..(60 * 24 * 366 * 5) {
            if self.matches(t) { return Some(t); }
            t = t + Duration::minutes(1);
        }
        None
    }

    fn matches(&self, t: DateTime<Utc>) -> bool {
        if !self.minute.allows(t.minute()) { return false; }
        if !self.hour.allows(t.hour())     { return false; }
        if !self.month.allows(t.month())   { return false; }

        let dom_match = self.dom.allows(t.day());
        let dow_match = self.dow.allows(t.weekday().num_days_from_sunday());

        match (self.dom_is_wild, self.dow_is_wild) {
            (true,  true)  => true,
            (false, true)  => dom_match,
            (true,  false) => dow_match,
            // Standard cron: both restrictions active → OR semantics.
            (false, false) => dom_match || dow_match,
        }
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn ts(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> DateTime<Utc> {
        Utc.from_utc_datetime(&NaiveDate::from_ymd_opt(y, mo, d).unwrap().and_hms_opt(h, mi, 0).unwrap())
    }

    #[test]
    fn parse_every_15_min() {
        let c = Cron::parse("*/15 * * * *").unwrap();
        let t = c.next_after(ts(2026, 1, 1, 0, 0)).unwrap();
        assert_eq!((t.hour(), t.minute()), (0, 15));
    }

    #[test]
    fn parse_friday_8pm() {
        // Friday = 5 (Sun=0)
        let c = Cron::parse("0 20 * * 5").unwrap();
        // 2026-01-02 is a Friday
        let t = c.next_after(ts(2026, 1, 1, 0, 0)).unwrap();
        assert_eq!(t.weekday().num_days_from_sunday(), 5);
        assert_eq!((t.hour(), t.minute()), (20, 0));
    }

    #[test]
    fn parse_list_and_range() {
        let c = Cron::parse("0,30 9-17 * * 1-5").unwrap();
        let t = c.next_after(ts(2026, 1, 5, 8, 45)).unwrap(); // Mon 8:45
        assert_eq!((t.hour(), t.minute()), (9, 0));
    }

    #[test]
    fn rejects_malformed() {
        assert!(Cron::parse("bad").is_err());
        assert!(Cron::parse("0 0 0 0 0").is_err());      // out of bounds
        assert!(Cron::parse("*/0 * * * *").is_err());    // bad step
    }
}

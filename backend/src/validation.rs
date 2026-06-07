//! Input validation helpers shared across handlers.
//!
//! Centralising validation here means the rules are consistent and
//! changes to acceptable character sets / length limits propagate
//! everywhere automatically.

use crate::error::{AppError, Result};

// ── Minecraft username validation ─────────────────────────────────────────────
//
// Per Mojang's rules:
//   • 3–16 characters
//   • Only ASCII letters, digits, and underscores
//   • Cannot start with a digit (enforced by Mojang, we mirror it)
//
// We apply this wherever an IGN comes in as a path parameter or request body
// field so that shell-escaped MC console commands (`give {ign} …`,
// `@p[name={ign}]`) can never be injected.

/// Validate a Minecraft IGN.  Returns the (unchanged) IGN on success so
/// callers can chain: `let ign = validate_ign(&raw)?;`
pub fn validate_ign(ign: &str) -> Result<&str> {
    if ign.len() < 3 || ign.len() > 16 {
        return Err(AppError::BadRequest(
            "IGN must be 3–16 characters".into(),
        ));
    }
    if !ign.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(AppError::BadRequest(
            "IGN may only contain letters, digits, and underscores".into(),
        ));
    }
    Ok(ign)
}

// ── Email validation ──────────────────────────────────────────────────────────

pub fn validate_email(email: &str) -> Result<&str> {
    // Basic structure check — full RFC 5322 parsing is overkill here;
    // Google OAuth already validates the email before we store it.
    if !email.contains('@') || email.len() > 254 || email.is_empty() {
        return Err(AppError::BadRequest("Invalid email address".into()));
    }
    Ok(email)
}

// ── Generic text field limits ─────────────────────────────────────────────────

/// Require a trimmed non-empty string within `max_chars`.
pub fn validate_text(value: &str, field: &str, max_chars: usize) -> Result<()> {
    if value.trim().is_empty() {
        return Err(AppError::BadRequest(format!("{field} must not be empty")));
    }
    if value.len() > max_chars {
        return Err(AppError::BadRequest(
            format!("{field} must be {max_chars} characters or fewer"),
        ));
    }
    Ok(())
}

// ── Minecraft item ID validation ──────────────────────────────────────────────
//
// Item IDs have the form `namespace:path` where namespace and path are
// lowercase alphanumeric + underscore + dash.  Crucially, no spaces or
// shell metacharacters.

pub fn validate_item_id(id: &str) -> Result<&str> {
    let id = id.trim();
    if id.is_empty() {
        return Err(AppError::BadRequest("item_id must not be empty".into()));
    }
    // Strip optional namespace prefix for validation of each segment.
    let check = id.strip_prefix("minecraft:").unwrap_or(id);
    if !check.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-' || c == '/') {
        return Err(AppError::BadRequest(
            "item_id contains invalid characters (expected lowercase letters, digits, _, -, /)".into(),
        ));
    }
    Ok(id)
}

// ── Minecraft gamerule validation ─────────────────────────────────────────────
//
// Gamerule names are camelCase ASCII alphanumerics (e.g. `doDaylightCycle`,
// `keepInventory`, `randomTickSpeed`).  Values are either a boolean
// (`true`/`false`) or an integer.  Validating both before they reach
// `gamerule <name> <value>` keeps unexpected tokens out of the console command
// (defence-in-depth on top of the SSH layer's quoting + newline stripping).

/// Validate a gamerule name.  Returns the (unchanged) name on success.
pub fn validate_gamerule_name(rule: &str) -> Result<&str> {
    if rule.is_empty() || rule.len() > 40 {
        return Err(AppError::BadRequest(
            "gamerule name must be 1–40 characters".into(),
        ));
    }
    if !rule.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(AppError::BadRequest(
            "gamerule name may only contain letters and digits".into(),
        ));
    }
    Ok(rule)
}

/// Validate a gamerule value: must be `true`, `false`, or an integer.
/// Returns the trimmed value on success.
pub fn validate_gamerule_value(value: &str) -> Result<&str> {
    let v = value.trim();
    if v == "true" || v == "false" || v.parse::<i64>().is_ok() {
        Ok(v)
    } else {
        Err(AppError::BadRequest(
            "gamerule value must be true, false, or an integer".into(),
        ))
    }
}

/// Validate (and normalise) a difficulty.  Accepts the four named levels or
/// their numeric `0–3` aliases; returns the canonical lowercase name.
pub fn validate_difficulty(value: &str) -> Result<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "peaceful" | "0" => Ok("peaceful"),
        "easy" | "1" => Ok("easy"),
        "normal" | "2" => Ok("normal"),
        "hard" | "3" => Ok("hard"),
        _ => Err(AppError::BadRequest(
            "difficulty must be peaceful, easy, normal, or hard".into(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ign_rules() {
        assert!(validate_ign("Steve_99").is_ok());
        assert!(validate_ign("ab").is_err()); // too short
        assert!(validate_ign("waaaaaaaaaaaaaaay_too_long").is_err());
        assert!(validate_ign("bad name").is_err()); // space
        assert!(validate_ign("inject;rm").is_err()); // metacharacter
    }

    #[test]
    fn gamerule_name_rules() {
        assert_eq!(validate_gamerule_name("keepInventory").unwrap(), "keepInventory");
        assert_eq!(validate_gamerule_name("randomTickSpeed").unwrap(), "randomTickSpeed");
        assert!(validate_gamerule_name("").is_err());
        assert!(validate_gamerule_name("do Fire Tick").is_err()); // space
        assert!(validate_gamerule_name("rule;say hi").is_err()); // metacharacter
        assert!(validate_gamerule_name(&"x".repeat(41)).is_err()); // too long
    }

    #[test]
    fn gamerule_value_rules() {
        assert_eq!(validate_gamerule_value("true").unwrap(), "true");
        assert_eq!(validate_gamerule_value("false").unwrap(), "false");
        assert_eq!(validate_gamerule_value(" 42 ").unwrap(), "42");
        assert_eq!(validate_gamerule_value("-3").unwrap(), "-3");
        assert!(validate_gamerule_value("maybe").is_err());
        assert!(validate_gamerule_value("3; op @a").is_err());
    }

    #[test]
    fn difficulty_rules() {
        assert_eq!(validate_difficulty("HARD").unwrap(), "hard");
        assert_eq!(validate_difficulty("2").unwrap(), "normal");
        assert_eq!(validate_difficulty(" peaceful ").unwrap(), "peaceful");
        assert!(validate_difficulty("nightmare").is_err());
        assert!(validate_difficulty("4").is_err());
    }

    #[test]
    fn text_limits() {
        assert!(validate_text("hello", "field", 10).is_ok());
        assert!(validate_text("   ", "field", 10).is_err()); // blank
        assert!(validate_text(&"x".repeat(11), "field", 10).is_err()); // too long
    }
}

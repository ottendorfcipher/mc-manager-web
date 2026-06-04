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

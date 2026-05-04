//! Role catalog — system roles (seeded by migration) plus custom roles
//! created at runtime through the admin UI.
//!
//! Invariants enforced here (and re-enforced in handlers):
//!   • `is_system = 1` roles cannot be deleted or renamed.
//!   • System role levels are immutable.
//!   • Custom role names match `^[a-z][a-z0-9_-]{0,31}$`.
//!   • Actors can only create/assign roles with level STRICTLY below their own.
//!
//! Linus principle: the data layer knows what is valid; the handler
//! layer knows who is allowed.  Keep them separate.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;

use crate::error::{AppError, Result};

// ── Types ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct Role {
    pub name: String,
    pub label: String,
    pub description: String,
    pub color: String,
    pub level: i64,
    pub is_system: bool,
    pub created_by: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct CreateRole {
    /// Slug identifier: `^[a-z][a-z0-9_-]{0,31}$`.
    pub name: String,
    pub label: String,
    pub description: Option<String>,
    /// 6-digit hex colour, e.g. `#5B9BF0`.
    pub color: Option<String>,
    /// Must be strictly less than the creating actor's role level.
    pub level: i64,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct UpdateRole {
    pub label: Option<String>,
    pub description: Option<String>,
    pub color: Option<String>,
    /// Only honoured for custom (non-system) roles.
    pub level: Option<i64>,
}

// ── Validation ─────────────────────────────────────────────────────────────────

/// Role names that are reserved for system use and cannot be created via the API.
const SYSTEM_NAMES: &[&str] = &["global_admin", "admin", "member", "user", "visitor"];

fn validate_name(name: &str) -> Result<()> {
    if name.is_empty() || name.len() > 32 {
        return Err(AppError::BadRequest(
            "Role name must be 1–32 characters".into(),
        ));
    }
    let mut chars = name.chars();
    if !chars
        .next()
        .map(|c| c.is_ascii_lowercase())
        .unwrap_or(false)
    {
        return Err(AppError::BadRequest(
            "Role name must start with a lowercase letter (a–z)".into(),
        ));
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
    {
        return Err(AppError::BadRequest(
            "Role name may only contain a–z, 0–9, underscores, or hyphens".into(),
        ));
    }
    if SYSTEM_NAMES.contains(&name) {
        return Err(AppError::BadRequest(format!(
            "'{name}' is a reserved system role name"
        )));
    }
    Ok(())
}

fn validate_color(color: &str) -> Result<()> {
    let bytes = color.as_bytes();
    if bytes.len() != 7 || bytes[0] != b'#' || !bytes[1..].iter().all(|b| b.is_ascii_hexdigit()) {
        return Err(AppError::BadRequest(
            "Color must be a 6-digit hex value (e.g. #5B9BF0)".into(),
        ));
    }
    Ok(())
}

// ── Queries ────────────────────────────────────────────────────────────────────

/// All roles ordered by level descending (highest authority first) then name.
pub async fn list(pool: &SqlitePool) -> Result<Vec<Role>> {
    Ok(sqlx::query_as::<_, Role>(
        "SELECT name, label, description, color, level, is_system, created_by, created_at
         FROM roles
         ORDER BY level DESC, name",
    )
    .fetch_all(pool)
    .await?)
}

/// Fetch a single role by name.  Returns `None` if it does not exist.
pub async fn get(pool: &SqlitePool, name: &str) -> Result<Option<Role>> {
    Ok(sqlx::query_as::<_, Role>(
        "SELECT name, label, description, color, level, is_system, created_by, created_at
         FROM roles WHERE name = ?",
    )
    .bind(name)
    .fetch_optional(pool)
    .await?)
}

/// Returns the numeric level for a role.  Falls back to 0 for unknown roles
/// (e.g. a role that was deleted after the JWT was issued).
pub async fn level_for(pool: &SqlitePool, role: &str) -> i64 {
    sqlx::query_scalar::<_, i64>("SELECT level FROM roles WHERE name = ?")
        .bind(role)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .unwrap_or(0)
}

/// How many users are currently assigned to `role_name`.
/// Used to guard deletion: a role with active members cannot be removed.
pub async fn count_users(pool: &SqlitePool, role_name: &str) -> Result<i64> {
    Ok(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE role = ?")
            .bind(role_name)
            .fetch_one(pool)
            .await?,
    )
}

/// Create a new custom role.
pub async fn create(pool: &SqlitePool, actor: &str, req: CreateRole) -> Result<Role> {
    validate_name(&req.name)?;

    let color = req.color.as_deref().unwrap_or("#6B7280");
    validate_color(color)?;

    let description = req.description.unwrap_or_default();
    let now = Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

    // Conflict check: give a clear message rather than leaking a DB error.
    if get(pool, &req.name).await?.is_some() {
        return Err(AppError::Conflict(format!(
            "A role named '{}' already exists",
            req.name
        )));
    }

    sqlx::query(
        "INSERT INTO roles (name, label, description, color, level, is_system, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
    )
    .bind(&req.name)
    .bind(&req.label)
    .bind(&description)
    .bind(color)
    .bind(req.level)
    .bind(actor)
    .bind(&now)
    .execute(pool)
    .await?;

    get(pool, &req.name)
        .await?
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("insert succeeded but fetch failed")))
}

/// Update role metadata.  For system roles, `level` changes are rejected.
pub async fn update(
    pool: &SqlitePool,
    name: &str,
    req: UpdateRole,
    is_system: bool,
) -> Result<Role> {
    if let Some(c) = &req.color {
        validate_color(c)?;
    }
    if is_system && req.level.is_some() {
        return Err(AppError::Forbidden(
            "The level of a system role is immutable".into(),
        ));
    }
    // Apply each field that was supplied — partial update semantics.
    if let Some(v) = &req.label {
        sqlx::query("UPDATE roles SET label = ? WHERE name = ?")
            .bind(v)
            .bind(name)
            .execute(pool)
            .await?;
    }
    if let Some(v) = &req.description {
        sqlx::query("UPDATE roles SET description = ? WHERE name = ?")
            .bind(v)
            .bind(name)
            .execute(pool)
            .await?;
    }
    if let Some(v) = &req.color {
        sqlx::query("UPDATE roles SET color = ? WHERE name = ?")
            .bind(v)
            .bind(name)
            .execute(pool)
            .await?;
    }
    if let Some(v) = req.level {
        sqlx::query("UPDATE roles SET level = ? WHERE name = ?")
            .bind(v)
            .bind(name)
            .execute(pool)
            .await?;
    }
    get(pool, name)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Role '{name}' not found")))
}

/// Delete a custom role.  Cleans up role_permissions automatically since that
/// table has no FK cascade on the `role` column.
pub async fn delete(pool: &SqlitePool, name: &str) -> Result<()> {
    // Cascade permissions first — no FK trigger on role_permissions.
    sqlx::query("DELETE FROM role_permissions WHERE role = ?")
        .bind(name)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM roles WHERE name = ?")
        .bind(name)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_names() {
        assert!(validate_name("developer").is_ok());
        assert!(validate_name("dev-ops").is_ok());
        assert!(validate_name("tier2").is_ok());
        assert!(validate_name("a").is_ok());
    }

    #[test]
    fn invalid_names() {
        assert!(validate_name("").is_err()); // empty
        assert!(validate_name("Admin").is_err()); // uppercase
        assert!(validate_name("2cool").is_err()); // digit start
        assert!(validate_name("has space").is_err()); // space
        assert!(validate_name("admin").is_err()); // reserved
        assert!(validate_name("global_admin").is_err()); // reserved
        assert!(validate_name(&"a".repeat(33)).is_err()); // too long
    }

    #[test]
    fn valid_colors() {
        assert!(validate_color("#5B9BF0").is_ok());
        assert!(validate_color("#ffffff").is_ok());
        assert!(validate_color("#000000").is_ok());
    }

    #[test]
    fn invalid_colors() {
        assert!(validate_color("5B9BF0").is_err()); // missing #
        assert!(validate_color("#5B9BF").is_err()); // too short
        assert!(validate_color("#GG0000").is_err()); // invalid hex
        assert!(validate_color("#5B9BF00").is_err()); // too long
    }
}

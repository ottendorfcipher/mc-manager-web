use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;

use crate::error::{AppError, Result};

pub const GLOBAL_ADMIN: &str = "nicholasaweiner@gmail.com";

#[derive(Debug, Clone, Serialize, Deserialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct User {
    pub email: String,
    pub role: String,
    pub display_name: String,
    pub google_sub: Option<String>,
    pub avatar_url: Option<String>,
    pub added_by: String,
    pub added_at: String,
    pub last_login: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct CreateUser {
    pub email: String,
    pub role: String,
    pub display_name: Option<String>,
}

/// Role levels — higher number = more permissions.
pub fn role_level(role: &str) -> u8 {
    match role {
        "global_admin" => 4,
        "admin"        => 3,
        "member"       => 2,
        "user"         => 1,
        _              => 0,
    }
}

pub async fn list(pool: &SqlitePool) -> Result<Vec<User>> {
    Ok(sqlx::query_as::<_, User>(
        "SELECT email, role, display_name, google_sub, avatar_url, added_by, added_at, last_login FROM users ORDER BY added_at"
    )
    .fetch_all(pool)
    .await?)
}

pub async fn get(pool: &SqlitePool, email: &str) -> Result<Option<User>> {
    Ok(sqlx::query_as::<_, User>(
        "SELECT email, role, display_name, google_sub, avatar_url, added_by, added_at, last_login FROM users WHERE email = ?"
    )
    .bind(email)
    .fetch_optional(pool)
    .await?)
}

/// Insert a new user.  The caller is responsible for verifying that the
/// actor's role level exceeds the target role level before calling this.
pub async fn create(
    pool: &SqlitePool,
    actor: &str,
    req: CreateUser,
) -> Result<User> {
    if get(pool, &req.email).await?.is_some() {
        return Err(AppError::Conflict(format!("{} already exists", req.email)));
    }

    let display_name = req
        .display_name
        .unwrap_or_else(|| derive_display_name(&req.email));
    let now = Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

    sqlx::query(
        "INSERT INTO users (email, role, display_name, added_by, added_at) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(&req.email).bind(&req.role).bind(&display_name).bind(actor).bind(&now)
    .execute(pool)
    .await?;

    get(pool, &req.email)
        .await?
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("insert succeeded but fetch failed")))
}

pub async fn update_role(
    pool: &SqlitePool,
    email: &str,
    new_role: &str,
) -> Result<()> {
    if email == GLOBAL_ADMIN {
        return Err(AppError::Forbidden("Global admin role is permanent".into()));
    }
    sqlx::query("UPDATE users SET role = ? WHERE email = ?")
        .bind(new_role).bind(email)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_display_name(
    pool: &SqlitePool,
    email: &str,
    name: &str,
) -> Result<()> {
    sqlx::query("UPDATE users SET display_name = ? WHERE email = ?")
        .bind(name).bind(email)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_google_identity(
    pool: &SqlitePool,
    email: &str,
    sub: &str,
    avatar_url: Option<&str>,
) -> Result<()> {
    let now = Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    sqlx::query("UPDATE users SET google_sub = ?, avatar_url = ?, last_login = ? WHERE email = ?")
        .bind(sub).bind(avatar_url).bind(&now).bind(email)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn remove(pool: &SqlitePool, email: &str) -> Result<()> {
    if email == GLOBAL_ADMIN {
        return Err(AppError::Forbidden("Global admin cannot be removed".into()));
    }
    sqlx::query("DELETE FROM users WHERE email = ?")
        .bind(email)
        .execute(pool)
        .await?;
    Ok(())
}

fn derive_display_name(email: &str) -> String {
    email
        .split('@')
        .next()
        .unwrap_or(email)
        .replace('.', " ")
        .split_whitespace()
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                None    => String::new(),
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::derive_display_name;

    #[test]
    fn display_name_from_email() {
        assert_eq!(derive_display_name("john.doe@gmail.com"), "John Doe");
        assert_eq!(derive_display_name("alice@test.com"), "Alice");
    }
}

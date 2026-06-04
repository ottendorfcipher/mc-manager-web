use crate::error::Result;
use serde::Serialize;
use sqlx::SqlitePool;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AuditEntry {
    pub id:         i64,
    pub actor:      String,
    pub action:     String,
    pub target:     Option<String>,
    pub detail:     Option<String>,
    pub created_at: String,
}

/// Return the most recent `limit` audit entries, newest first.
pub async fn list_recent(pool: &SqlitePool, limit: i64) -> Result<Vec<AuditEntry>> {
    Ok(sqlx::query_as::<_, AuditEntry>(
        "SELECT id, actor, action, target, detail, created_at
           FROM audit_log
          ORDER BY created_at DESC, id DESC
          LIMIT ?",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?)
}

/// Return recent entries filtered to a specific actor email.
pub async fn list_by_actor(
    pool:  &SqlitePool,
    actor: &str,
    limit: i64,
) -> Result<Vec<AuditEntry>> {
    Ok(sqlx::query_as::<_, AuditEntry>(
        "SELECT id, actor, action, target, detail, created_at
           FROM audit_log
          WHERE actor = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?",
    )
    .bind(actor)
    .bind(limit)
    .fetch_all(pool)
    .await?)
}

pub async fn log(
    pool: &SqlitePool,
    actor: &str,
    action: &str,
    target: Option<&str>,
    detail: Option<&str>,
) -> Result<()> {
    sqlx::query("INSERT INTO audit_log (actor, action, target, detail) VALUES (?, ?, ?, ?)")
        .bind(actor)
        .bind(action)
        .bind(target)
        .bind(detail)
        .execute(pool)
        .await?;
    Ok(())
}

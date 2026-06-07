use crate::error::Result;
use serde::Serialize;
use sqlx::{QueryBuilder, Sqlite, SqlitePool};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AuditEntry {
    pub id:         i64,
    pub actor:      String,
    pub action:     String,
    pub target:     Option<String>,
    pub detail:     Option<String>,
    pub created_at: String,
}

/// Optional filters for the admin audit-log query. All `None`/empty fields are
/// ignored, so the default is "most recent, unfiltered".
#[derive(Debug, Default)]
pub struct AuditFilter {
    pub action: Option<String>,
    pub actor:  Option<String>,
    pub target: Option<String>,
    pub from:   Option<String>, // ISO timestamp, inclusive lower bound
    pub to:     Option<String>, // ISO timestamp, inclusive upper bound
    pub limit:  i64,
    pub offset: i64,
}

/// Filtered audit query. All user values are bound parameters (never
/// interpolated), so the dynamic WHERE clause is injection-safe.
pub async fn list_filtered(pool: &SqlitePool, f: &AuditFilter) -> Result<Vec<AuditEntry>> {
    let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new(
        "SELECT id, actor, action, target, detail, created_at FROM audit_log WHERE 1=1",
    );
    if let Some(a) = f.action.as_deref().filter(|s| !s.is_empty()) {
        qb.push(" AND action = ").push_bind(a.to_string());
    }
    if let Some(a) = f.actor.as_deref().filter(|s| !s.is_empty()) {
        qb.push(" AND actor LIKE ").push_bind(format!("%{a}%"));
    }
    if let Some(t) = f.target.as_deref().filter(|s| !s.is_empty()) {
        qb.push(" AND target LIKE ").push_bind(format!("%{t}%"));
    }
    if let Some(d) = f.from.as_deref().filter(|s| !s.is_empty()) {
        qb.push(" AND created_at >= ").push_bind(d.to_string());
    }
    if let Some(d) = f.to.as_deref().filter(|s| !s.is_empty()) {
        qb.push(" AND created_at <= ").push_bind(d.to_string());
    }
    qb.push(" ORDER BY created_at DESC, id DESC LIMIT ")
        .push_bind(f.limit)
        .push(" OFFSET ")
        .push_bind(f.offset);
    Ok(qb.build_query_as::<AuditEntry>().fetch_all(pool).await?)
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

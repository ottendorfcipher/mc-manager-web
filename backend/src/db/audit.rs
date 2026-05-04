use crate::error::Result;
use sqlx::SqlitePool;

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

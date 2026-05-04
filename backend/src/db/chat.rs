use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;

use crate::error::Result;

/// The maximum number of messages to retain in the DB.
/// Older rows beyond this are pruned after every insert.
const MAX_HISTORY: i64 = 500;

/// A single chat event — broadcast messages and server events.
/// DMs are never persisted.
#[derive(Debug, Clone, Serialize, Deserialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct ChatMessage {
    pub id:         i64,
    /// "mc" | "web" | "server"
    pub source:     String,
    /// Raw author key: email for web, IGN for mc/server.
    pub author:     String,
    /// Human-readable label shown in the UI.
    pub display_as: String,
    pub content:    String,
    pub sent_at:    String,
}

/// Insert a new message and prune old rows to keep the table bounded.
/// Returns the inserted row (with its assigned id and sent_at).
pub async fn insert(
    pool:       &SqlitePool,
    source:     &str,
    author:     &str,
    display_as: &str,
    content:    &str,
) -> Result<ChatMessage> {
    let row = sqlx::query_as::<_, ChatMessage>(
        "INSERT INTO chat_messages (source, author, display_as, content)
         VALUES (?, ?, ?, ?)
         RETURNING *",
    )
    .bind(source)
    .bind(author)
    .bind(display_as)
    .bind(content)
    .fetch_one(pool)
    .await?;

    // Trim old rows — fire-and-forget, don't fail the insert if this errors.
    let _ = trim(pool).await;

    Ok(row)
}

/// Return the most recent `limit` messages in chronological order (oldest first).
pub async fn recent(pool: &SqlitePool, limit: i64) -> Result<Vec<ChatMessage>> {
    Ok(sqlx::query_as::<_, ChatMessage>(
        "SELECT * FROM (
             SELECT * FROM chat_messages ORDER BY sent_at DESC LIMIT ?
         ) ORDER BY sent_at ASC",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?)
}

/// Delete rows beyond the newest MAX_HISTORY, keeping the table size bounded.
async fn trim(pool: &SqlitePool) -> Result<()> {
    sqlx::query(
        "DELETE FROM chat_messages
         WHERE id NOT IN (
             SELECT id FROM chat_messages ORDER BY sent_at DESC LIMIT ?
         )",
    )
    .bind(MAX_HISTORY)
    .execute(pool)
    .await?;
    Ok(())
}

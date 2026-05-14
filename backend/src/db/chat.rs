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
/// Uses `id` as the tiebreaker so rows inserted in the same second are
/// ordered consistently (higher id = more recent).
pub async fn recent(pool: &SqlitePool, limit: i64) -> Result<Vec<ChatMessage>> {
    Ok(sqlx::query_as::<_, ChatMessage>(
        "SELECT * FROM (
             SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?
         ) ORDER BY id ASC",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?)
}

/// Return up to `limit` messages strictly older than `before_id`,
/// in chronological order (oldest first).
/// Used for "load more" pagination — pass the id of the current oldest
/// visible message as the cursor.
pub async fn recent_before(
    pool:      &SqlitePool,
    before_id: i64,
    limit:     i64,
) -> Result<Vec<ChatMessage>> {
    Ok(sqlx::query_as::<_, ChatMessage>(
        "SELECT * FROM (
             SELECT * FROM chat_messages WHERE id < ? ORDER BY id DESC LIMIT ?
         ) ORDER BY id ASC",
    )
    .bind(before_id)
    .bind(limit)
    .fetch_all(pool)
    .await?)
}

/// Delete rows beyond the newest MAX_HISTORY, keeping the table size bounded.
async fn trim(pool: &SqlitePool) -> Result<()> {
    sqlx::query(
        "DELETE FROM chat_messages
         WHERE id NOT IN (
             SELECT id FROM chat_messages ORDER BY id DESC LIMIT ?
         )",
    )
    .bind(MAX_HISTORY)
    .execute(pool)
    .await?;
    Ok(())
}

/// Trim to a custom limit — used only in tests to avoid inserting 500 rows.
#[cfg(test)]
async fn trim_to(pool: &SqlitePool, limit: i64) -> Result<()> {
    sqlx::query(
        "DELETE FROM chat_messages
         WHERE id NOT IN (
             SELECT id FROM chat_messages ORDER BY id DESC LIMIT ?
         )",
    )
    .bind(limit)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("in-memory pool");
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("migrations");
        pool
    }

    #[tokio::test]
    async fn insert_and_retrieve() {
        let pool = test_pool().await;
        let msg = insert(&pool, "mc", "ChaoticLuc", "ChaoticLuc", "hello from mc")
            .await
            .expect("insert");
        assert_eq!(msg.source, "mc");
        assert_eq!(msg.author, "ChaoticLuc");
        assert_eq!(msg.content, "hello from mc");
        assert!(msg.id > 0);
        assert!(!msg.sent_at.is_empty());
    }

    #[tokio::test]
    async fn recent_returns_chronological_order() {
        let pool = test_pool().await;
        insert(&pool, "web",    "a@a.com",  "alice", "first").await.unwrap();
        insert(&pool, "mc",     "Bob",       "Bob",   "second").await.unwrap();
        insert(&pool, "server", "server",    "server","third").await.unwrap();

        let msgs = recent(&pool, 10).await.expect("recent");
        assert_eq!(msgs.len(), 3);
        assert_eq!(msgs[0].content, "first",  "oldest first");
        assert_eq!(msgs[2].content, "third",  "newest last");
    }

    #[tokio::test]
    async fn recent_respects_limit() {
        let pool = test_pool().await;
        for i in 0..10u32 {
            insert(&pool, "web", "a@a.com", "a", &format!("msg {i}"))
                .await
                .unwrap();
        }
        let msgs = recent(&pool, 3).await.expect("recent");
        assert_eq!(msgs.len(), 3, "limit should be respected");
        // Should return the three most recent in ascending order
        assert_eq!(msgs[2].content, "msg 9");
    }

    #[tokio::test]
    async fn trim_removes_oldest_rows() {
        let pool = test_pool().await;
        // Insert 5 rows
        for i in 1..=5u32 {
            insert(&pool, "mc", "IGN", "IGN", &format!("msg {i}"))
                .await
                .unwrap();
        }
        // Trim to 3
        trim_to(&pool, 3).await.expect("trim");

        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM chat_messages")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 3, "trim should leave exactly 3 rows");

        // The remaining rows should be the 3 most recent
        let msgs = recent(&pool, 10).await.unwrap();
        assert_eq!(msgs[0].content, "msg 3");
        assert_eq!(msgs[2].content, "msg 5");
    }

    #[tokio::test]
    async fn insert_returns_correct_source_enum() {
        let pool = test_pool().await;
        for source in &["mc", "web", "server"] {
            let msg = insert(&pool, source, "author", "display", "content")
                .await
                .expect(source);
            assert_eq!(&msg.source, source);
        }
    }
}

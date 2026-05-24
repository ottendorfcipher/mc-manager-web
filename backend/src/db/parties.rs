//! Party data access — named groups of IGNs used as a targeting unit.

use crate::error::Result;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Party {
    pub id:          i64,
    pub name:        String,
    pub description: Option<String>,
    pub owner_email: String,
    pub color:       String,
    pub created_at:  String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PartyMember {
    pub party_id:   i64,
    pub player_ign: String,
    pub added_at:   String,
}

// ── Party CRUD ───────────────────────────────────────────────────────────────

pub async fn create(
    pool:        &SqlitePool,
    name:        &str,
    description: Option<&str>,
    owner_email: &str,
    color:       &str,
) -> Result<Party> {
    Ok(sqlx::query_as::<_, Party>(
        "INSERT INTO parties (name, description, owner_email, color)
         VALUES (?, ?, ?, ?)
         RETURNING *",
    )
    .bind(name)
    .bind(description)
    .bind(owner_email)
    .bind(color)
    .fetch_one(pool)
    .await?)
}

pub async fn list_all(pool: &SqlitePool) -> Result<Vec<Party>> {
    Ok(sqlx::query_as::<_, Party>(
        "SELECT * FROM parties ORDER BY name ASC",
    )
    .fetch_all(pool)
    .await?)
}

/// Parties owned by `email`, plus any parties whose members include one
/// of the user's linked IGNs.
pub async fn list_for_user(pool: &SqlitePool, email: &str) -> Result<Vec<Party>> {
    Ok(sqlx::query_as::<_, Party>(
        "SELECT DISTINCT p.* FROM parties p
            LEFT JOIN party_members  m  ON m.party_id  = p.id
            LEFT JOIN player_links   pl ON LOWER(pl.ign) = LOWER(m.player_ign)
                                       AND LOWER(pl.email) = LOWER(?)
          WHERE LOWER(p.owner_email) = LOWER(?) OR pl.id IS NOT NULL
          ORDER BY p.name ASC",
    )
    .bind(email)
    .bind(email)
    .fetch_all(pool)
    .await?)
}

pub async fn get(pool: &SqlitePool, id: i64) -> Result<Option<Party>> {
    Ok(sqlx::query_as::<_, Party>("SELECT * FROM parties WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?)
}

pub async fn update(
    pool:        &SqlitePool,
    id:          i64,
    name:        &str,
    description: Option<&str>,
    color:       &str,
) -> Result<bool> {
    let r = sqlx::query(
        "UPDATE parties SET name = ?, description = ?, color = ? WHERE id = ?",
    )
    .bind(name)
    .bind(description)
    .bind(color)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn delete(pool: &SqlitePool, id: i64) -> Result<bool> {
    let r = sqlx::query("DELETE FROM parties WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

// ── Members ──────────────────────────────────────────────────────────────────

pub async fn list_members(pool: &SqlitePool, party_id: i64) -> Result<Vec<PartyMember>> {
    Ok(sqlx::query_as::<_, PartyMember>(
        "SELECT * FROM party_members WHERE party_id = ? ORDER BY added_at ASC",
    )
    .bind(party_id)
    .fetch_all(pool)
    .await?)
}

/// Fetch member IGNs for a single party.  Used by handlers when expanding
/// a party reference into its target list.
pub async fn member_igns(pool: &SqlitePool, party_id: i64) -> Result<Vec<String>> {
    Ok(sqlx::query_scalar::<_, String>(
        "SELECT player_ign FROM party_members WHERE party_id = ? ORDER BY added_at ASC",
    )
    .bind(party_id)
    .fetch_all(pool)
    .await?)
}

pub async fn add_member(pool: &SqlitePool, party_id: i64, ign: &str) -> Result<()> {
    sqlx::query(
        "INSERT INTO party_members (party_id, player_ign) VALUES (?, ?)
         ON CONFLICT(party_id, player_ign) DO NOTHING",
    )
    .bind(party_id)
    .bind(ign)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn remove_member(pool: &SqlitePool, party_id: i64, ign: &str) -> Result<bool> {
    let r = sqlx::query(
        "DELETE FROM party_members WHERE party_id = ? AND player_ign = ?",
    )
    .bind(party_id)
    .bind(ign)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

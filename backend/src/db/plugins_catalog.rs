use crate::error::Result;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CachedPlugin {
    pub project_key:          String,
    pub source:               String,
    pub slug:                 String,
    pub title:                String,
    pub icon_url:             Option<String>,
    pub description:          Option<String>,
    pub ai_summary:           Option<String>,
    pub loaders_json:         String,
    pub mc_versions_json:     String,
    pub downloads:            i64,
    pub follows:              i64,
    pub license:              Option<String>,
    pub homepage_url:         Option<String>,
    pub last_updated_upstream: Option<String>,
    pub last_fetched_at:      String,
}

#[allow(clippy::too_many_arguments)]
pub async fn upsert(
    pool:                  &SqlitePool,
    project_key:           &str,
    source:                &str,
    slug:                  &str,
    title:                 &str,
    icon_url:              Option<&str>,
    description:           Option<&str>,
    loaders_json:          &str,
    mc_versions_json:      &str,
    downloads:             i64,
    follows:               i64,
    license:               Option<&str>,
    homepage_url:          Option<&str>,
    last_updated_upstream: Option<&str>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO plugins_catalog_cache
            (project_key, source, slug, title, icon_url, description,
             loaders_json, mc_versions_json, downloads, follows, license,
             homepage_url, last_updated_upstream, last_fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(project_key) DO UPDATE SET
            source               = excluded.source,
            slug                 = excluded.slug,
            title                = excluded.title,
            icon_url             = excluded.icon_url,
            description          = excluded.description,
            loaders_json         = excluded.loaders_json,
            mc_versions_json     = excluded.mc_versions_json,
            downloads            = excluded.downloads,
            follows              = excluded.follows,
            license              = excluded.license,
            homepage_url         = excluded.homepage_url,
            last_updated_upstream = excluded.last_updated_upstream,
            last_fetched_at      = datetime('now')",
    )
    .bind(project_key)
    .bind(source)
    .bind(slug)
    .bind(title)
    .bind(icon_url)
    .bind(description)
    .bind(loaders_json)
    .bind(mc_versions_json)
    .bind(downloads)
    .bind(follows)
    .bind(license)
    .bind(homepage_url)
    .bind(last_updated_upstream)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_by_key(pool: &SqlitePool, key: &str) -> Result<Option<CachedPlugin>> {
    Ok(sqlx::query_as::<_, CachedPlugin>(
        "SELECT * FROM plugins_catalog_cache WHERE project_key = ?",
    )
    .bind(key)
    .fetch_optional(pool)
    .await?)
}

pub async fn list_by_keys(pool: &SqlitePool, keys: &[String]) -> Result<Vec<CachedPlugin>> {
    if keys.is_empty() {
        return Ok(vec![]);
    }
    let placeholders = keys.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let query = format!(
        "SELECT * FROM plugins_catalog_cache WHERE project_key IN ({placeholders})"
    );
    let mut q = sqlx::query_as::<_, CachedPlugin>(&query);
    for k in keys {
        q = q.bind(k);
    }
    Ok(q.fetch_all(pool).await?)
}

pub async fn search_cached(pool: &SqlitePool, q: &str, limit: i64) -> Result<Vec<CachedPlugin>> {
    let pattern = format!("%{q}%");
    Ok(sqlx::query_as::<_, CachedPlugin>(
        "SELECT * FROM plugins_catalog_cache
          WHERE title LIKE ? OR description LIKE ? OR slug LIKE ?
          ORDER BY downloads DESC
          LIMIT ?",
    )
    .bind(&pattern)
    .bind(&pattern)
    .bind(&pattern)
    .bind(limit)
    .fetch_all(pool)
    .await?)
}

pub async fn mark_stale(pool: &SqlitePool, key: &str) -> Result<()> {
    sqlx::query(
        "UPDATE plugins_catalog_cache
            SET last_fetched_at = '1970-01-01T00:00:00'
          WHERE project_key = ?",
    )
    .bind(key)
    .execute(pool)
    .await?;
    Ok(())
}

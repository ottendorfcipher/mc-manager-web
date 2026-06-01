use crate::error::Result;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PluginGoal {
    pub slug:        String,
    pub title:       String,
    pub description: String,
    pub icon:        String,
    pub sort_order:  i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PluginGoalPick {
    pub goal_slug:   String,
    pub project_key: String,
    pub rank:        i64,
    pub blurb:       Option<String>,
}

pub async fn list_goals(pool: &SqlitePool) -> Result<Vec<PluginGoal>> {
    Ok(sqlx::query_as::<_, PluginGoal>(
        "SELECT * FROM plugin_goals ORDER BY sort_order ASC",
    )
    .fetch_all(pool)
    .await?)
}

pub async fn get_picks(pool: &SqlitePool, slug: &str) -> Result<Vec<PluginGoalPick>> {
    Ok(sqlx::query_as::<_, PluginGoalPick>(
        "SELECT * FROM plugin_goal_picks WHERE goal_slug = ? ORDER BY rank ASC",
    )
    .bind(slug)
    .fetch_all(pool)
    .await?)
}

/// Seed the 6 default goals + their picks if the table is empty.
pub async fn seed_goals_if_empty(pool: &SqlitePool) -> Result<()> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM plugin_goals")
        .fetch_one(pool)
        .await?;
    if count > 0 {
        return Ok(());
    }

    let goals = [
        ("protect-builds",  "Protect builds",             "Shield your server from griefing",    "Shield",         1),
        ("teleport-home",   "Let players teleport home",  "Home and warp commands for players",  "Home",           2),
        ("economy",         "Add money & shops",          "Economy, currency, and player shops", "Coins",          3),
        ("anti-cheat",      "Stop cheaters",              "Detect and block cheating clients",   "Siren",          4),
        ("ranks-chat",      "Ranks & custom chat",        "Player ranks and formatted chat",     "MessageSquare",  5),
        ("mini-games",      "Add mini-games",             "Minigame frameworks and content",     "Gamepad2",       6),
    ];

    for (slug, title, desc, icon, sort) in &goals {
        sqlx::query(
            "INSERT OR IGNORE INTO plugin_goals (slug, title, description, icon, sort_order)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(slug)
        .bind(title)
        .bind(desc)
        .bind(icon)
        .bind(sort)
        .execute(pool)
        .await?;
    }

    let picks: &[(&str, &str, i64, &str)] = &[
        ("protect-builds", "modrinth:worldguard",        1, "Most powerful protection"),
        ("protect-builds", "modrinth:coreprotect",       2, "Block logging & rollback"),
        ("protect-builds", "modrinth:griefdefender",     3, "Claim-based protection"),
        ("teleport-home",  "modrinth:essentialsx",       1, "All-in-one essentials"),
        ("teleport-home",  "modrinth:huskhomes",         2, "Modern homes & warps"),
        ("teleport-home",  "modrinth:cmi",               3, "Feature-rich CMI"),
        ("economy",        "modrinth:essentialsx",       1, "Built-in economy"),
        ("economy",        "modrinth:vault",             2, "Economy API (required by many)"),
        ("economy",        "modrinth:quickshop-hikari",  3, "Player chest shops"),
        ("anti-cheat",     "modrinth:matrix",            1, "Modern anti-cheat"),
        ("anti-cheat",     "modrinth:nocheatplus",       2, "Classic anti-cheat"),
        ("ranks-chat",     "modrinth:luckperms",         1, "Best permissions plugin"),
        ("ranks-chat",     "modrinth:essentialschat",    2, "Chat formatting"),
        ("mini-games",     "modrinth:bedwars",           1, "Bed Wars"),
        ("mini-games",     "modrinth:lobby",             2, "Lobby management"),
    ];

    for (goal_slug, project_key, rank, blurb) in picks {
        sqlx::query(
            "INSERT OR IGNORE INTO plugin_goal_picks (goal_slug, project_key, rank, blurb)
             VALUES (?, ?, ?, ?)",
        )
        .bind(goal_slug)
        .bind(project_key)
        .bind(rank)
        .bind(blurb)
        .execute(pool)
        .await?;
    }

    Ok(())
}

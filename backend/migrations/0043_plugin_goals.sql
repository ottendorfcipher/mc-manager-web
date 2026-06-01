CREATE TABLE plugin_goals (
    slug          TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    description   TEXT NOT NULL,
    icon          TEXT NOT NULL,
    sort_order    INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE plugin_goal_picks (
    goal_slug     TEXT NOT NULL REFERENCES plugin_goals(slug) ON DELETE CASCADE,
    project_key   TEXT NOT NULL,
    rank          INTEGER NOT NULL,
    blurb         TEXT,
    PRIMARY KEY (goal_slug, project_key)
);

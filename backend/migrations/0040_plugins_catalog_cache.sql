CREATE TABLE plugins_catalog_cache (
    project_key   TEXT PRIMARY KEY,
    source        TEXT NOT NULL,
    slug          TEXT NOT NULL,
    title         TEXT NOT NULL,
    icon_url      TEXT,
    description   TEXT,
    ai_summary    TEXT,
    loaders_json  TEXT NOT NULL,
    mc_versions_json TEXT NOT NULL,
    downloads     INTEGER NOT NULL DEFAULT 0,
    follows       INTEGER NOT NULL DEFAULT 0,
    license       TEXT,
    homepage_url  TEXT,
    last_updated_upstream TEXT,
    last_fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_catalog_source_slug ON plugins_catalog_cache(source, slug);

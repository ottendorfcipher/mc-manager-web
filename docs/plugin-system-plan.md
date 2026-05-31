# Plugin System — Implementation Plan

> Status: design draft.
> Owner: admin@example.com.
> Scope: introduces a goal-oriented plugin browser, installer, updater, and health monitor for the live Tailscale MC server. **Adds** to the existing app — does not modify any current page, table, or background runner except where called out explicitly.

---

## 1. Guiding principles (the constraint set)

| Principle                                  | Implication                                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| **User never learns technical terms**      | Every technical decision (loader, version, dep tree, hash) is hidden by default; vocabulary is translated. |
| **Nothing is off-limits**                  | A power user can still pin versions, switch sources, upload jars by hand. It's all under an "Advanced" expander. |
| **Doesn't disrupt current workflow**       | New routes, new DB tables, new UI tab. No existing route signature changes. No existing DB column moves.  |
| **Tailscale isolation preserved**          | MC server stays Tailscale-only. The backend (already SSH-connected) is the *only* thing that talks to it. |
| **Reuse existing infra**                   | Backup system, restart handling, FIFO console bridge, health checks, audit log — already there.            |
| **Beginner-safe by default**               | Auto-backup before any plugin op, crash-loop detection, one-tap undo. Surfaced as reassurance, not warnings. |

The unifying rule for every UI decision:
**Ask the user only about genuine preferences. Make every technical decision for them.**

---

## 2. How it slots into what already exists

```
                ┌──────────────────────────────────────────────────┐
                │              redstoneCipher VPS                  │
                │  ┌────────────┐     ┌──────────────┐             │
                │  │ React SPA  │ ──▶ │ Rust backend │ ◀── SQLite  │
                │  └────────────┘     └──────┬───────┘             │
                │                            │ ssh (existing)      │
                └────────────────────────────┼─────────────────────┘
                                             │ Tailscale
                ┌────────────────────────────┼─────────────────────┐
                │              MC server     │                     │
                │  /opt/minecraft/server/{plugins/, logs/, ...}    │
                │                                                  │
                │  - PaperMC 1.21.11                               │
                │  - existing FIFO console (used by music zones,   │
                │    pin HUD, chat watcher, etc.)                  │
                └──────────────────────────────────────────────────┘
```

Everything below the backend stays exactly as it is today. The only new SSH endpoints on mc-server-1 are file ops in `/opt/minecraft/server/plugins/` and a check command for which plugins Paper successfully loaded — both already permitted by the existing ssh role.

### Reused infrastructure (zero new dependencies on the MC side)

| Existing capability                      | New use                                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Backup runner (prune + xz archival)      | Auto-backup tagged as `created_by = "<user>"` before every plugin install/uninstall/update.   |
| `gcloud::ssh::run` + `fifo_command`      | Plugin file ops, MC restart, runtime `reload confirm`-style checks.                            |
| `chat_watcher` (tails `latest.log`)      | Add regex hooks for `Loaded plugin`, `Could not load`, plugin stack traces.                    |
| Server status / metrics endpoint         | Used by crash-loop detection to know when MC failed to come back up.                           |
| Audit log (`db::audit`)                  | Every install / remove / update writes one row, so "Undo last change" is just `ORDER BY id DESC LIMIT 1` plus the linked backup. |
| systemd unit (`infra/minecraft.service`) | `systemctl restart --no-block minecraft` (same call already used by pack rebuild).             |

### Things we deliberately do *not* touch

- `world_switch.rs`, `music_zone_runner.rs`, `pin_hud_runner.rs`, the resource pack pipeline — unrelated, untouched.
- The current scheduled-jobs runner is left alone; the plugin updater gets its own small periodic task so it can be enabled/disabled independently.

---

## 3. Data model

Five new tables. All forward-only migrations; no existing column changes.

### `0040_plugins_catalog_cache.sql`

```sql
-- Mirror of Modrinth/Hangar project metadata for every plugin we've ever
-- seen.  Used by Browse, Detail, and Search.  Refreshed lazily on demand
-- and by a background sweep; we never fetch from the upstream during a
-- user-facing render.
CREATE TABLE plugins_catalog_cache (
    project_key   TEXT PRIMARY KEY,         -- "modrinth:abc123" or "hangar:LuckPerms"
    source        TEXT NOT NULL,            -- 'modrinth' | 'hangar' | 'manual'
    slug          TEXT NOT NULL,
    title         TEXT NOT NULL,
    icon_url      TEXT,
    description   TEXT,                     -- raw description, untouched
    ai_summary    TEXT,                     -- one-sentence plain-English
    loaders_json  TEXT NOT NULL,            -- ["paper","spigot","bukkit"]
    mc_versions_json TEXT NOT NULL,         -- ["1.21","1.21.1",...]
    downloads     INTEGER NOT NULL DEFAULT 0,
    follows       INTEGER NOT NULL DEFAULT 0,
    license       TEXT,
    homepage_url  TEXT,
    last_updated_upstream TEXT,             -- ISO timestamp from upstream
    last_fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_catalog_source_slug ON plugins_catalog_cache(source, slug);
```

### `0041_installed_plugins.sql`

```sql
-- One row per .jar currently on disk in /opt/minecraft/server/plugins/.
-- We're the source of truth — the filesystem is reconciled on every
-- post-restart health check.
CREATE TABLE installed_plugins (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    filename      TEXT NOT NULL UNIQUE,      -- "LuckPerms-Paper-5.4.123.jar"
    project_key   TEXT,                      -- FK-ish into plugins_catalog_cache (NULL = manual upload)
    declared_name TEXT,                      -- value of `name:` in plugin.yml
    version       TEXT,                      -- value of `version:` in plugin.yml
    api_version   TEXT,                      -- value of `api-version:` in plugin.yml
    depends_json  TEXT NOT NULL DEFAULT '[]',-- plugin.yml `depend` list
    softdepends_json TEXT NOT NULL DEFAULT '[]',
    sha1          TEXT,                      -- file hash for integrity / dedup
    size_bytes    INTEGER NOT NULL DEFAULT 0,
    installed_by  TEXT NOT NULL,
    installed_at  TEXT NOT NULL DEFAULT (datetime('now')),
    -- Runtime state, updated by the chat-watcher hook:
    last_load_status TEXT NOT NULL DEFAULT 'unknown',   -- 'running' | 'errored' | 'not_loading' | 'unknown'
    last_status_at   TEXT
);
```

### `0042_plugin_jobs.sql`

```sql
-- Install / update / remove jobs.  Drives the multi-step backend
-- pipeline and powers the "pre-flight" UI.
CREATE TABLE plugin_jobs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    kind          TEXT NOT NULL,                 -- 'install' | 'update' | 'remove'
    project_key   TEXT,                          -- NULL for manual-upload installs
    target_version TEXT,                         -- pinned version, or NULL = latest compatible
    requested_by  TEXT NOT NULL,
    requested_at  TEXT NOT NULL DEFAULT (datetime('now')),

    -- pipeline state
    state         TEXT NOT NULL DEFAULT 'queued',
                  -- queued | resolving | downloading | backing_up | uploading | restart_pending | verifying | done | failed | rolled_back
    state_detail  TEXT,                          -- last log line / error string
    plan_json     TEXT,                          -- resolved dependency closure + conflicts
    backup_id     INTEGER REFERENCES backup_runs(id),
    audit_id      INTEGER,                       -- ties to audit_log row for "Undo last change"
    finished_at   TEXT
);

CREATE INDEX idx_plugin_jobs_state ON plugin_jobs(state);
CREATE INDEX idx_plugin_jobs_requested_at ON plugin_jobs(requested_at DESC);
```

### `0043_plugin_goals.sql`

```sql
-- Curated goal-oriented entry points.  Sound system: the data shape
-- is in the DB so a future admin UI can edit them, but the seed
-- content ships in code (see backend/src/handlers/plugins/goals.rs).
CREATE TABLE plugin_goals (
    slug          TEXT PRIMARY KEY,         -- "protect-builds"
    title         TEXT NOT NULL,
    description   TEXT NOT NULL,
    icon          TEXT NOT NULL,            -- lucide icon name
    sort_order    INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE plugin_goal_picks (
    goal_slug     TEXT NOT NULL REFERENCES plugin_goals(slug) ON DELETE CASCADE,
    project_key   TEXT NOT NULL,            -- references catalog cache
    rank          INTEGER NOT NULL,         -- 1 = featured, 2,3,... = also-good
    blurb         TEXT,                     -- "Easiest setup", "Most powerful"
    PRIMARY KEY (goal_slug, project_key)
);
```

### `0044_plugin_health_events.sql`

```sql
-- Rolling log of plugin-related events parsed out of latest.log.
-- Powers per-plugin status badge AND the crash-loop attribution.
CREATE TABLE plugin_health_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    plugin_filename TEXT,                    -- nullable for general MC events
    kind          TEXT NOT NULL,             -- 'loaded' | 'load_error' | 'startup_crash' | 'runtime_error'
    detail        TEXT NOT NULL,             -- short summary, NOT the full stack trace
    raw_line      TEXT,                      -- the log line that triggered (truncated)
    observed_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_plugin_health_at ON plugin_health_events(observed_at DESC);
```

---

## 4. Backend modules

Mirror the existing pattern (`backend/src/{db,handlers,minecraft}/<feature>.rs`):

```
backend/src/
├── db/
│   ├── plugins_catalog.rs       # CRUD on plugins_catalog_cache
│   ├── installed_plugins.rs     # CRUD on installed_plugins
│   ├── plugin_jobs.rs           # CRUD + state transitions
│   ├── plugin_goals.rs          # read-only after seed
│   └── plugin_health.rs         # append-only log
├── handlers/
│   └── plugins/
│       ├── mod.rs
│       ├── browse.rs            # GET /api/plugins/browse?goal=...&q=...
│       ├── detail.rs            # GET /api/plugins/:project_key
│       ├── install.rs           # POST /api/plugins/install
│       ├── update.rs            # POST /api/plugins/update + POST /api/plugins/update-all
│       ├── remove.rs            # DELETE /api/plugins/:filename
│       ├── installed.rs         # GET /api/plugins/installed
│       ├── jobs.rs              # GET /api/plugins/jobs/:id (poll), GET /api/plugins/jobs/recent
│       ├── upload.rs            # POST /api/plugins/upload (manual jar)
│       └── undo.rs              # POST /api/plugins/undo-last
└── minecraft/
    ├── plugin_install.rs        # the install pipeline state machine
    ├── plugin_jar.rs            # plugin.yml reader, sha1
    ├── plugin_health.rs         # log parser, status reconciler
    ├── plugin_updater.rs        # daily background task
    └── modrinth.rs              # Modrinth API client (and later hangar.rs)
```

### 4.1 Modrinth client (`modrinth.rs`)

Thin wrapper around the public Modrinth v2 API. Three calls cover 95% of use cases:

| Call                                       | Purpose                                          |
| ------------------------------------------ | ------------------------------------------------ |
| `GET /v2/search` with facets               | Browse / search, pre-filtered to paper+1.21.11.  |
| `GET /v2/project/{id_or_slug}`             | Detail page metadata + dependency list.          |
| `GET /v2/project/{id_or_slug}/version`     | Pick the right jar (latest compatible by default). |

Notes:
- Pass `User-Agent: redstoneCipher/<version> (contact)` per Modrinth ToS.
- Cache every response in `plugins_catalog_cache` keyed by `project_key`, refreshed if older than 24 h.
- Background sweep (every 6 h) refreshes the rows we care about: anything installed, plus the top ~200 search results for our facet set.

### 4.2 plugin.yml reader (`plugin_jar.rs`)

A .jar is a zip with a `plugin.yml` at the root. Reading it gives us `name`, `version`, `api-version`, `depend`, `softdepend`, `loadbefore`. Same parser used by:
- Manual-upload path (no Modrinth metadata available)
- Post-install verification (does what we put on disk match what we expected?)
- Updates that don't bump the filename (some plugins ship with a constant filename)

### 4.3 Compatibility engine

A pure function (no I/O) over plugin metadata + server state:

```rust
fn check_compatibility(
    project:           &PluginCatalogEntry,
    target_version:    Option<&str>,
    server_loader:     &str,         // "paper"
    server_mc_version: &str,         // "1.21.11"
    installed:         &[InstalledPlugin],
) -> CompatibilityResult {
    // returns Works / NeedsHelpers(deps...) / Conflicts(plugins...)
    //         / RiskyOldVersion / RiskyNewerApi / Unavailable
}
```

Pure → easy to unit-test, idempotent, doesn't block on network. Network resolution lives in the install pipeline, not here.

### 4.4 Install pipeline (`plugin_install.rs`)

State machine driven by `plugin_jobs` rows. Idempotent — every state transition writes the new state to the row before doing any external work, so a crash mid-step resumes correctly on the next backend boot.

```
queued
  → resolving           (BFS through Modrinth `dependencies` field; deduplicate
                         against installed_plugins; detect `incompatible` rows)
  → backing_up          (calls existing minecraft::backup::create with
                         created_by = <actor email>, so the new "5-most-recent
                         retention" rule will preserve it indefinitely)
  → downloading         (jar(s) cached at /opt/redstonecipher/data/plugin-cache/
                         <sha1>.jar; SHA-1 verified against Modrinth metadata)
  → uploading           (single rsync over SSH puts every jar in /opt/minecraft/server/plugins/)
  → restart_pending     (terminal *if* user picked "Restart later")
  → verifying           (after restart: tail logs for ~60s, reconcile
                         installed_plugins.last_load_status)
  → done | failed
```

Failure handling for any step writes `state = failed` + `state_detail`, then triggers the safety net (§6). State `rolled_back` only happens when the safety net runs.

### 4.5 Health monitoring (`plugin_health.rs`)

Two new regexes wired into the existing `chat_watcher` regex pipeline. **Doesn't replace the chat watcher** — adds two more `Regex::captures` calls.

```
^\[.*?INFO\]: \[(?P<name>[A-Za-z0-9_.-]+)\] Enabling \k<name> v(?P<version>\S+)$
^\[.*?ERROR\]: Could not load 'plugins/(?P<file>[^']+)'.*$
```

Both insert into `plugin_health_events` and update the matching `installed_plugins.last_load_status`. The "Per-plugin status badge" in the UI is just a `SELECT` on that column.

### 4.6 Crash-loop detection

The existing health check on `systemctl is-active minecraft` already runs. We add a side check: if the last `systemctl restart` happened within ~5 minutes AND came from a `plugin_jobs` row in state `restart_pending` or `verifying` AND MC is in `failed`/`activating (auto-restart)` for >90s — attribute to that job.

UI response: surface the chip "*The plugin you just added (X) may have caused this.* [Remove it and restart]". Click executes a remove-job, which uses the same auto-backup pipeline. Already-existing audit + backup tie-in means **rollback is just running another job in reverse** — no special-case code path.

### 4.7 Background updater (`plugin_updater.rs`)

Runs every 6 h. For each `installed_plugins` row with a `project_key`:
- Hit Modrinth `version` endpoint
- If a newer version is available AND it's compatible AND it's not the version we already have → mark the row.
- The Music-page-style update pill ("3 plugins have updates") reads from this annotation.

Fire-and-forget per row, same pattern as the existing pin HUD ticks.

---

## 5. Frontend

### 5.1 Routes

```
/plugins                  → goal-oriented Browse home
/plugins/browse?q=…       → search view (still pre-filtered)
/plugins/goal/:slug       → "Protect builds" landing
/plugins/detail/:key      → project page
/plugins/installed        → "My plugins" list
/plugins/jobs/:id         → install progress (rarely linked; jobs usually
                            surface as a toast + global progress chip)
```

All under a new top-nav entry **Plugins** between **Players** and **Configure**. No existing nav item moves.

### 5.2 New components

```
frontend/src/features/plugins/
├── PluginsHome.tsx          # Goals grid, social-proof shelves, search
├── GoalLandingPage.tsx      # 1 goal → curated set + secondary picks
├── PluginDetailPage.tsx     # AI summary, trust signals, "Add to server"
├── InstallFlow.tsx          # Pre-flight steps, dep sentence, conflict prompt
├── RestartPendingChip.tsx   # Global chip, lives in Layout
├── InstalledList.tsx        # "My plugins" with status badges + update pills
├── UndoLastButton.tsx       # On Installed page, top right
├── UploadJarPanel.tsx       # Manual upload path
├── AdvancedExpander.tsx     # Wraps anything technical
└── vocab.ts                 # Translation map (see §7)
```

### 5.3 State / data flow

Already-in-use TanStack Query patterns extend cleanly:

- **Browse**: `useQuery(["plugins/browse", goal, q], …)` — backend hits Modrinth (or its cache) with the right facets.
- **Detail**: `useQuery(["plugins/detail", key], …)`. The AI summary is part of the response if cached, else null and we fetch on demand.
- **Install**: a mutation that creates a `plugin_jobs` row and returns the id. The Install Flow component then polls `useQuery(["plugins/jobs", id], { refetchInterval: 1000 })` until `state ∈ {done, failed, restart_pending}`.
- **Installed list**: `useQuery(["plugins/installed"], { refetchInterval: 30_000 })`.

### 5.4 The "Restart pending" chip

Lives in `Layout.tsx`'s top bar (alongside the existing nav). Visible whenever **any** unfinished job has `state = restart_pending`. Click → small dialog: *"Adding X and Y to your server. Apply changes now? [Restart now] [Later]"*. No other page renders it.

This is the only existing-file edit (a single import + render line). All other UI work is purely additive.

---

## 6. The safety net (the real product)

The single most important section. Three mechanisms, all driven by existing infrastructure:

### 6.1 Auto-backup before every plugin op

Already free: the install pipeline's `backing_up` step calls `minecraft::backup::create` with `created_by = <user email>`. The earlier retention change *already* exempts user-initiated backups from the 5-most-recent prune, so these survive forever.

We store the new backup row's id in `plugin_jobs.backup_id`. "Undo last change" becomes:

```sql
SELECT id, backup_id FROM plugin_jobs
WHERE state IN ('done','failed')
ORDER BY finished_at DESC LIMIT 1;
```

then call the existing `backup::restore` on `backup_id`. One handler, ~15 lines.

### 6.2 Crash-loop attribution

Described in §4.6. The mechanic in user-facing terms:
- Server starts crashing within minutes of a plugin install
- Chip appears: *"The plugin you just added (LuckPerms) may have caused this."*
- One button: *"Remove it and restart."*
- That click runs a `remove` job, which goes through the same pipeline, including its own auto-backup.

### 6.3 Per-plugin health badge

Three states the user can act on, in plain language:
| Backend `last_load_status` | UI label                  |
| -------------------------- | ------------------------- |
| `running`                  | "Running"                 |
| `errored`                  | "Errored — view details"  |
| `not_loading`              | "Not loading — fix it"    |
| `unknown`                  | (no badge shown)          |

"Fix it" opens a short panel with the offending log line in plain language ("Built for a newer Minecraft version than yours") and a [Remove] button.

---

## 7. Translation layer (`vocab.ts`)

Central, version-controlled, used everywhere. Sample shape:

```ts
export const PLUGIN_VOCAB = {
  // Concept ────────────── → User-facing word(s) ────────────
  loader:         null,           // never shown
  dependency:     "required helper",
  also_depends:   "also needs",
  incompatible:   "doesn't work alongside",
  api_version_newer: "built for a newer version of Minecraft than your server",
  not_tagged_current: "made for an older version — might work, might have hiccups",

  // Status ─────────────── → Badge text ───────────────
  running:        "Running",
  errored:        "Errored — view details",
  not_loading:    "Not loading — fix it",

  // Pipeline state ─────── → Pre-flight step ──────────
  resolving:      "Checking it works with your server",
  conflict_found: "This doesn't get along with {plugin} you already have",
  backing_up:     "Saving a safety copy",
  downloading:    "Downloading add-on",
  uploading:      "Sending to your server",
  restart_pending:"Your server needs a quick restart to finish",
  verifying:      "Making sure it loaded cleanly",
};
```

Frontend imports from here, backend mirrors keys (for any messages it returns in API responses) via a TS-RS-generated const. No technical term ever appears in JSX literals — lint rule enforces it (optional, post-MVP).

---

## 8. Curated goals seed

Hardcoded JSON to start (we can move to an admin UI later):

```json
[
  { "slug": "protect-builds",     "title": "Protect builds",      "icon": "shield",
    "picks": ["modrinth:worldguard", "modrinth:coreprotect", "modrinth:griefdefender"] },
  { "slug": "teleport-home",      "title": "Let players teleport home", "icon": "house",
    "picks": ["modrinth:essentialsx", "modrinth:cmi", "modrinth:huskhomes"] },
  { "slug": "economy",            "title": "Add money & shops",   "icon": "coins",
    "picks": ["modrinth:essentialsx", "modrinth:vault", "modrinth:quickshop-hikari"] },
  { "slug": "anti-cheat",         "title": "Stop cheaters",        "icon": "siren",
    "picks": ["modrinth:matrix", "modrinth:nocheatplus"] },
  { "slug": "ranks-chat",         "title": "Ranks & custom chat",  "icon": "messages-square",
    "picks": ["modrinth:luckperms", "modrinth:essentialschat"] },
  { "slug": "mini-games",         "title": "Add mini-games",       "icon": "gamepad-2",
    "picks": ["modrinth:bedwars", "modrinth:lobby"] }
]
```

Surfaced shelves: *Starter essentials* (a hand-picked 5), *Most-installed on servers like yours* (Modrinth ranks ≥ N downloads with our facet), *Staff picks* (admin-curated, future).

---

## 9. Manual upload bridge

For premium or download-only plugins:

1. Detail page shows "We can't install this one automatically. [Open download page]" with the homepage URL.
2. After the user downloads the jar, the same page offers [Upload the file here], opening `UploadJarPanel`.
3. Backend accepts the .jar, reads its `plugin.yml`, runs the same compatibility engine, and if it matches a Modrinth/Hangar project by name+version, links it back to the catalog so updates *can* eventually be auto-detected.
4. Otherwise marks `project_key = NULL` and skips it in the auto-updater.

The user gets a guided two-step instead of a brick wall.

---

## 10. Phasing

### Phase 1 — End-to-end happy path (2 weeks effort, gated rollout)

Goal: a global admin can browse Modrinth (paper, 1.21.11), install LuckPerms, see it loaded, remove it again. No goals page yet — just plain search.

- Migrations 0040–0042.
- `modrinth.rs`, `plugin_jar.rs`, `installed_plugins` reconcile-from-disk job at startup.
- Install pipeline (queued → done) without dep resolution.
- Routes: `/api/plugins/browse`, `/api/plugins/detail`, `/api/plugins/install`, `/api/plugins/installed`, `/api/plugins/jobs/:id`.
- Frontend: `/plugins` shows a simple search; detail page; install button → toast with progress; installed list.
- **Behind a feature flag** in `app_settings` so it only renders for `admin@example.com` while we shake it out.

### Phase 2 — The "just works" magic

- Dep resolver (BFS through Modrinth `dependencies`).
- Conflict detection from `incompatible` deps.
- Auto-backup wiring + `Undo last change`.
- Health regexes in `chat_watcher` + `installed_plugins.last_load_status`.
- Crash-loop attribution.
- `RestartPendingChip` in Layout.

Once Phase 2 lands, the safety net is real — feature flag widens to all `global_admin` users.

### Phase 3 — Discovery polish

- Migration 0043 (goals) + seed.
- `PluginsHome.tsx` with goals grid, "Starter essentials", "Most-installed".
- AI summary endpoint + caching (`ai_summary` column in catalog cache).
- Migration 0044 (health events) + per-plugin badge UI.
- Update pill, `/api/plugins/update`, `/api/plugins/update-all`.

Feature flag goes off — generally available.

### Phase 4 — Power tools

- "Advanced" expander UI: pin version, switch source (Modrinth ↔ Hangar), view file hash.
- Hangar integration as a second source.
- Manual upload bridge.
- Optional: replace `vocab.ts` lints / "speak in technical terms" admin toggle for power users.

---

## 11. Risks & how the existing infrastructure handles them

| Risk                                                | Mitigation (mostly free)                                                                                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tailscale isolation: MC server can't reach Modrinth | Backend (on the VPS) downloads jars, then SCPs to MC. MC stays Tailscale-only. Same network shape as resource pack hosting.                            |
| A bad plugin bricks the MC server                   | Auto-backup runs before *every* plugin op; crash-loop attribution offers one-click remove + restart; `Undo last change` restores the safety backup. |
| Modrinth rate limits / outage                       | Catalog cache (24 h) serves the UI even when upstream is down; install path falls back to the cached metadata + previously-downloaded jars.            |
| Premium / external plugins                          | Manual upload bridge routes through the same compatibility + health pipeline.                                                                          |
| MC restart kicks players                            | Existing `--no-block` restart semantics + the "Restart later" option in the install flow let the admin pick the right moment.                          |
| Disk fill from jar/cache                            | Same pattern as backup archival: `plugin-cache/` keeps last N versions per project (e.g. 3); cleanup runs after every successful install.              |
| Conflict with existing manual jars                  | Startup reconciler picks them up as `project_key = NULL` rows so the UI shows them with a "manually installed" badge instead of treating them as missing. |
| Two admins racing on installs                       | `plugin_jobs.state` is the lock — second admin sees "Another install is in progress" until the first finishes.                                          |

---

## 12. Why this doesn't disrupt the current workflow

- **Database**: 5 new tables, 0 modified columns, all forward-only migrations.
- **Backend**: new modules under `db/`, `handlers/plugins/`, `minecraft/plugin_*` — no signature change to any existing module.
- **Frontend**: new feature directory `features/plugins/` and one nav item. The only edit to any existing file is two lines in `Layout.tsx` (import + render `RestartPendingChip`).
- **MC server**: no plugins installed by *us* until the user installs one. The new SSH commands are file ops in `plugins/` and a status check — all permissible under the existing ssh role.
- **Backup retention**: already accommodating — the user-initiated exemption from §6.1 was implemented in commit `6b7e2ea7` for exactly this kind of use case.
- **Existing runners**: untouched. Music zones, pin HUD, scrolling credits, chat watcher continue to function. The chat watcher gets two more regex captures, but its hot path doesn't change.

---

## 13. Open questions

1. **AI summary source.** Anthropic API on the backend? Or a small local model? Recommend: Anthropic via existing API plumbing (cheap, async, cached forever per project version).
2. **Hangar inclusion** in Phase 3 vs Phase 4? Modrinth alone covers ~70% of plugins users will ask for; Hangar is the official Paper directory but smaller. Recommend: Phase 4.
3. **Per-world plugins.** Some plugins are world-scoped; we don't model that yet. Recommend: out of scope for v1, capture as a future ticket.
4. **Multi-server.** This whole plan assumes one MC server. The data model is single-server-shaped. If a second MC server is added later, `installed_plugins`, `plugin_jobs`, and `plugin_health_events` all gain a `server_id`. Not a hard migration.
5. **License surfacing.** Do we want to require the user to acknowledge each plugin's license? Recommend: no by default; show it in Advanced.

---

## 14. Snapshot of the first PR

To make Phase 1 concrete, the inaugural commit looks like:

```
backend/migrations/0040_plugins_catalog_cache.sql        (new)
backend/migrations/0041_installed_plugins.sql            (new)
backend/migrations/0042_plugin_jobs.sql                  (new)
backend/src/db/plugins_catalog.rs                        (new, ~120 lines)
backend/src/db/installed_plugins.rs                      (new, ~100 lines)
backend/src/db/plugin_jobs.rs                            (new, ~150 lines)
backend/src/db/mod.rs                                    (+3 lines)
backend/src/minecraft/modrinth.rs                        (new, ~200 lines)
backend/src/minecraft/plugin_jar.rs                      (new, ~80 lines)
backend/src/minecraft/plugin_install.rs                  (new, ~250 lines)
backend/src/minecraft/mod.rs                             (+3 lines)
backend/src/handlers/plugins/mod.rs                      (new)
backend/src/handlers/plugins/browse.rs                   (new, ~100 lines)
backend/src/handlers/plugins/detail.rs                   (new, ~80 lines)
backend/src/handlers/plugins/install.rs                  (new, ~80 lines)
backend/src/handlers/plugins/installed.rs                (new, ~60 lines)
backend/src/handlers/plugins/jobs.rs                     (new, ~50 lines)
backend/src/handlers/mod.rs                              (+1 line)
backend/src/lib.rs                                       (+~10 lines for routes)
frontend/src/types/index.ts                              (+ Plugin types)
frontend/src/features/plugins/PluginsHome.tsx            (new, ~150 lines, simple)
frontend/src/features/plugins/PluginDetailPage.tsx       (new, ~200 lines)
frontend/src/features/plugins/InstallFlow.tsx            (new, ~250 lines)
frontend/src/features/plugins/InstalledList.tsx          (new, ~150 lines)
frontend/src/features/plugins/vocab.ts                   (new, ~50 lines)
frontend/src/App.tsx                                     (+ 4 route lines)
frontend/src/components/Layout.tsx                       (+ Plugins nav item)
```

~3 000 lines, mostly additive, behind a feature flag — same shape as the parties and music-zones launches.

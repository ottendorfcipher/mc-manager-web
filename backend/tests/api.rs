/// Integration tests for the redstoneCipher API.
///
/// Each test builds an isolated AppState with an in-memory SQLite database
/// (full migrations applied + permissions seeded) so tests are hermetic and
/// require no running Minecraft VM or GCloud credentials.
///
/// Authenticated requests are made by minting a real JWT with the same
/// `issue_jwt` / `JWT_COOKIE` helpers used in production.
use axum_test::TestServer;

// ── Bring the crate under test into scope ────────────────────────────────────
// Integration tests live in `tests/` and can only access the crate's public
// API.  `build_router` is pub(crate) which is sufficient for integration tests
// in the same workspace.
use redstonecipher_server::{build_router, AppState, Config};

// Re-export the auth helpers we need for minting cookies.
use redstonecipher_server::auth::middleware::{issue_jwt, JWT_COOKIE};

use axum::http::{header, StatusCode};
use std::path::PathBuf;

// ── Test fixture ─────────────────────────────────────────────────────────────

const TEST_JWT_SECRET: &str = "test_secret_for_integration_tests_only_64chars_00000000000000000";
const ADMIN_EMAIL: &str = "admin@example.test"; // seeded global_admin (BOOTSTRAP_ADMIN_EMAIL)

/// Returns a fully-populated `Config` suitable for integration tests.
/// All optional credentials are `None`; the test can override specific fields
/// by constructing a `Config { ..test_cfg() }` clone if needed.
fn test_cfg() -> Config {
    Config {
        host: "127.0.0.1".into(),
        port: 8787,
        database_url: "sqlite::memory:".into(),
        jwt_secret: TEST_JWT_SECRET.into(),
        google_client_id: "test".into(),
        google_client_secret: "test".into(),
        redirect_uri: "http://localhost:8787/auth/callback".into(),
        bootstrap_admin_email: Some(ADMIN_EMAIL.into()),
        cors_origins: vec!["http://localhost:8787".into()],
        cloudflare_team_domain: None,
        cloudflare_client_id: None,
        cloudflare_client_secret: None,
        cloudflare_redirect_uri: None,
        setup_token: None,
        budget_webhook_token: Some("test_budget_token".into()),
        gcloud_bin: PathBuf::from("/usr/bin/false"),
        gcp_project: "test-project".into(),
        gcp_zone: "us-central1-a".into(),
        gcp_instance: "test-instance".into(),
        tailscale_ip: "100.0.0.1".into(),
        mc_backup_dir: "/tmp/test_backups".into(),
        mc_server_dir: "/tmp/test_server".into(),
        mc_scripts_dir: "/tmp/test_scripts".into(),
        map_tiles_dir: "/tmp/test_tiles".into(),
        watchdog_token: None,
        mc_worlds_dir: "/tmp/test_worlds".into(),
        mc_backups_base_dir: "/tmp/test_backups_base".into(),
        resend_api_key: None,
        tailscale_api_key: None,
        tailscale_tailnet: "test-tailnet".into(),
        site_url: "http://localhost:8787".into(),
        email_from: "redstoneCipher <onboarding@example.com>".into(),
        cookie_secure: true,
        discord_bot_token: None,
        discord_webhook_url: None,
        discord_channel_id: None,
        settings_enc_key: [0u8; 32],
    }
}

/// Build an `AppState` backed by a fresh in-memory SQLite database.
/// Migrations (including permission seeding) are applied automatically.
async fn test_state() -> AppState {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("in-memory SQLite failed");

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("migrations failed");

    seed_test_admin(&pool).await;

    // No Discord configured in tests.
    AppState::new(pool, test_cfg(), None)
}

/// Build an `AppState` with a custom config (used when test needs specific
/// env-var overrides, e.g. a real watchdog token).
async fn test_state_with_cfg(cfg: Config) -> AppState {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("in-memory SQLite failed");
    sqlx::migrate!("./migrations").run(&pool).await.expect("migrations failed");
    seed_test_admin(&pool).await;
    AppState::new(pool, cfg, None)
}

/// Seed the protected global admin used by the test suite (the migration no
/// longer hardcodes one; production seeds from BOOTSTRAP_ADMIN_EMAIL).
async fn seed_test_admin(pool: &sqlx::SqlitePool) {
    redstonecipher_server::db::users::set_global_admin(Some(ADMIN_EMAIL.into()));
    redstonecipher_server::db::users::seed_bootstrap_admin(pool, ADMIN_EMAIL)
        .await
        .expect("seed bootstrap admin");
}

/// Inject a stub peer address so the rate-limiter (`GovernorLayer`) can extract
/// a key.  Production serves the router via `into_make_service_with_connect_info`,
/// which populates `ConnectInfo<SocketAddr>`; axum-test's mock transport does
/// not set up a connection, so we add it here.
async fn stub_connect_info(
    mut req: axum::http::Request<axum::body::Body>,
    next: axum::middleware::Next,
) -> axum::response::Response {
    use std::net::SocketAddr;
    req.extensions_mut()
        .insert(axum::extract::ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 8080))));
    next.run(req).await
}

/// `build_router` + the test-only connect-info shim.
fn test_router(state: AppState) -> axum::Router {
    build_router(state).layer(axum::middleware::from_fn(stub_connect_info))
}

/// Build a `TestServer` from a fresh in-memory state.
async fn server() -> (TestServer, AppState) {
    let state = test_state().await;
    let app = test_router(state.clone());
    let srv = TestServer::new(app).expect("TestServer::new failed");
    (srv, state)
}

/// Mint a session cookie for `email` with `role`.
fn session_cookie(email: &str, role: &str) -> String {
    let token = issue_jwt(email, role, TEST_JWT_SECRET).expect("issue_jwt failed");
    format!("{JWT_COOKIE}={token}")
}

// ── Auth / unauthenticated guard tests ───────────────────────────────────────

#[tokio::test]
async fn unauthenticated_api_me_returns_401() {
    let (srv, _) = server().await;
    let res = srv.get("/api/me").await;
    assert_eq!(res.status_code(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn unauthenticated_kill_switch_get_returns_401() {
    let (srv, _) = server().await;
    let res = srv.get("/api/kill-switch").await;
    assert_eq!(res.status_code(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn unauthenticated_properties_get_returns_401() {
    let (srv, _) = server().await;
    let res = srv.get("/api/properties").await;
    assert_eq!(res.status_code(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn unauthenticated_backup_list_returns_401() {
    let (srv, _) = server().await;
    let res = srv.get("/api/backups").await;
    assert_eq!(res.status_code(), StatusCode::UNAUTHORIZED);
}

// ── Health / readiness probe tests ────────────────────────────────────────────

#[tokio::test]
async fn health_probe_is_unauthenticated_and_ok() {
    let (srv, _) = server().await;
    let res = srv.get("/health").await;
    assert_eq!(res.status_code(), StatusCode::OK);
    let body: serde_json::Value = res.json();
    assert_eq!(body["status"], "ok");
    assert!(body["version"].is_string());
    assert!(body["uptime_secs"].is_number());
}

#[tokio::test]
async fn ready_probe_reports_db_ok() {
    let (srv, _) = server().await;
    let res = srv.get("/ready").await;
    assert_eq!(res.status_code(), StatusCode::OK);
    let body: serde_json::Value = res.json();
    assert_eq!(body["status"], "ready");
    assert_eq!(body["db"], "ok");
}

#[tokio::test]
async fn audit_log_filter_and_csv_export() {
    let (srv, state) = server().await;
    // Seed a couple of audit rows directly.
    redstonecipher_server::db::audit::log(&state.pool, "alice@example.com", "create_world", Some("alpha"), None)
        .await
        .unwrap();
    redstonecipher_server::db::audit::log(&state.pool, "bob@example.com", "delete_world", Some("beta"), None)
        .await
        .unwrap();

    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");

    // Filter by action → only the matching row.
    let res = srv
        .get("/api/admin/audit-log?action=create_world")
        .add_header(header::COOKIE, cookie.clone())
        .await;
    assert_eq!(res.status_code(), StatusCode::OK);
    let rows: serde_json::Value = res.json();
    assert_eq!(rows.as_array().unwrap().len(), 1);
    assert_eq!(rows[0]["actor"], "alice@example.com");

    // CSV export returns text/csv with a header row + the seeded rows.
    let res = srv
        .get("/api/admin/audit-log/export")
        .add_header(header::COOKIE, cookie)
        .await;
    assert_eq!(res.status_code(), StatusCode::OK);
    assert!(res
        .headers()
        .get(header::CONTENT_TYPE)
        .unwrap()
        .to_str()
        .unwrap()
        .contains("text/csv"));
    let body = res.text();
    assert!(body.starts_with("id,created_at,actor,action,target,detail"));
    assert!(body.contains("create_world"));
    assert!(body.contains("delete_world"));
}

#[tokio::test]
async fn audit_log_export_requires_permission() {
    let (srv, _) = server().await;
    let cookie = session_cookie("member@example.com", "member");
    let res = srv
        .get("/api/admin/audit-log/export")
        .add_header(header::COOKIE, cookie)
        .await;
    assert_eq!(res.status_code(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn record_join_flags_new_pending_once() {
    let state = test_state().await;
    // First-ever join: allowed AND flagged as newly pending (→ notify admins).
    let (a1, new1) =
        redstonecipher_server::db::pending_players::record_join(&state.pool, "Newbie", None)
            .await
            .unwrap();
    assert_eq!(a1, "allow");
    assert!(new1, "first join should be flagged newly_pending");
    // Second join: kicked (already pending), NOT flagged again.
    let (a2, new2) =
        redstonecipher_server::db::pending_players::record_join(&state.pool, "Newbie", None)
            .await
            .unwrap();
    assert_eq!(a2, "kick");
    assert!(!new2, "repeat join must not re-flag newly_pending");
}

#[tokio::test]
async fn metrics_endpoint_exposes_prometheus_text() {
    let (srv, _) = server().await;
    let res = srv.get("/metrics").await;
    assert_eq!(res.status_code(), StatusCode::OK);
    let body = res.text();
    // Prometheus exposition format with our gauges present.
    assert!(body.contains("redstonecipher_uptime_seconds"));
    assert!(body.contains("redstonecipher_db_pool_connections"));
    assert!(body.contains("redstonecipher_sse_subscribers{channel=\"chat\"}"));
    assert!(body.contains("# TYPE redstonecipher_event_active gauge"));
}

// ── Input validation gating tests ─────────────────────────────────────────────

#[tokio::test]
async fn set_gamerule_rejects_malformed_name() {
    let (srv, _) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");
    // A name with a space / metacharacters must be rejected at the boundary
    // (400) before any console command is constructed.
    let res = srv
        .post("/api/world/gamerule/evil;%20op%20@a")
        .add_header(header::COOKIE, cookie)
        .json(&serde_json::json!({ "value": "true" }))
        .await;
    assert_eq!(res.status_code(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn set_gamerule_rejects_non_boolean_non_integer_value() {
    let (srv, _) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");
    let res = srv
        .post("/api/world/gamerule/keepInventory")
        .add_header(header::COOKIE, cookie)
        .json(&serde_json::json!({ "value": "maybe; say pwned" }))
        .await;
    assert_eq!(res.status_code(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn global_search_finds_players_and_gates_users() {
    let (srv, state) = server().await;
    redstonecipher_server::db::player_snapshots::upsert(
        &state.pool, "uuid-1", "SearchableSteve",
        0.0, 64.0, 0.0, 0.0, "minecraft:overworld", "[]", 20.0,
    )
    .await
    .unwrap();

    // A member (no users.view) sees the player hit but no user hits.
    let cookie = session_cookie("member@example.com", "member");
    let res = srv
        .get("/api/search?q=Searchable")
        .add_header(header::COOKIE, cookie)
        .await;
    assert_eq!(res.status_code(), StatusCode::OK);
    let hits: serde_json::Value = res.json();
    let arr = hits.as_array().unwrap();
    assert!(arr.iter().any(|h| h["kind"] == "player" && h["label"] == "SearchableSteve"));
    assert!(arr.iter().all(|h| h["kind"] != "user"), "member must not see user hits");
}

#[tokio::test]
async fn activity_insights_tracks_sessions() {
    let (srv, state) = server().await;
    // Simulate a join + leave.
    redstonecipher_server::db::player_sessions::start(&state.pool, "Grinder").await.unwrap();
    redstonecipher_server::db::player_sessions::end(&state.pool, "Grinder").await.unwrap();
    // A second open session (still online).
    redstonecipher_server::db::player_sessions::start(&state.pool, "Grinder").await.unwrap();

    let cookie = session_cookie("member@example.com", "member");
    let res = srv
        .get("/api/players/insights?days=7")
        .add_header(header::COOKIE, cookie)
        .await;
    assert_eq!(res.status_code(), StatusCode::OK);
    let body: serde_json::Value = res.json();
    assert_eq!(body["days"], 7);
    assert_eq!(body["total_sessions"], 2);
    let players = body["players"].as_array().unwrap();
    assert!(players.iter().any(|p| p["ign"] == "Grinder" && p["sessions"] == 2));
    assert!(body["peak_hours"].is_array());
}

#[tokio::test]
async fn activity_insights_requires_permission() {
    let (srv, _) = server().await;
    let cookie = session_cookie("nobody@example.com", "user"); // no nav.players
    let res = srv
        .get("/api/players/insights")
        .add_header(header::COOKIE, cookie)
        .await;
    assert_eq!(res.status_code(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn notification_prefs_default_on_and_roundtrip() {
    let (srv, _) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");

    // Defaults: all categories on.
    let res = srv
        .get("/api/me/notification-prefs")
        .add_header(header::COOKIE, cookie.clone())
        .await;
    assert_eq!(res.status_code(), StatusCode::OK);
    let p: serde_json::Value = res.json();
    assert_eq!(p["pending_player"], true);
    assert_eq!(p["world_switch"], true);
    assert_eq!(p["kill_switch"], true);

    // Disable one, then read it back.
    let res = srv
        .put("/api/me/notification-prefs")
        .add_header(header::COOKIE, cookie.clone())
        .json(&serde_json::json!({ "pending_player": false, "world_switch": true, "kill_switch": false }))
        .await;
    assert_eq!(res.status_code(), StatusCode::OK);
    let res = srv
        .get("/api/me/notification-prefs")
        .add_header(header::COOKIE, cookie)
        .await;
    let p: serde_json::Value = res.json();
    assert_eq!(p["pending_player"], false);
    assert_eq!(p["kill_switch"], false);
    assert_eq!(p["world_switch"], true);
}

#[tokio::test]
async fn events_calendar_gating() {
    let (srv, _) = server().await;
    // member has events.status.view → 200 (empty list, no jobs seeded).
    let res = srv
        .get("/api/events/calendar?days=14")
        .add_header(header::COOKIE, session_cookie("m@example.com", "member"))
        .await;
    assert_eq!(res.status_code(), StatusCode::OK);
    assert!(res.json::<serde_json::Value>().is_array());
    // a role without the perm → 403.
    let res = srv
        .get("/api/events/calendar")
        .add_header(header::COOKIE, session_cookie("nobody@example.com", "nonexistent_role"))
        .await;
    assert_eq!(res.status_code(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn sessions_list_and_revoke_all() {
    let (srv, state) = server().await;
    // Seed a couple of login events for the admin.
    redstonecipher_server::db::login_events::record(&state.pool, ADMIN_EMAIL, Some("1.2.3.4"), Some("Firefox"))
        .await
        .unwrap();

    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");
    let res = srv
        .get("/api/me/sessions")
        .add_header(header::COOKIE, cookie.clone())
        .await;
    assert_eq!(res.status_code(), StatusCode::OK);
    let rows: serde_json::Value = res.json();
    assert!(rows.as_array().unwrap().iter().any(|r| r["ip"] == "1.2.3.4"));

    // revoke-all sets the cutoff to now; a JWT minted moments ago has iat < now,
    // so the very same cookie should now be rejected.
    let res = srv
        .post("/api/me/sessions/revoke-all")
        .add_header(header::COOKIE, cookie.clone())
        .await;
    assert_eq!(res.status_code(), StatusCode::NO_CONTENT);
    // The next request with the (now-stale) token is unauthenticated.
    let res = srv
        .get("/api/me/sessions")
        .add_header(header::COOKIE, cookie)
        .await;
    assert_eq!(res.status_code(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn music_playlist_create_add_and_list() {
    let (srv, _) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");

    // Create a playlist.
    let res = srv
        .post("/api/music/playlists")
        .add_header(header::COOKIE, cookie.clone())
        .json(&serde_json::json!({ "name": "Chill Set" }))
        .await;
    assert_eq!(res.status_code(), StatusCode::CREATED);
    let id = res.json::<serde_json::Value>()["id"].as_i64().unwrap();

    // It shows up in the list with 0 tracks.
    let res = srv.get("/api/music/playlists").add_header(header::COOKIE, cookie.clone()).await;
    let lists: serde_json::Value = res.json();
    assert!(lists.as_array().unwrap().iter().any(|p| p["id"] == id && p["name"] == "Chill Set" && p["track_count"] == 0));

    // Add a vanilla catalog track (cat or pigstep are real catalog ids).
    let res = srv
        .post(&format!("/api/music/playlists/{id}/tracks"))
        .add_header(header::COOKIE, cookie.clone())
        .json(&serde_json::json!({ "sound_id": "minecraft:music_disc.cat" }))
        .await;
    // Either accepted (known catalog id) or a clean 400 if the id isn't in the
    // catalog — both prove the endpoint validates rather than 500s.
    assert!(
        res.status_code() == StatusCode::NO_CONTENT || res.status_code() == StatusCode::BAD_REQUEST,
        "unexpected status {}", res.status_code()
    );

    // Member without music.play can't manage playlists.
    let res = srv
        .get("/api/music/playlists")
        .add_header(header::COOKIE, session_cookie("nobody@example.com", "nonexistent_role"))
        .await;
    assert_eq!(res.status_code(), StatusCode::FORBIDDEN);
}

// ── Kill-switch handler tests ─────────────────────────────────────────────────

#[tokio::test]
async fn kill_switch_get_requires_killswitch_view_permission() {
    let (srv, _) = server().await;
    // The AuthUser extractor validates the JWT and loads permissions by role.
    // A JWT whose role does not exist in role_permissions gets an empty set.
    // The require_perm("killswitch.view") guard then returns 403 Forbidden.
    let cookie = session_cookie("nobody@example.com", "nonexistent_role");
    let res = srv
        .get("/api/kill-switch")
        .add_header(header::COOKIE, cookie)
        .await;
    assert_eq!(
        res.status_code(),
        StatusCode::FORBIDDEN,
        "a role with no permissions should be denied killswitch.view"
    );
}

#[tokio::test]
async fn kill_switch_get_succeeds_for_global_admin() {
    let (srv, _) = server().await;
    // global_admin is seeded in migration 0001
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");
    let res = srv
        .get("/api/kill-switch")
        .add_header(header::COOKIE, cookie)
        .await;
    assert_eq!(res.status_code(), StatusCode::OK);
    let body: serde_json::Value = res.json();
    // Initially not engaged
    assert!(body["disabled_at"].is_null());
}

#[tokio::test]
async fn kill_switch_engage_and_release() {
    let (srv, _) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");

    // Engage
    let engage_res = srv
        .post("/api/kill-switch")
        .add_header(header::COOKIE, cookie.clone())
        .json(&serde_json::json!({ "reason": "integration test" }))
        .await;
    assert_eq!(engage_res.status_code(), StatusCode::OK);
    let body: serde_json::Value = engage_res.json();
    assert!(
        body["disabled_at"].is_string(),
        "disabled_at should be set after engage"
    );
    assert_eq!(body["reason"], "integration test");

    // Release
    let release_res = srv
        .delete("/api/kill-switch")
        .add_header(header::COOKIE, cookie.clone())
        .await;
    assert_eq!(release_res.status_code(), StatusCode::OK);
    let body: serde_json::Value = release_res.json();
    assert!(
        body["disabled_at"].is_null(),
        "disabled_at should be null after release"
    );
}

// ── Kill-switch guard middleware tests ────────────────────────────────────────

#[tokio::test]
async fn kill_switch_guard_blocks_mutations_when_engaged() {
    let (srv, state) = server().await;

    // Engage the kill-switch directly via the DB layer
    redstonecipher_server::db::kill_switch::engage(&state.pool, "test guard", "test")
        .await
        .expect("engage failed");

    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");

    // POST /api/server/vm/start should be blocked (503)
    let res = srv
        .post("/api/server/vm/start")
        .add_header(header::COOKIE, cookie.clone())
        .await;
    assert_eq!(
        res.status_code(),
        StatusCode::SERVICE_UNAVAILABLE,
        "mutations should be blocked while kill-switch is engaged"
    );
}

#[tokio::test]
async fn kill_switch_guard_allows_reads_when_engaged() {
    let (srv, state) = server().await;

    redstonecipher_server::db::kill_switch::engage(&state.pool, "test guard", "test")
        .await
        .expect("engage failed");

    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");

    // GET /api/kill-switch is explicitly exempt and should return 200
    let res = srv
        .get("/api/kill-switch")
        .add_header(header::COOKIE, cookie.clone())
        .await;
    assert_eq!(res.status_code(), StatusCode::OK);
}

#[tokio::test]
async fn kill_switch_guard_allows_release_when_engaged() {
    let (srv, state) = server().await;

    redstonecipher_server::db::kill_switch::engage(&state.pool, "test guard", "test")
        .await
        .expect("engage failed");

    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");

    // DELETE /api/kill-switch should always pass the guard (exempt path)
    let res = srv
        .delete("/api/kill-switch")
        .add_header(header::COOKIE, cookie)
        .await;
    assert_eq!(res.status_code(), StatusCode::OK);
}

// ── Permission model tests ────────────────────────────────────────────────────

#[tokio::test]
async fn permissions_list_requires_users_permissions_edit() {
    let (srv, state) = server().await;

    // Seed a member user (does not have users.permissions.edit)
    sqlx::query(
        "INSERT INTO users (email, role, display_name, added_by) VALUES (?, 'member', 'Test Member', 'test')"
    )
    .bind("member@example.com")
    .execute(&state.pool)
    .await
    .expect("insert failed");

    let cookie = session_cookie("member@example.com", "member");
    let res = srv
        .get("/api/permissions")
        .add_header(header::COOKIE, cookie)
        .await;
    assert_eq!(res.status_code(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn permissions_list_succeeds_for_global_admin() {
    let (srv, _) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");
    let res = srv
        .get("/api/permissions")
        .add_header(header::COOKIE, cookie)
        .await;
    assert_eq!(res.status_code(), StatusCode::OK);
    let perms: Vec<serde_json::Value> = res.json();
    assert!(!perms.is_empty(), "permission catalog should not be empty");
}

#[tokio::test]
async fn role_permissions_get_and_set_roundtrip() {
    let (srv, _) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");

    // GET current member permissions
    let get_res = srv
        .get("/api/roles/member/permissions")
        .add_header(header::COOKIE, cookie.clone())
        .await;
    assert_eq!(get_res.status_code(), StatusCode::OK);
    let before: serde_json::Value = get_res.json();
    let original_perms = before["permissions"].as_array().unwrap().clone();
    assert!(!original_perms.is_empty());

    // PUT a new (smaller) permission set
    let new_perms = vec!["nav.dashboard"];
    let put_res = srv
        .put("/api/roles/member/permissions")
        .add_header(header::COOKIE, cookie.clone())
        .json(&serde_json::json!({ "permissions": new_perms }))
        .await;
    assert_eq!(put_res.status_code(), StatusCode::OK);
    let after: serde_json::Value = put_res.json();
    let after_perms = after["permissions"].as_array().unwrap();
    assert_eq!(after_perms.len(), 1);
    assert_eq!(after_perms[0], "nav.dashboard");

    // Restore original
    srv.put("/api/roles/member/permissions")
        .add_header(header::COOKIE, cookie)
        .json(&serde_json::json!({ "permissions": original_perms }))
        .await;
}

// ── Backup permission tests ───────────────────────────────────────────────────

#[tokio::test]
async fn backup_create_requires_backups_create_permission() {
    let (srv, state) = server().await;

    // 'user' role does NOT have backups.create
    sqlx::query(
        "INSERT INTO users (email, role, display_name, added_by) VALUES (?, 'user', 'Test User', 'test')"
    )
    .bind("user@example.com")
    .execute(&state.pool)
    .await
    .expect("insert failed");

    let cookie = session_cookie("user@example.com", "user");
    let res = srv
        .post("/api/backups")
        .add_header(header::COOKIE, cookie)
        .await;
    // 403 Forbidden — lacks backups.create
    assert_eq!(res.status_code(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn backup_delete_requires_backups_delete_permission() {
    let (srv, state) = server().await;

    // Seed a 'user' who does not have backups.delete
    sqlx::query(
        "INSERT INTO users (email, role, display_name, added_by) VALUES (?, 'user', 'Test User', 'test')"
    )
    .bind("user2@example.com")
    .execute(&state.pool)
    .await
    .expect("insert failed");

    let cookie = session_cookie("user2@example.com", "user");
    let res = srv
        .delete("/api/backups/999")
        .add_header(header::COOKIE, cookie)
        .await;
    assert_eq!(res.status_code(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn backup_restore_requires_backups_restore_permission() {
    let (srv, state) = server().await;

    sqlx::query(
        "INSERT INTO users (email, role, display_name, added_by) VALUES (?, 'user', 'Test User', 'test')"
    )
    .bind("user3@example.com")
    .execute(&state.pool)
    .await
    .expect("insert failed");

    let cookie = session_cookie("user3@example.com", "user");
    let res = srv
        .post("/api/backups/999/restore")
        .add_header(header::COOKIE, cookie)
        .await;
    assert_eq!(res.status_code(), StatusCode::FORBIDDEN);
}

// ── Properties permission tests ───────────────────────────────────────────────

#[tokio::test]
async fn properties_get_requires_config_read_permission() {
    let (srv, state) = server().await;

    // Seed a visitor (only nav.dashboard + killswitch.view)
    sqlx::query(
        "INSERT INTO users (email, role, display_name, added_by) VALUES (?, 'visitor', 'Visitor', 'test')"
    )
    .bind("visitor@example.com")
    .execute(&state.pool)
    .await
    .expect("insert failed");

    let cookie = session_cookie("visitor@example.com", "visitor");
    let res = srv
        .get("/api/properties")
        .add_header(header::COOKIE, cookie)
        .await;
    assert_eq!(
        res.status_code(),
        StatusCode::FORBIDDEN,
        "visitor should not have config.read"
    );
}

#[tokio::test]
async fn properties_get_allowed_for_user_with_config_read() {
    // 'user' role has 'config.read' (seeded in migration 0004).
    // The actual SSH call to read server.properties will fail (no real VM),
    // so we only assert the *permission* check passes (status != 403).
    let (srv, state) = server().await;

    sqlx::query(
        "INSERT INTO users (email, role, display_name, added_by) VALUES (?, 'user', 'Test User', 'test')"
    )
    .bind("propuser@example.com")
    .execute(&state.pool)
    .await
    .expect("insert failed");

    let cookie = session_cookie("propuser@example.com", "user");
    let res = srv
        .get("/api/properties")
        .add_header(header::COOKIE, cookie)
        .await;
    // 403 = wrong user; 502 = SSH failed (expected, no real VM) — both are acceptable
    assert_ne!(
        res.status_code(),
        StatusCode::FORBIDDEN,
        "user role should pass config.read permission check"
    );
}

// ── Properties locked-key guard ───────────────────────────────────────────────

#[tokio::test]
async fn properties_put_locked_key_returns_403() {
    let (srv, _) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");

    // Attempting to set 'online-mode' (locked key) must be refused
    let res = srv
        .put("/api/properties")
        .add_header(header::COOKIE, cookie)
        .json(&serde_json::json!({ "online-mode": "false" }))
        .await;
    assert_eq!(res.status_code(), StatusCode::FORBIDDEN);
}

// ── Budget webhook tests ──────────────────────────────────────────────────────

#[tokio::test]
async fn budget_webhook_wrong_token_returns_401() {
    let (srv, _) = server().await;

    let payload = serde_json::json!({
        "message": { "data": null, "attributes": {} },
        "subscription": "test"
    });
    let res = srv
        .post("/internal/budget-alert?token=wrong_token")
        .json(&payload)
        .await;
    assert_eq!(res.status_code(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn budget_webhook_correct_token_no_data_returns_204() {
    let (srv, _) = server().await;

    let payload = serde_json::json!({
        "message": { "data": null, "attributes": {} },
        "subscription": "test"
    });
    let res = srv
        .post("/internal/budget-alert?token=test_budget_token")
        .json(&payload)
        .await;
    assert_eq!(res.status_code(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn budget_webhook_100pct_alert_engages_kill_switch() {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let (srv, state) = server().await;

    // Build a Pub/Sub message with a 100% alert
    let alert = serde_json::json!({
        "costAmount": 25.0,
        "budgetAmount": 25.0,
        "alertThresholdExceeded": 1.0
    });
    let b64 = STANDARD.encode(alert.to_string());
    let payload = serde_json::json!({
        "message": { "data": b64, "attributes": {} },
        "subscription": "test"
    });

    let res = srv
        .post("/internal/budget-alert?token=test_budget_token")
        .json(&payload)
        .await;
    assert_eq!(res.status_code(), StatusCode::NO_CONTENT);

    // Verify the kill-switch was engaged in the DB
    let ks = redstonecipher_server::db::kill_switch::status(&state.pool)
        .await
        .expect("status query failed");
    assert!(
        ks.is_engaged(),
        "kill-switch should be engaged after 100% budget alert"
    );
}

#[tokio::test]
async fn budget_webhook_50pct_alert_does_not_engage_kill_switch() {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let (srv, state) = server().await;

    let alert = serde_json::json!({
        "costAmount": 12.5,
        "budgetAmount": 25.0,
        "alertThresholdExceeded": 0.5
    });
    let b64 = STANDARD.encode(alert.to_string());
    let payload = serde_json::json!({
        "message": { "data": b64, "attributes": {} },
        "subscription": "test"
    });

    srv.post("/internal/budget-alert?token=test_budget_token")
        .json(&payload)
        .await;

    let ks = redstonecipher_server::db::kill_switch::status(&state.pool)
        .await
        .expect("status query failed");
    assert!(
        !ks.is_engaged(),
        "50% alert should NOT engage the kill-switch"
    );
}

// ── User management tests ─────────────────────────────────────────────────────

#[tokio::test]
async fn users_list_returns_seeded_global_admin() {
    let (srv, _) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");
    let res = srv
        .get("/api/users")
        .add_header(header::COOKIE, cookie)
        .await;
    assert_eq!(res.status_code(), StatusCode::OK);
    let users: Vec<serde_json::Value> = res.json();
    assert!(
        users.iter().any(|u| u["email"] == ADMIN_EMAIL),
        "seeded global admin should appear in user list"
    );
}

// ── Role management tests (migration 0006) ────────────────────────────────────────

#[tokio::test]
async fn roles_list_requires_roles_view() {
    let (srv, _) = server().await;
    // Visitor has no roles.view — expect 403
    let cookie = session_cookie("anon@example.com", "nonexistent_role");
    let res = srv
        .get("/api/roles")
        .add_header(header::COOKIE, cookie)
        .await;
    assert_eq!(res.status_code(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn roles_list_returns_system_roles() {
    let (srv, _) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");
    let res = srv
        .get("/api/roles")
        .add_header(header::COOKIE, cookie)
        .await;
    assert_eq!(res.status_code(), StatusCode::OK);
    let roles: Vec<serde_json::Value> = res.json();
    assert!(roles.iter().any(|r| r["name"] == "global_admin"));
    assert!(roles.iter().any(|r| r["name"] == "member"));
    // System roles must be flagged
    for r in &roles {
        assert_eq!(r["is_system"], true, "seeded roles must be system roles");
    }
}

#[tokio::test]
async fn create_custom_role_succeeds() {
    let (srv, _) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");

    let res = srv
        .post("/api/roles")
        .add_header(header::COOKIE, cookie.clone())
        .json(&serde_json::json!({
            "name": "developer",
            "label": "Developer",
            "description": "Engineering team",
            "color": "#A78BFA",
            "level": 2
        }))
        .await;
    assert_eq!(res.status_code(), StatusCode::CREATED);
    let role: serde_json::Value = res.json();
    assert_eq!(role["name"], "developer");
    assert_eq!(role["label"], "Developer");
    assert_eq!(role["is_system"], false);
    assert_eq!(role["level"], 2);

    // Verify it appears in the list
    let list_res = srv
        .get("/api/roles")
        .add_header(header::COOKIE, cookie)
        .await;
    let roles: Vec<serde_json::Value> = list_res.json();
    assert!(roles.iter().any(|r| r["name"] == "developer"));
}

#[tokio::test]
async fn create_role_invalid_name_rejected() {
    let (srv, _) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");

    for bad_name in &["Admin", "2cool", "has space", ""] {
        let res = srv
            .post("/api/roles")
            .add_header(header::COOKIE, cookie.clone())
            .json(&serde_json::json!({ "name": bad_name, "label": "X", "level": 1 }))
            .await;
        assert_eq!(
            res.status_code(),
            StatusCode::BAD_REQUEST,
            "name '{bad_name}' should be rejected"
        );
    }
}

#[tokio::test]
async fn create_role_reserved_name_rejected() {
    let (srv, _) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");
    let res = srv
        .post("/api/roles")
        .add_header(header::COOKIE, cookie)
        .json(&serde_json::json!({ "name": "admin", "label": "Admin", "level": 2 }))
        .await;
    assert_eq!(res.status_code(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_role_level_gate_prevents_escalation() {
    let (srv, _) = server().await;
    // global_admin has level 4; cannot create level 4 (must be strictly below)
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");
    let res = srv
        .post("/api/roles")
        .add_header(header::COOKIE, cookie)
        .json(&serde_json::json!({ "name": "superrole", "label": "Super", "level": 4 }))
        .await;
    assert_eq!(
        res.status_code(),
        StatusCode::FORBIDDEN,
        "cannot create role at own level"
    );
}

#[tokio::test]
async fn delete_system_role_rejected() {
    let (srv, _) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");
    let res = srv
        .delete("/api/roles/admin")
        .add_header(header::COOKIE, cookie)
        .await;
    assert_eq!(
        res.status_code(),
        StatusCode::FORBIDDEN,
        "system roles cannot be deleted"
    );
}

#[tokio::test]
async fn delete_role_with_users_rejected() {
    let (srv, state) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");

    // Create a custom role
    srv.post("/api/roles")
        .add_header(header::COOKIE, cookie.clone())
        .json(&serde_json::json!({ "name": "myteam", "label": "My Team", "level": 1 }))
        .await;

    // Assign a user to it
    sqlx::query(
        "INSERT INTO users (email, role, display_name, added_by) VALUES (?, 'myteam', 'U', 'test')",
    )
    .bind("user_on_myteam@example.com")
    .execute(&state.pool)
    .await
    .expect("insert failed");

    let res = srv
        .delete("/api/roles/myteam")
        .add_header(header::COOKIE, cookie)
        .await;
    assert_eq!(
        res.status_code(),
        StatusCode::CONFLICT,
        "role with users must not be deletable"
    );
}

#[tokio::test]
async fn delete_custom_role_empty_succeeds() {
    let (srv, _) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");

    // Create then delete a custom role
    srv.post("/api/roles")
        .add_header(header::COOKIE, cookie.clone())
        .json(&serde_json::json!({ "name": "tempteam", "label": "Temp", "level": 1 }))
        .await;

    let res = srv
        .delete("/api/roles/tempteam")
        .add_header(header::COOKIE, cookie.clone())
        .await;
    assert_eq!(res.status_code(), StatusCode::NO_CONTENT);

    // Verify gone from list
    let list: Vec<serde_json::Value> = srv
        .get("/api/roles")
        .add_header(header::COOKIE, cookie)
        .await
        .json();
    assert!(!list.iter().any(|r| r["name"] == "tempteam"));
}

#[tokio::test]
async fn update_role_label_and_color() {
    let (srv, _) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");

    srv.post("/api/roles")
        .add_header(header::COOKIE, cookie.clone())
        .json(&serde_json::json!({ "name": "editme", "label": "Old Label", "level": 1 }))
        .await;

    let res = srv
        .patch("/api/roles/editme")
        .add_header(header::COOKIE, cookie)
        .json(&serde_json::json!({ "label": "New Label", "color": "#FF6B6B" }))
        .await;
    assert_eq!(res.status_code(), StatusCode::OK);
    let updated: serde_json::Value = res.json();
    assert_eq!(updated["label"], "New Label");
    assert_eq!(updated["color"], "#FF6B6B");
}

#[tokio::test]
async fn system_role_level_immutable() {
    let (srv, _) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");
    // admin is a system role (level 3); trying to change its level must fail
    let res = srv
        .patch("/api/roles/admin")
        .add_header(header::COOKIE, cookie)
        .json(&serde_json::json!({ "level": 1 }))
        .await;
    assert_eq!(res.status_code(), StatusCode::FORBIDDEN);
}

// ── Per-user permission override tests ───────────────────────────────────────────

#[tokio::test]
async fn permission_override_roundtrip() {
    let (srv, state) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");

    // Seed a visitor user
    sqlx::query(
        "INSERT INTO users (email, role, display_name, added_by) VALUES (?, 'visitor', 'V', 'test')"
    )
    .bind("override_test@example.com")
    .execute(&state.pool)
    .await
    .expect("insert failed");

    // Initially no overrides
    let list_res = srv
        .get("/api/users/override_test@example.com/permission-overrides")
        .add_header(header::COOKIE, cookie.clone())
        .await;
    assert_eq!(list_res.status_code(), StatusCode::OK);
    let initial: Vec<serde_json::Value> = list_res.json();
    assert!(initial.is_empty());

    // Add an override
    let add_res = srv
        .post("/api/users/override_test@example.com/permission-overrides")
        .add_header(header::COOKIE, cookie.clone())
        .json(&serde_json::json!({ "permission_key": "server.kick" }))
        .await;
    assert_eq!(add_res.status_code(), StatusCode::CREATED);

    // Verify it appears
    let after: Vec<serde_json::Value> = srv
        .get("/api/users/override_test@example.com/permission-overrides")
        .add_header(header::COOKIE, cookie.clone())
        .await
        .json();
    assert_eq!(after.len(), 1);
    assert_eq!(after[0]["permission_key"], "server.kick");

    // Remove it
    let del_res = srv
        .delete("/api/users/override_test@example.com/permission-overrides/server.kick")
        .add_header(header::COOKIE, cookie.clone())
        .await;
    assert_eq!(del_res.status_code(), StatusCode::NO_CONTENT);

    // Verify gone
    let final_list: Vec<serde_json::Value> = srv
        .get("/api/users/override_test@example.com/permission-overrides")
        .add_header(header::COOKIE, cookie)
        .await
        .json();
    assert!(final_list.is_empty());
}

#[tokio::test]
async fn override_invalid_key_rejected() {
    let (srv, _) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");
    let res = srv
        .post(&format!("/api/users/{ADMIN_EMAIL}/permission-overrides"))
        .add_header(header::COOKIE, cookie)
        .json(&serde_json::json!({ "permission_key": "nonexistent.key.xyz" }))
        .await;
    assert_eq!(res.status_code(), StatusCode::BAD_REQUEST);
}

// ── Chat permission tests ────────────────────────────────────────────────────

#[tokio::test]
async fn chat_history_requires_chat_read() {
    let (srv, state) = server().await;
    // visitor has no chat.read
    sqlx::query(
        "INSERT INTO users (email, role, display_name, added_by) VALUES (?, 'visitor', 'V', 'test')"
    )
    .bind("chat_visitor@example.com")
    .execute(&state.pool)
    .await
    .expect("insert failed");

    let cookie = session_cookie("chat_visitor@example.com", "visitor");
    let res = srv
        .get("/api/chat/history")
        .add_header(header::COOKIE, cookie)
        .await;
    assert_eq!(res.status_code(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn chat_history_allowed_for_member() {
    let (srv, state) = server().await;
    sqlx::query(
        "INSERT INTO users (email, role, display_name, added_by) VALUES (?, 'member', 'M', 'test')"
    )
    .bind("chat_member@example.com")
    .execute(&state.pool)
    .await
    .expect("insert failed");

    let cookie = session_cookie("chat_member@example.com", "member");
    let res = srv
        .get("/api/chat/history")
        .add_header(header::COOKIE, cookie)
        .await;
    // Member has chat.read — should get 200 with empty array
    assert_eq!(res.status_code(), StatusCode::OK);
    let msgs: Vec<serde_json::Value> = res.json();
    assert!(msgs.is_empty(), "fresh DB should have no chat messages");
}

#[tokio::test]
async fn chat_send_requires_chat_send_permission() {
    let (srv, state) = server().await;
    // user role has no chat.send
    sqlx::query(
        "INSERT INTO users (email, role, display_name, added_by) VALUES (?, 'user', 'U', 'test')"
    )
    .bind("chat_user@example.com")
    .execute(&state.pool)
    .await
    .expect("insert failed");

    let cookie = session_cookie("chat_user@example.com", "user");
    let res = srv
        .post("/api/chat/send")
        .add_header(header::COOKIE, cookie)
        .json(&serde_json::json!({ "content": "hello", "target_ign": null }))
        .await;
    assert_eq!(res.status_code(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn chat_send_rejects_empty_content() {
    let (srv, _) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");
    let res = srv
        .post("/api/chat/send")
        .add_header(header::COOKIE, cookie)
        .json(&serde_json::json!({ "content": "   ", "target_ign": null }))
        .await;
    assert_eq!(res.status_code(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn chat_send_rejects_oversized_content() {
    let (srv, _) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");
    let long = "a".repeat(257);
    let res = srv
        .post("/api/chat/send")
        .add_header(header::COOKIE, cookie)
        .json(&serde_json::json!({ "content": long, "target_ign": null }))
        .await;
    assert_eq!(res.status_code(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn chat_send_broadcast_persists_message() {
    let (srv, state) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");

    // Send a broadcast (target_ign: null). The SSH FIFO will fail (no real VM)
    // but the message should still be persisted to the DB.
    srv.post("/api/chat/send")
        .add_header(header::COOKIE, cookie.clone())
        .json(&serde_json::json!({ "content": "hello world", "target_ign": null }))
        .await;

    // Confirm it appears in history
    let res = srv
        .get("/api/chat/history")
        .add_header(header::COOKIE, cookie)
        .await;
    assert_eq!(res.status_code(), StatusCode::OK);
    let msgs: Vec<serde_json::Value> = res.json();
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0]["content"], "hello world");
    assert_eq!(msgs[0]["source"], "web");
}

#[tokio::test]
async fn chat_dm_rejected_with_empty_target() {
    let (srv, _) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");
    // target_ign after sanitisation is empty — should be rejected
    let res = srv
        .post("/api/chat/send")
        .add_header(header::COOKIE, cookie)
        .json(&serde_json::json!({ "content": "hi", "target_ign": "!@#$" }))
        .await;
    assert_eq!(res.status_code(), StatusCode::BAD_REQUEST);
}

// ── Watchdog / player-joined endpoint tests ───────────────────────────────────

#[tokio::test]
async fn player_joined_rejects_missing_token() {
    let (srv, _) = server().await;
    // No Authorization header at all
    let res = srv
        .post("/internal/player-joined")
        .json(&serde_json::json!({ "ign": "TestPlayer" }))
        .await;
    assert_eq!(res.status_code(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn player_joined_rejects_wrong_token() {
    let (srv, _) = server().await;
    let res = srv
        .post("/internal/player-joined")
        .add_header(header::AUTHORIZATION, "Bearer wrong_token")
        .json(&serde_json::json!({ "ign": "TestPlayer" }))
        .await;
    // watchdog_token is None in test config, so any token (including wrong ones)
    // should be rejected — the handler returns 401 when token is empty or mismatch.
    assert_eq!(res.status_code(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn player_joined_rejects_empty_ign() {
    // Set up state with a real watchdog token so we can get past auth.
    let cfg = Config { watchdog_token: Some("test_watchdog_secret".into()), ..test_cfg() };
    let state = test_state_with_cfg(cfg).await;
    let app = test_router(state);
    let srv = axum_test::TestServer::new(app).unwrap();

    let res = srv
        .post("/internal/player-joined")
        .add_header(header::AUTHORIZATION, "Bearer test_watchdog_secret")
        .json(&serde_json::json!({ "ign": "   " }))
        .await;
    assert_eq!(res.status_code(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn player_joined_first_ever_returns_allow() {
    let cfg = Config { watchdog_token: Some("test_watchdog_secret".into()), ..test_cfg() };
    let state = test_state_with_cfg(cfg).await;
    let app = test_router(state);
    let srv = axum_test::TestServer::new(app).unwrap();

    let res = srv
        .post("/internal/player-joined")
        .add_header(header::AUTHORIZATION, "Bearer test_watchdog_secret")
        .json(&serde_json::json!({ "ign": "NewPlayer" }))
        .await;
    assert_eq!(res.status_code(), StatusCode::OK);
    let body: serde_json::Value = res.json();
    assert_eq!(body["action"], "allow", "first-ever join must be allowed");
}

#[tokio::test]
async fn player_joined_second_join_returns_kick() {
    let cfg = Config { watchdog_token: Some("test_watchdog_secret".into()), ..test_cfg() };
    let state = test_state_with_cfg(cfg).await;
    let app = test_router(state);
    let srv = axum_test::TestServer::new(app).unwrap();

    // First join — allow
    srv.post("/internal/player-joined")
        .add_header(header::AUTHORIZATION, "Bearer test_watchdog_secret")
        .json(&serde_json::json!({ "ign": "PendingPlayer" }))
        .await;

    // Second join — pending (not linked), must be kicked
    let res = srv
        .post("/internal/player-joined")
        .add_header(header::AUTHORIZATION, "Bearer test_watchdog_secret")
        .json(&serde_json::json!({ "ign": "PendingPlayer" }))
        .await;
    assert_eq!(res.status_code(), StatusCode::OK);
    let body: serde_json::Value = res.json();
    assert_eq!(body["action"], "kick", "unlinked returning player must be kicked");
}

#[tokio::test]
async fn player_joined_linked_player_always_allowed() {
    let cfg = Config { watchdog_token: Some("test_watchdog_secret".into()), ..test_cfg() };
    let state = test_state_with_cfg(cfg).await;
    // Seed the user (player_links has FK → users.email)
    sqlx::query(
        "INSERT INTO users (email, role, display_name, added_by) VALUES ('linked@example.com', 'member', 'Linked', 'test')"
    )
    .execute(&state.pool)
    .await
    .unwrap();
    // Pre-link the IGN
    sqlx::query(
        "INSERT INTO player_links (email, ign, linked_at) VALUES ('linked@example.com', 'LinkedPlayer', '2026-01-01T00:00:00Z')"
    )
    .execute(&state.pool)
    .await
    .unwrap();
    let app = test_router(state);
    let srv = axum_test::TestServer::new(app).unwrap();

    let res = srv
        .post("/internal/player-joined")
        .add_header(header::AUTHORIZATION, "Bearer test_watchdog_secret")
        .json(&serde_json::json!({ "ign": "LinkedPlayer" }))
        .await;
    assert_eq!(res.status_code(), StatusCode::OK);
    let body: serde_json::Value = res.json();
    assert_eq!(body["action"], "allow", "linked player must always be allowed");
}

// ── Whitelist delegation tests ─────────────────────────────────────────────────────

/// Verifies that the whitelist (invite) permission can be delegated:
/// an admin who holds `users.invite` can whitelist new users.
#[tokio::test]
async fn delegated_whitelist_invite_works() {
    let (srv, state) = server().await;

    // Seed an admin user (admin role has users.invite)
    sqlx::query(
        "INSERT INTO users (email, role, display_name, added_by) VALUES (?, 'admin', 'Admin User', 'test')"
    )
    .bind("admin_user@example.com")
    .execute(&state.pool)
    .await
    .expect("insert failed");

    let admin_cookie = session_cookie("admin_user@example.com", "admin");

    // Admin can invite a new user (whitelist them)
    let res = srv
        .post("/api/users")
        .add_header(header::COOKIE, admin_cookie.clone())
        .json(&serde_json::json!({
            "email": "newplayer@example.com",
            "role": "visitor"
        }))
        .await;
    assert_eq!(
        res.status_code(),
        StatusCode::CREATED,
        "admin should be able to whitelist users"
    );

    // But admin cannot invite to their own level or higher
    let escalation_res = srv
        .post("/api/users")
        .add_header(header::COOKIE, admin_cookie)
        .json(&serde_json::json!({
            "email": "tryescalate@example.com",
            "role": "admin"  // same level as actor — should be rejected
        }))
        .await;
    assert_eq!(
        escalation_res.status_code(),
        StatusCode::FORBIDDEN,
        "admin cannot invite to same or higher role"
    );
}

#[tokio::test]
async fn invite_to_nonexistent_role_rejected() {
    let (srv, _) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");
    let res = srv
        .post("/api/users")
        .add_header(header::COOKIE, cookie)
        .json(&serde_json::json!({
            "email": "test@example.com",
            "role": "ghost_role_that_does_not_exist"
        }))
        .await;
    assert_eq!(res.status_code(), StatusCode::BAD_REQUEST);
}

// ── Tailscale device-invite endpoint tests ───────────────────────────────────
//
// These are hermetic (no real Tailscale or Resend API calls).
// They validate:
//   1. Unauthenticated access is blocked (401).
//   2. A user without users.invite is forbidden (403).
//   3. Inviting a non-existent user returns 404.
//   4. With a user present but no API keys, the endpoint returns 200 with
//      warnings instead of crashing — confirming graceful degradation.

#[tokio::test]
async fn tailscale_invite_requires_authentication() {
    let (srv, _) = server().await;
    let res = srv
        .post("/api/users/someone@example.com/tailscale-invite")
        .await;
    assert_eq!(
        res.status_code(),
        StatusCode::UNAUTHORIZED,
        "endpoint must reject unauthenticated requests"
    );
}

#[tokio::test]
async fn tailscale_invite_requires_users_invite_permission() {
    let (srv, state) = server().await;

    // member role does NOT have users.invite
    sqlx::query(
        "INSERT INTO users (email, role, display_name, added_by) VALUES (?, 'member', 'M', 'test')"
    )
    .bind("ts_member@example.com")
    .execute(&state.pool)
    .await
    .expect("insert failed");

    let cookie = session_cookie("ts_member@example.com", "member");
    let res = srv
        .post("/api/users/someone@example.com/tailscale-invite")
        .add_header(header::COOKIE, cookie)
        .await;
    assert_eq!(
        res.status_code(),
        StatusCode::FORBIDDEN,
        "member role lacks users.invite and must be denied"
    );
}

#[tokio::test]
async fn tailscale_invite_returns_404_for_unknown_user() {
    let (srv, _) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");
    let res = srv
        .post("/api/users/ghost%40example.com/tailscale-invite")
        .add_header(header::COOKIE, cookie)
        .await;
    assert_eq!(
        res.status_code(),
        StatusCode::NOT_FOUND,
        "should 404 when the target user does not exist"
    );
}

#[tokio::test]
async fn tailscale_invite_degrades_gracefully_without_api_keys() {
    // Config has no TAILSCALE_API_KEY and no RESEND_API_KEY (the defaults).
    // The endpoint must return 200 with non-empty warnings rather than 5xx.
    let (srv, state) = server().await;
    let cookie = session_cookie(ADMIN_EMAIL, "global_admin");

    // Seed a user to invite
    sqlx::query(
        "INSERT INTO users (email, role, display_name, added_by) VALUES (?, 'member', 'Player One', 'test')"
    )
    .bind("player1@example.com")
    .execute(&state.pool)
    .await
    .expect("insert failed");

    let res = srv
        .post("/api/users/player1@example.com/tailscale-invite")
        .add_header(header::COOKIE, cookie)
        .await;

    // Must be 200 — not a crash
    assert_eq!(
        res.status_code(),
        StatusCode::OK,
        "should return 200 even when API keys are absent"
    );

    let body: serde_json::Value = res.json();

    // invite URL and email are absent because keys not configured
    assert!(
        body["tailscale_invite_url"].is_null(),
        "invite URL should be null when TAILSCALE_API_KEY is absent"
    );
    assert_eq!(
        body["email_sent"], false,
        "email_sent should be false when RESEND_API_KEY is absent"
    );

    // Both missing-key errors must be captured as warnings, not panics
    let warnings = body["warnings"].as_array().expect("warnings must be array");
    assert!(
        !warnings.is_empty(),
        "should warn about missing TAILSCALE_API_KEY"
    );
    assert!(
        warnings.iter().any(|w| w.as_str()
            .map(|s| s.contains("TAILSCALE_API_KEY"))
            .unwrap_or(false)
        ),
        "warnings must mention TAILSCALE_API_KEY"
    );

    // User fields should be present
    assert_eq!(body["user"]["email"], "player1@example.com");
    assert_eq!(body["user"]["display_name"], "Player One");
}

/// Migration 0006 grants `users.view` to all system roles (member, user, visitor)
/// so the Team page works for every authenticated user.  Members can READ the
/// user list but cannot INVITE or REMOVE users.
#[tokio::test]
async fn users_list_allowed_for_member() {
    let (srv, state) = server().await;

    sqlx::query(
        "INSERT INTO users (email, role, display_name, added_by) VALUES (?, 'member', 'M', 'test')",
    )
    .bind("member2@example.com")
    .execute(&state.pool)
    .await
    .expect("insert failed");

    let cookie = session_cookie("member2@example.com", "member");
    // Member now has users.view → should get 200
    let res = srv
        .get("/api/users")
        .add_header(header::COOKIE, cookie.clone())
        .await;
    assert_eq!(
        res.status_code(),
        StatusCode::OK,
        "member should be able to list users"
    );

    // But member cannot INVITE new users (lacks users.invite)
    let invite_res = srv
        .post("/api/users")
        .add_header(header::COOKIE, cookie)
        .json(&serde_json::json!({ "email": "new@example.com", "role": "visitor" }))
        .await;
    assert_eq!(
        invite_res.status_code(),
        StatusCode::FORBIDDEN,
        "member should NOT be able to invite users"
    );
}


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
const ADMIN_EMAIL: &str = "admin@example.com"; // seeded global_admin

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

    let cfg = Config {
        host: "127.0.0.1".into(),
        port: 8787,
        database_url: "sqlite::memory:".into(),
        jwt_secret: TEST_JWT_SECRET.into(),
        google_client_id: "test".into(),
        google_client_secret: "test".into(),
        redirect_uri: "https://example.com/auth/callback".into(),
        budget_webhook_token: Some("test_budget_token".into()),
        backup_dir: PathBuf::from("/tmp/test_backups"),
        gcloud_bin: PathBuf::from("/usr/bin/false"), // never actually invoked
        gcp_project: "test-project".into(),
        gcp_zone: "us-central1-a".into(),
        gcp_instance: "test-instance".into(),
        tailscale_ip: "100.0.0.1".into(),
    };

    AppState::new(pool, cfg)
}

/// Build a `TestServer` from a fresh in-memory state.
async fn server() -> (TestServer, AppState) {
    let state = test_state().await;
    let app = build_router(state.clone());
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
    assert!(body["disabled_at"].is_string(), "disabled_at should be set after engage");
    assert_eq!(body["reason"], "integration test");

    // Release
    let release_res = srv
        .delete("/api/kill-switch")
        .add_header(header::COOKIE, cookie.clone())
        .await;
    assert_eq!(release_res.status_code(), StatusCode::OK);
    let body: serde_json::Value = release_res.json();
    assert!(body["disabled_at"].is_null(), "disabled_at should be null after release");
}

// ── Kill-switch guard middleware tests ────────────────────────────────────────

#[tokio::test]
async fn kill_switch_guard_blocks_mutations_when_engaged() {
    let (srv, state) = server().await;

    // Engage the kill-switch directly via the DB layer
    redstonecipher_server::db::kill_switch::engage(
        &state.pool,
        "test guard",
        "test",
    )
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
    assert!(ks.is_engaged(), "kill-switch should be engaged after 100% budget alert");
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
    assert!(!ks.is_engaged(), "50% alert should NOT engage the kill-switch");
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

#[tokio::test]
async fn users_list_forbidden_for_member() {
    let (srv, state) = server().await;

    sqlx::query(
        "INSERT INTO users (email, role, display_name, added_by) VALUES (?, 'member', 'M', 'test')"
    )
    .bind("member2@example.com")
    .execute(&state.pool)
    .await
    .expect("insert failed");

    let cookie = session_cookie("member2@example.com", "member");
    let res = srv
        .get("/api/users")
        .add_header(header::COOKIE, cookie)
        .await;
    assert_eq!(res.status_code(), StatusCode::FORBIDDEN);
}

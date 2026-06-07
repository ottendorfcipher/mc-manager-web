/// Library crate root.
///
/// Splitting the crate into lib + bin lets integration tests in `tests/`
/// import the full module tree without any special hacks.
///
/// `main.rs` is kept as a thin shell that just calls `run()`.
pub mod auth;
pub mod config;
pub mod db;
pub mod discord;
pub mod error;
pub mod gcloud;
pub mod heartbeat;
pub mod handlers;
pub mod middleware;
pub mod minecraft;
pub mod notify;
pub mod state;
pub mod validation;

// Re-export for integration tests and main.rs
pub use db::settings;

pub use config::Config;
pub use state::AppState;

use axum::{
    extract::DefaultBodyLimit,
    routing::{delete, get, patch, post},
    Router,
};
use tower_governor::{
    governor::GovernorConfigBuilder,
    GovernorLayer,
};
use tower_http::{
    cors::CorsLayer,
    trace::{DefaultMakeSpan, DefaultOnFailure, DefaultOnRequest, DefaultOnResponse, TraceLayer},
};
use tracing::Level;

pub fn build_router(state: AppState) -> Router {
    // Prime the process start clock for the /health uptime field.
    handlers::health::init();

    // Rate limiting: 60 requests per minute per IP for the general API,
    // burst up to 20.  This is intentionally permissive for a private server
    // (all users are trusted staff) — the goal is bot/scanner prevention
    // rather than strict throttling.
    let governor_conf = std::sync::Arc::new(
        GovernorConfigBuilder::default()
            .per_second(1)        // refill 1 token/second
            .burst_size(60)       // max burst: 60 requests
            .use_headers()        // return Retry-After + X-RateLimit-* headers
            .finish()
            .unwrap(),
    );

    // Tighter per-endpoint limiter for the most abuse-sensitive routes (raw
    // console execution, large OGG uploads). Applied IN ADDITION to the global
    // limiter, so both must allow the request.
    let sensitive_governor = std::sync::Arc::new(
        GovernorConfigBuilder::default()
            .per_second(2)
            .burst_size(15)
            .use_headers()
            .finish()
            .unwrap(),
    );

    let api = Router::new()
        // Auth
        .route("/me", get(handlers::auth::me))
        // Users
        .route(
            "/users",
            get(handlers::users::list).post(handlers::users::invite),
        )
        .route(
            "/users/:email",
            patch(handlers::users::update).delete(handlers::users::remove),
        )
        .route(
            "/users/:email/players",
            get(handlers::users::list_players).put(handlers::users::replace_players),
        )
        .route(
            "/users/:email/players/:ign",
            delete(handlers::users::unlink_player),
        )
        .route(
            "/users/:email/players/:ign/gamemode",
            patch(handlers::users::set_player_gamemode),
        )
        // Per-user permission overrides
        .route(
            "/users/:email/permission-overrides",
            get(handlers::roles::list_overrides).post(handlers::roles::add_override),
        )
        .route(
            "/users/:email/permission-overrides/:key",
            delete(handlers::roles::remove_override),
        )
        // Roles catalog (dynamic role management)
        .route(
            "/roles",
            get(handlers::roles::list).post(handlers::roles::create),
        )
        .route(
            "/roles/:role",
            get(handlers::roles::get)
                .patch(handlers::roles::update)
                .delete(handlers::roles::delete),
        )
        .route(
            "/roles/:role/permissions",
            get(handlers::roles::get_permissions).put(handlers::roles::set_permissions),
        )
        // Server
        .route("/server/status", get(handlers::server::status))
        .route("/server/vm/:action", post(handlers::server::vm_action))
        .route(
            "/server/service/:action",
            post(handlers::server::service_action),
        )
        .route(
            "/console",
            post(handlers::server::send_console)
                .layer(GovernorLayer { config: sensitive_governor.clone() }),
        )
        // Granular Minecraft server commands
        .route("/server/whitelist", get(handlers::server::list_whitelist))
        .route(
            "/server/whitelist/:action",
            post(handlers::server::whitelist_action),
        )
        .route("/server/op/:action", post(handlers::server::op_action))
        .route("/server/kick", post(handlers::server::kick_player))
        .route("/server/ban/:action", post(handlers::server::ban_action))
        .route("/server/announce", post(handlers::server::announce))
        .route("/server/save", post(handlers::server::save_world))
        // World settings
        .route("/world/gamerules", get(handlers::server::get_gamerules))
        .route(
            "/world/gamerule/:rule",
            post(handlers::server::set_gamerule),
        )
        .route("/world/time", post(handlers::server::set_time))
        .route("/world/weather", post(handlers::server::set_weather))
        // Global search (Cmd+K palette)
        .route("/search", get(handlers::search::search))
        // Live data
        .route("/metrics", get(handlers::metrics::snapshot))
        .route("/mc/players", get(handlers::mc_players::list))
        // Tailscale: per-user device list, drives the dashboard
        // "your device isn't on the VPN" banner.
        .route("/tailscale/my-devices", get(handlers::tailscale::my_devices))
        // server.properties
        .route(
            "/properties",
            get(handlers::properties::get_all).put(handlers::properties::update),
        )
        // Backups
        .route(
            "/backups",
            get(handlers::backups::list).post(handlers::backups::create),
        )
        .route(
            "/backups/:id",
            get(handlers::backups::download).delete(handlers::backups::delete),
        )
        .route("/backups/:id/restore", post(handlers::backups::restore))
        // Kill-switch
        .route(
            "/kill-switch",
            get(handlers::kill_switch::get)
                .post(handlers::kill_switch::engage)
                .delete(handlers::kill_switch::release),
        )
        // Pending Minecraft players (admission queue)
        .route("/players/pending", get(handlers::pending_players::list))
        .route(
            "/players/pending/:ign/approve",
            post(handlers::pending_players::approve),
        )
        .route(
            "/players/pending/:ign",
            delete(handlers::pending_players::reject),
        )
        // Rejected players (blocklist)
        .route(
            "/players/rejected",
            get(handlers::pending_players::list_rejected),
        )
        .route(
            "/players/rejected/:ign/reinstate",
            post(handlers::pending_players::reinstate),
        )
        .route(
            "/players/rejected/:ign/approve",
            post(handlers::pending_players::approve),
        )
        // Player snapshots (inventory + location)
        .route("/players/snapshots", get(handlers::player_data::list))
        .route("/players/locations", get(handlers::player_data::locations))
        .route(
            "/players/snapshots/refresh",
            post(handlers::player_data::refresh),
        )
        .route("/players/snapshots/:ign", get(handlers::player_data::get))
        // Give items to a player
        .route("/players/:ign/give", post(handlers::give_item::give))
        // Player stats (MC statistics JSON)
        .route("/players/:ign/stats", get(handlers::player_stats::get))
        // Map pins
        .route(
            "/map/pins",
            get(handlers::map_pins::list).post(handlers::map_pins::create),
        )
        .route(
            "/map/pins/:id",
            patch(handlers::map_pins::update).delete(handlers::map_pins::delete),
        )
        .route(
            "/map/settings",
            get(handlers::bluemap_settings::get).put(handlers::bluemap_settings::update),
        )
        // Permission catalog (read-only; editing is via /roles/:role/permissions)
        .route("/permissions", get(handlers::permissions::list))
        // Chat
        .route("/chat/history", get(handlers::chat::history))
        .route("/chat/stream",  get(handlers::chat::stream))
        .route("/chat/send",    post(handlers::chat::send))
        // Music queue
        .route("/music/tracks",      get(handlers::music::list_tracks))
        .route("/music/tracks/:id",  delete(handlers::music::remove_custom_track)
                                     .put(handlers::music::update_custom_track))
        .route("/music/tracks/:id/preview",
                                     get(handlers::music::preview_track))
        .route("/music/tracks",      post(handlers::music::add_custom_track))
        .route("/music/tracks/:id/image",
                                     post(handlers::music::upload_track_image)
                                     .delete(handlers::music::delete_track_image))
                                     // Per-track artwork can be up to 2 MB (validated in
                                     // the handler) — raise body limit accordingly.
                                     .layer(axum::extract::DefaultBodyLimit::max(8 * 1024 * 1024))
        // OGG upload — bumped body limit to 512 MiB so multi-track sets and
        // long uploads aren't rejected by Axum's 2 MiB default.
        .route(
            "/music/upload",
            post(handlers::music::upload_oggs).layer(
                tower::ServiceBuilder::new()
                    .layer(GovernorLayer { config: sensitive_governor.clone() })
                    .layer(axum::extract::DefaultBodyLimit::max(512 * 1024 * 1024)),
            ),
        )
        // Music zones — region-triggered per-player playback
        .route("/music/zones",      get(handlers::music_zones::list)
                                    .post(handlers::music_zones::create))
        .route("/music/zones/:id",  axum::routing::patch(handlers::music_zones::update)
                                    .delete(handlers::music_zones::delete))
        .route("/music/zones/:id/clear-cooldown", post(handlers::music_zones::clear_cooldown))
        // Scrolling credits — reusable cinematic text sequences for zones
        .route("/credits",             get(handlers::credits::list)
                                       .post(handlers::credits::create))
        .route("/credits/:id",         patch(handlers::credits::update)
                                       .delete(handlers::credits::delete))
        .route("/credits/:id/preview", post(handlers::credits::preview))
        .route("/music/state",       get(handlers::music::get_state))
        .route("/music/stream",      get(handlers::music::stream))
        .route("/music/queue",       post(handlers::music::enqueue))
        .route("/music/queue/:id",   delete(handlers::music::remove_from_queue))
        .route("/music/skip",        post(handlers::music::skip))
        .route("/music/stop",        post(handlers::music::stop))
        .route("/music/resource-pack",
            get(handlers::music::get_resource_pack)
                .post(handlers::music::upload_resource_pack)
                .delete(handlers::music::delete_resource_pack)
        )
        .route("/music/resource-pack/sounds", get(handlers::music::get_pack_sounds))
        .route(
            "/players/:ign/coord-display",
            get(handlers::coord_display::get).post(handlers::coord_display::set),
        )
        .route(
            "/players/:ign/pin-hud",
            get(handlers::pin_hud::get).put(handlers::pin_hud::set),
        )
        // Player aliases (in-game display names)
        .route(
            "/players/aliases",
            get(handlers::player_alias::list_all),
        )
        .route(
            "/players/:ign/alias",
            get(handlers::player_alias::get)
                .put(handlers::player_alias::set_alias)
                .delete(handlers::player_alias::delete_alias),
        )
        // Worlds
        .route(
            "/worlds",
            get(handlers::worlds::list).post(handlers::worlds::create),
        )
        .route("/worlds/:id", delete(handlers::worlds::delete))
        .route("/worlds/:id/activate", post(handlers::worlds::activate))
        .route(
            "/worlds/:id/members",
            get(handlers::worlds::list_members).put(handlers::worlds::set_members),
        )
        .route(
            "/worlds/:id/backups",
            get(handlers::worlds::list_backups).post(handlers::worlds::create_backup),
        )
        .route(
            "/worlds/:id/backups/:backup_id",
            get(handlers::worlds::download_backup),
        )
        // Onboarding
        .route("/onboarding/invite", post(handlers::onboarding::invite))
        // Tailscale invite for existing users
        .route(
            "/users/:email/tailscale-invite",
            post(handlers::onboarding::tailscale_invite_existing),
        )
        // Audit log
        .route("/admin/audit-log", get(handlers::audit_log::list_global))
        .route("/admin/audit-log/export", get(handlers::audit_log::export_csv))
        .route("/me/audit-log",    get(handlers::audit_log::list_own))
        // Admin impersonation — view the portal as another user
        .route(
            "/admin/impersonation/validate",
            get(handlers::impersonation::validate),
        )
        // Discord integration settings (global_admin only)
        .route(
            "/admin/discord-settings",
            get(handlers::discord_settings::get).put(handlers::discord_settings::put),
        )
        // Modrinth integration — optional PAT for higher rate limits
        .route(
            "/admin/modrinth-settings",
            get(handlers::modrinth_settings::get)
                .put(handlers::modrinth_settings::put)
                .delete(handlers::modrinth_settings::delete),
        )
        // Events — Countdowns
        .route(
            "/events/countdowns",
            get(handlers::events::list).post(handlers::events::create),
        )
        .route("/events/summary",               get(handlers::events::summary))
        .route("/events/countdowns/state",      get(handlers::events::get_state))
        .route("/events/countdowns/stream",      get(handlers::events::stream))
        .route("/events/countdowns/:id/start",   post(handlers::events::start))
        .route("/events/countdowns/:id/pause",   post(handlers::events::pause))
        .route("/events/countdowns/:id/resume",  post(handlers::events::resume))
        .route("/events/countdowns/:id/cancel",  post(handlers::events::cancel))
        .route("/events/countdowns/:id",         delete(handlers::events::delete))
        // Events — Rising Oceans
        .route("/events/rising-oceans/state",      get(handlers::rising_oceans::get_state))
        .route("/events/rising-oceans/stream",     get(handlers::rising_oceans::stream))
        .route("/events/rising-oceans",            post(handlers::rising_oceans::create))
        .route("/events/rising-oceans/:id/start",  post(handlers::rising_oceans::start))
        .route("/events/rising-oceans/:id/pause",  post(handlers::rising_oceans::pause))
        .route("/events/rising-oceans/:id/resume", post(handlers::rising_oceans::resume))
        .route("/events/rising-oceans/:id/cancel", post(handlers::rising_oceans::cancel))
        .route("/events/rising-oceans/:id/revert", post(handlers::rising_oceans::revert))
        .route("/events/rising-oceans/:id/keep",   post(handlers::rising_oceans::keep))
        .route("/events/rising-oceans/:id",        delete(handlers::rising_oceans::delete))
        // Events — Bounty Boards
        .route("/events/bounty-board/state",       get(handlers::bounty_board::get_state))
        .route("/events/bounty-board/stream",      get(handlers::bounty_board::stream))
        .route("/events/bounty-board",             post(handlers::bounty_board::create))
        .route("/events/bounty-board/:id/start",   post(handlers::bounty_board::start))
        .route("/events/bounty-board/:id/pause",   post(handlers::bounty_board::pause))
        .route("/events/bounty-board/:id/resume",  post(handlers::bounty_board::resume))
        .route("/events/bounty-board/:id/finish",  post(handlers::bounty_board::finish))
        .route("/events/bounty-board/:id/cancel",  post(handlers::bounty_board::cancel))
        .route("/events/bounty-board/:id",         delete(handlers::bounty_board::delete))
        // Events — Pre-game Lobbies
        .route(
            "/events/lobbies",
            get(handlers::lobbies::list).post(handlers::lobbies::create),
        )
        .route("/events/lobbies/:id",         delete(handlers::lobbies::delete))
        .route("/events/lobbies/:id/join",    post(handlers::lobbies::join))
        .route("/events/lobbies/:id/leave",   post(handlers::lobbies::leave))
        .route("/events/lobbies/:id/launch",  post(handlers::lobbies::launch))
        .route("/events/lobbies/:id/close",   post(handlers::lobbies::close))
        // Parties (cross-app: targeting countdowns, music zones, lobbies, …)
        .route("/parties",
               get(handlers::parties::list).post(handlers::parties::create))
        .route("/parties/:id",
               patch(handlers::parties::update).delete(handlers::parties::delete))
        .route("/parties/:id/members",
               post(handlers::parties::add_member))
        .route("/parties/:id/members/:ign",
               delete(handlers::parties::remove_member))
        // Scheduled jobs (cron-style automations)
        .route("/scheduled-jobs",
               get(handlers::scheduled_jobs::list).post(handlers::scheduled_jobs::create))
        .route("/scheduled-jobs/:id",
               patch(handlers::scheduled_jobs::update).delete(handlers::scheduled_jobs::delete))
        .route("/scheduled-jobs/:id/run",
               post(handlers::scheduled_jobs::run_now))
        // Plugin system
        .route("/plugins/browse",           get(handlers::plugins::browse::browse))
        .route("/plugins/detail/:key",      get(handlers::plugins::detail::detail))
        .route("/plugins/preview/:key",     get(handlers::plugins::preview::preview))
        .route("/plugins/install",          post(handlers::plugins::install::install))
        .route("/plugins/installed",        get(handlers::plugins::installed::list))
        .route("/plugins/missing-deps",     get(handlers::plugins::missing_deps::list))
        .route("/plugins/installed/:filename", delete(handlers::plugins::installed::remove))
        .route("/plugins/jobs",             get(handlers::plugins::jobs::list_jobs))
        .route("/plugins/jobs/:id",         get(handlers::plugins::jobs::get_job))
        .route("/plugins/update/:filename", post(handlers::plugins::update::update_plugin))
        .route("/plugins/update-all",       post(handlers::plugins::update::update_all))
        .route("/plugins/upload",
               post(handlers::plugins::upload::upload)
                   .layer(DefaultBodyLimit::max(64 * 1024 * 1024)))
        .route("/plugins/undo-last",        post(handlers::plugins::undo::undo_last))
        .route("/plugins/restart",          post(handlers::plugins::restart::restart_for_plugins));

    let api = api.layer(axum::middleware::from_fn_with_state(
        state.clone(),
        crate::middleware::kill_switch_guard,
    ));

    Router::new()
        .route("/auth/login", get(handlers::auth::login))
        .route("/auth/callback", get(handlers::auth::callback))
        .route("/auth/logout", get(handlers::auth::logout))
        .route("/internal/budget-alert", post(handlers::budget::webhook))
        .route(
            "/internal/player-joined",
            post(handlers::pending_players::player_joined),
        )
        .nest("/api", api)
        // Elevate the request span to INFO so that when on_failure fires at ERROR
        // level, the parent span's fields (method, uri, status) are included in
        // the log line.  Default is TRACE, which the `info` filter drops —
        // leaving 502 errors with no URI context.
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().level(Level::INFO))
                .on_request(DefaultOnRequest::new().level(Level::DEBUG))
                .on_response(DefaultOnResponse::new().level(Level::DEBUG))
                .on_failure(DefaultOnFailure::new().level(Level::ERROR)),
        )
        // CORS — only the production origin and localhost dev server may call the API.
        // `allow_credentials(true)` is required for the session cookie to be sent
        // cross-origin (e.g. Vite dev proxy on a different port).  With credentials
        // enabled, `allow_origin(Any)` is forbidden by the CORS spec — we must
        // enumerate origins explicitly.
        .layer(
            CorsLayer::new()
                .allow_origin([
                    "https://example.com".parse().unwrap(),
                    "https://www.example.com".parse().unwrap(),
                    // Local dev — Vite proxy; never reaches production
                    "https://localhost:5173".parse().unwrap(),
                    "http://localhost:5173".parse().unwrap(),
                ])
                .allow_headers([
                    axum::http::header::CONTENT_TYPE,
                    axum::http::header::AUTHORIZATION,
                    axum::http::header::ACCEPT,
                    axum::http::header::COOKIE,
                ])
                .allow_methods([
                    axum::http::Method::GET,
                    axum::http::Method::POST,
                    axum::http::Method::PUT,
                    axum::http::Method::PATCH,
                    axum::http::Method::DELETE,
                    axum::http::Method::OPTIONS,
                ])
                .allow_credentials(true),
        )
        .layer(axum::middleware::from_fn(
            crate::middleware::tailscale_guard,
        ))
        // Security headers on every response (CSP, HSTS, X-Frame-Options, etc.)
        .layer(axum::middleware::from_fn(
            crate::middleware::security_headers,
        ))
        // Rate limiting: per-IP, 60 req/min burst, 1 req/s refill.
        .layer(GovernorLayer { config: governor_conf })
        // Health/readiness probes — registered AFTER the layers above so they
        // skip auth, CORS, rate limiting and the Tailscale guard.  This keeps
        // them reachable for the deploy script's local `curl /health` and for
        // uptime monitoring regardless of VPN state or throttling.
        .route("/health", get(handlers::health::health))
        .route("/ready", get(handlers::health::ready))
        .route("/metrics", get(handlers::observability::metrics))
        .with_state(state)
}

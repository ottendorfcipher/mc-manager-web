//! Audit log endpoints.
//!
//! GET /api/admin/audit-log          — filtered/paginated entries (admin only)
//! GET /api/admin/audit-log/export   — CSV export of the filtered set (admin)
//! GET /api/me/audit-log             — last 100 entries for the calling user

use axum::{
    extract::{Query, State},
    http::header,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;

use crate::{
    auth::middleware::AuthUser,
    db::audit::{self, AuditFilter},
    error::Result,
    state::AppState,
};

const AUDIT_PERM: &str = "users.permission_overrides.edit";

#[derive(Deserialize)]
pub struct AuditParams {
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
    pub action: Option<String>,
    pub actor:  Option<String>,
    pub target: Option<String>,
    pub from:   Option<String>,
    pub to:     Option<String>,
}
fn default_limit() -> i64 { 200 }

impl AuditParams {
    fn into_filter(self, max_limit: i64) -> AuditFilter {
        AuditFilter {
            action: self.action,
            actor:  self.actor,
            target: self.target,
            from:   self.from,
            to:     self.to,
            limit:  self.limit.clamp(1, max_limit),
            offset: self.offset.max(0),
        }
    }
}

/// GET /api/admin/audit-log  — admin only, filtered + paginated.
pub async fn list_global(
    State(state): State<AppState>,
    actor: AuthUser,
    Query(params): Query<AuditParams>,
) -> Result<Json<Vec<audit::AuditEntry>>> {
    crate::auth::middleware::require_perm(&actor, AUDIT_PERM)?;
    let filter = params.into_filter(500);
    Ok(Json(audit::list_filtered(&state.pool, &filter).await?))
}

/// GET /api/admin/audit-log/export  — admin only, CSV of the filtered set.
pub async fn export_csv(
    State(state): State<AppState>,
    actor: AuthUser,
    Query(params): Query<AuditParams>,
) -> Result<impl IntoResponse> {
    crate::auth::middleware::require_perm(&actor, AUDIT_PERM)?;
    // Allow a much larger cap for exports than the interactive list.
    let filter = params.into_filter(50_000);
    let entries = audit::list_filtered(&state.pool, &filter).await?;

    let mut csv = String::from("id,created_at,actor,action,target,detail\n");
    for e in &entries {
        csv.push_str(&format!(
            "{},{},{},{},{},{}\n",
            e.id,
            csv_field(&e.created_at),
            csv_field(&e.actor),
            csv_field(&e.action),
            csv_field(e.target.as_deref().unwrap_or("")),
            csv_field(e.detail.as_deref().unwrap_or("")),
        ));
    }

    Ok((
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"audit-log.csv\"",
            ),
        ],
        csv,
    ))
}

/// RFC-4180 CSV field quoting: always quote, double any embedded quotes.
fn csv_field(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

/// GET /api/me/audit-log  — any authenticated user, own entries only.
pub async fn list_own(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<Json<Vec<audit::AuditEntry>>> {
    Ok(Json(audit::list_by_actor(&state.pool, &actor.email, 100).await?))
}

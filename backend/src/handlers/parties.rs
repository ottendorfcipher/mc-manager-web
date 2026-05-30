//! Party CRUD + member management.
//!
//! Authorization model:
//!   • Anyone authenticated can list parties they own OR are a member of
//!     (via player_links).
//!   • Owner of a party can create/edit/delete it + manage members.
//!   • A user with `players.view_any` can manage any party (admin override).

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;

use crate::{
    auth::middleware::AuthUser,
    db::parties,
    error::{AppError, Result},
    state::AppState,
};

#[derive(serde::Serialize)]
pub struct PartyWithMembers {
    #[serde(flatten)]
    pub party:   parties::Party,
    pub members: Vec<parties::PartyMember>,
}

// ── GET /api/parties ──────────────────────────────────────────────────────────

pub async fn list(
    State(state): State<AppState>,
    actor:        AuthUser,
) -> Result<Json<Vec<PartyWithMembers>>> {
    // Admins see everything; everyone else sees only theirs (owned or member-of).
    let rows = if actor.has("players.view_any") {
        parties::list_all(&state.pool).await?
    } else {
        parties::list_for_user(&state.pool, &actor.email).await?
    };

    let mut out = Vec::with_capacity(rows.len());
    for party in rows {
        let members = parties::list_members(&state.pool, party.id).await?;
        out.push(PartyWithMembers { party, members });
    }
    Ok(Json(out))
}

// ── POST /api/parties ─────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateBody {
    pub name:        String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default = "default_color")]
    pub color:       String,
    #[serde(default)]
    pub members:     Option<Vec<String>>,
}
fn default_color() -> String { "aqua".into() }

pub async fn create(
    State(state): State<AppState>,
    actor:        AuthUser,
    Json(body):   Json<CreateBody>,
) -> Result<(StatusCode, Json<parties::Party>)> {
    let name = body.name.trim();
    if name.is_empty() || name.len() > 40 {
        return Err(AppError::BadRequest("Name must be 1–40 characters".into()));
    }

    let party = parties::create(
        &state.pool,
        name,
        body.description.as_deref(),
        &actor.email,
        &body.color,
    ).await?;

    if let Some(members) = body.members {
        for ign in members {
            let ign = ign.trim();
            if !ign.is_empty() {
                let _ = parties::add_member(&state.pool, party.id, ign).await;
            }
        }
    }

    Ok((StatusCode::CREATED, Json(party)))
}

// ── PATCH /api/parties/:id ────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct UpdateBody {
    pub name:        String,
    #[serde(default)]
    pub description: Option<String>,
    pub color:       String,
}

async fn check_owner(state: &AppState, actor: &AuthUser, id: i64) -> Result<parties::Party> {
    let p = parties::get(&state.pool, id).await?
        .ok_or_else(|| AppError::NotFound(format!("Party {id} not found")))?;
    if actor.has("players.view_any") || p.owner_email.eq_ignore_ascii_case(&actor.email) {
        Ok(p)
    } else {
        Err(AppError::Forbidden(format!(
            "Only the owner ({}) can manage this party", p.owner_email,
        )))
    }
}

pub async fn update(
    State(state): State<AppState>,
    actor:        AuthUser,
    Path(id):     Path<i64>,
    Json(body):   Json<UpdateBody>,
) -> Result<StatusCode> {
    let _ = check_owner(&state, &actor, id).await?;
    let name = body.name.trim();
    if name.is_empty() || name.len() > 40 {
        return Err(AppError::BadRequest("Name must be 1–40 characters".into()));
    }
    parties::update(&state.pool, id, name, body.description.as_deref(), &body.color).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ── DELETE /api/parties/:id ───────────────────────────────────────────────────

pub async fn delete(
    State(state): State<AppState>,
    actor:        AuthUser,
    Path(id):     Path<i64>,
) -> Result<StatusCode> {
    let _ = check_owner(&state, &actor, id).await?;
    parties::delete(&state.pool, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ── POST /api/parties/:id/members ─────────────────────────────────────────────

#[derive(Deserialize)]
pub struct AddMemberBody {
    pub ign: String,
}

pub async fn add_member(
    State(state): State<AppState>,
    actor:        AuthUser,
    Path(id):     Path<i64>,
    Json(body):   Json<AddMemberBody>,
) -> Result<StatusCode> {
    let _ = check_owner(&state, &actor, id).await?;
    let ign = body.ign.trim();
    if ign.is_empty() {
        return Err(AppError::BadRequest("ign is required".into()));
    }
    parties::add_member(&state.pool, id, ign).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ── DELETE /api/parties/:id/members/:ign ──────────────────────────────────────

pub async fn remove_member(
    State(state): State<AppState>,
    actor:        AuthUser,
    Path((id, ign)): Path<(i64, String)>,
) -> Result<StatusCode> {
    let _ = check_owner(&state, &actor, id).await?;
    parties::remove_member(&state.pool, id, &ign).await?;
    Ok(StatusCode::NO_CONTENT)
}

use axum::{http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::json;
use thiserror::Error;

/// One error type for the entire application.
/// Each variant maps to an HTTP status and a human-readable message.
#[derive(Debug, Error)]
pub enum AppError {
    #[error("Not authenticated")]
    Unauthenticated,

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Conflict: {0}")]
    Conflict(String),

    #[error("Database error")]
    Database(#[from] sqlx::Error),

    #[error("External command failed: {0}")]
    ExternalCommand(String),

    #[error("IO error")]
    Io(#[from] std::io::Error),

    #[error("Internal error")]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AppError::Unauthenticated       => (StatusCode::UNAUTHORIZED,   self.to_string()),
            AppError::Forbidden(_)          => (StatusCode::FORBIDDEN,      self.to_string()),
            AppError::NotFound(_)           => (StatusCode::NOT_FOUND,      self.to_string()),
            AppError::BadRequest(_)         => (StatusCode::BAD_REQUEST,    self.to_string()),
            AppError::Conflict(_)           => (StatusCode::CONFLICT,       self.to_string()),
            AppError::Database(e)           => {
                tracing::error!(error = %e, "Database error");
                (StatusCode::INTERNAL_SERVER_ERROR, "Database error".into())
            }
            AppError::ExternalCommand(msg)  => (StatusCode::BAD_GATEWAY,    msg.clone()),
            AppError::Io(e)                 => {
                tracing::error!(error = %e, "IO error");
                (StatusCode::INTERNAL_SERVER_ERROR, "IO error".into())
            }
            AppError::Internal(e)           => {
                tracing::error!(error = %e, "Internal error");
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error".into())
            }
        };

        (status, Json(json!({ "error": message }))).into_response()
    }
}

pub type Result<T> = std::result::Result<T, AppError>;

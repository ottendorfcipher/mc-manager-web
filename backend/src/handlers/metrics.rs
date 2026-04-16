use axum::{extract::State, response::Sse};
use axum::response::sse::{Event, KeepAlive};
use tokio_stream::StreamExt as _;
use tokio_stream::wrappers::IntervalStream;
use std::time::Duration;

use crate::{auth::middleware::AuthUser, error::Result, gcloud::ssh, state::AppState};

/// GET /api/metrics  — SSE stream, one snapshot every 30 s
pub async fn stream(
    State(state): State<AppState>,
    _: AuthUser,
) -> Sse<impl tokio_stream::Stream<Item = std::result::Result<Event, std::convert::Infallible>>> {
    let interval = tokio::time::interval(Duration::from_secs(30));
    let stream = IntervalStream::new(interval).then(move |_| {
        let cfg = state.config.clone();
        async move {
            let data = match ssh::fetch_metrics(&cfg).await {
                Ok(m)  => serde_json::to_string(&m).unwrap_or_default(),
                Err(_) => r#"{"error":"unreachable"}"#.into(),
            };
            Ok::<_, std::convert::Infallible>(Event::default().data(data))
        }
    });

    Sse::new(stream).keep_alive(KeepAlive::default())
}

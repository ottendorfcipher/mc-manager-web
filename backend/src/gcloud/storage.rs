use std::{path::Path, time::Duration};
use tokio::process::Command;
use tokio::time::timeout;

use crate::{config::Config, error::{AppError, Result}};

const UPLOAD_TIMEOUT: Duration = Duration::from_secs(300);

/// Upload a local file to a GCS bucket.
/// Returns the `gs://` URI of the uploaded object.
///
/// Requires `GCS_BACKUP_BUCKET` to be set in the config.  If the bucket is
/// not configured the function returns an error immediately.
/// Upload a backup archive to GCS.
/// `extended` selects the 1-year retention prefix (`backups/extended/`)
/// instead of the default 30-day prefix (`backups/regular/`).
pub async fn upload_backup(cfg: &Config, local_path: &Path, extended: bool) -> Result<String> {
    let bucket = cfg.gcs_backup_bucket.as_deref().ok_or_else(|| {
        AppError::Internal(anyhow::anyhow!(
            "GCS_BACKUP_BUCKET is not configured — cannot upload to cloud"
        ))
    })?;

    let filename = local_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::BadRequest("Invalid backup file path".into()))?;

    // Use separate prefixes so GCS lifecycle rules can apply different
    // retention periods: backups/regular/ (30 days) vs backups/extended/ (365 days).
    let prefix = if extended { "backups/extended" } else { "backups/regular" };
    let gcs_uri = format!("gs://{bucket}/{prefix}/{filename}");

    let fut = Command::new(&cfg.gcloud_bin)
        .args([
            "storage",
            "cp",
            local_path.to_str().unwrap_or(""),
            &gcs_uri,
        ])
        .output();

    let output = timeout(UPLOAD_TIMEOUT, fut)
        .await
        .map_err(|_| AppError::ExternalCommand("GCS upload timed out".into()))?
        .map_err(|e| AppError::ExternalCommand(e.to_string()))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::ExternalCommand(format!("GCS upload failed: {err}")));
    }

    Ok(gcs_uri)
}

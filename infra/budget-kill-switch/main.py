"""Cloud Function that scales the redstonecipher-web Cloud Run service to zero
when a Cloud Billing budget alert reports >= 100% of the configured amount.

Trigger: CloudEvent from Pub/Sub topic ``redstonecipher-budget-alerts``
(the same topic the in-app /internal/budget-alert webhook consumes).
This function is a hard backstop: even if the application is broken and
cannot engage its own kill-switch, this function still scales the service
to zero so it stops accruing compute cost.

Payload shape (per Cloud Billing budgets-programmatic-notifications docs):
    {
      "budgetDisplayName": "...",
      "costAmount": 12.34,
      "budgetAmount": 12.0,
      "alertThresholdExceeded": 1.0,
      "currencyCode": "USD",
      ...
    }
"""
from __future__ import annotations

import base64
import json
import logging
import os
from typing import Any

import functions_framework
from google.cloud import run_v2
from google.protobuf import field_mask_pb2

LOG = logging.getLogger("budget_kill_switch")
LOG.setLevel(logging.INFO)

# Configured via env vars on the function at deploy time
PROJECT_ID = os.environ["PROJECT_ID"]
REGION = os.environ.get("REGION", "us-central1")
SERVICE_NAME = os.environ.get("SERVICE_NAME", "redstonecipher-web")

# Fire the kill switch when cost / budget >= this ratio.
# 1.0 = at 100% only.  0.9 = preemptive at 90%.
KILL_AT_RATIO = float(os.environ.get("KILL_AT_RATIO", "1.0"))


@functions_framework.cloud_event
def handle_budget_alert(event) -> None:  # noqa: ANN001
    """Entry point invoked for every message on the budget Pub/Sub topic."""

    data_b64 = event.data.get("message", {}).get("data")
    if not data_b64:
        LOG.info("No data field on Pub/Sub message; ignoring.")
        return

    try:
        alert: dict[str, Any] = json.loads(base64.b64decode(data_b64))
    except (ValueError, json.JSONDecodeError) as exc:
        LOG.warning("Could not decode budget alert payload: %s", exc)
        return

    cost = float(alert.get("costAmount", 0.0))
    budget = float(alert.get("budgetAmount", 0.0))
    threshold = alert.get("alertThresholdExceeded")
    ratio = cost / budget if budget > 0 else 0.0

    LOG.info(
        "Budget alert: cost=%.2f budget=%.2f ratio=%.2f threshold=%s",
        cost, budget, ratio, threshold,
    )

    # Informational thresholds (e.g. 50%, 83%) are just logged.
    exceeded = (
        (threshold is not None and float(threshold) >= KILL_AT_RATIO)
        or ratio >= KILL_AT_RATIO
    )
    if not exceeded:
        return

    LOG.warning(
        "Budget at %.0f%% of $%.2f — scaling %s to zero",
        ratio * 100, budget, SERVICE_NAME,
    )
    _scale_to_zero()


def _scale_to_zero() -> None:
    """Set the Cloud Run service’s revision template to min=0 / max=0.

    This keeps ``scalingMode=AUTOMATIC`` (important — MANUAL mode is
    extremely sticky and can only be undone via the REST API).  With
    ``maxInstanceCount=0`` in AUTOMATIC mode, the autoscaler cannot spin up
    a new instance, so the container stops and the service returns 503.

    We use a ``FieldMask`` so only the template-level scaling fields are
    touched.  This avoids needing ``artifactregistry.reader`` (the API
    would otherwise re-validate the container image reference).

    We do NOT call ``op.result()`` — that requires ``run.operations.get``,
    which our narrowly-scoped SA doesn't need.  Fire-and-forget is fine.
    """
    client = run_v2.ServicesClient()
    name = f"projects/{PROJECT_ID}/locations/{REGION}/services/{SERVICE_NAME}"

    service = run_v2.Service(name=name)
    service.template.scaling.min_instance_count = 0
    service.template.scaling.max_instance_count = 0

    update_mask = field_mask_pb2.FieldMask(paths=[
        "template.scaling.min_instance_count",
        "template.scaling.max_instance_count",
    ])

    client.update_service(
        request=run_v2.UpdateServiceRequest(
            service=service,
            update_mask=update_mask,
        )
    )
    LOG.warning("Scaled %s to zero (template min=0 max=0, mode stays AUTOMATIC)", SERVICE_NAME)

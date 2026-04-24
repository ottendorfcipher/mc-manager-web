#!/usr/bin/env bash
# infra/setup.sh — Idempotent bootstrap for redstoneCipher on Cloud Run + Firebase
#
# What this script does (all steps are safe to re-run):
#   1.  Create new GCP project  redstonecipher-web
#   2.  Link a billing account
#   3.  Enable all required APIs
#   4.  Create Artifact Registry repository
#   5.  Create a GCS bucket for Litestream (SQLite) + backups
#   6.  Create a least-privilege service account
#   7.  Grant the SA permissions within the new project
#   8.  Grant the SA cross-project permissions on minecraft-493201
#          • compute.instanceAdmin.v1  (start/stop/reset/describe the MC VM)
#          • iap.tunnelResourceAccessor (SSH over Cloud IAP)
#          • compute.osLogin           (OS-Login SSH key injection)
#   9.  Store secrets in Secret Manager (prompts interactively if not pre-set)
#  10.  Grant Cloud Run SA access to the secrets
#  11.  Build & push the initial Docker image via Cloud Build
#  12.  Deploy the Cloud Run service
#  13.  Add Firebase to the project and deploy Hosting config
#  14.  Set up Pub/Sub topic + push subscription → budget webhook
#  15.  Create an $8/month Cloud Billing budget with a 100% alert
#
# Prerequisites:
#   - gcloud CLI authenticated with an account that has Owner/Editor on the
#     billing account and can create new projects
#   - firebase CLI installed  (npm install -g firebase-tools)
#   - docker CLI installed (only needed for a local build; Cloud Build is used
#     by default)
#   - git repo already pushed to a remote (for the Cloud Build trigger)
#
# Required env vars (the script will prompt for any that are missing):
#   BILLING_ACCOUNT         e.g.  012345-ABCDEF-GHIJKL
#   JWT_SECRET              openssl rand -hex 32
#   GOOGLE_CLIENT_ID        OAuth 2.0 client ID for the new project
#   GOOGLE_CLIENT_SECRET    OAuth 2.0 client secret
#   BUDGET_WEBHOOK_TOKEN    openssl rand -hex 32
#
# Optional overrides:
#   NEW_PROJECT   (default: redstonecipher-web)
#   REGION        (default: us-central1)
#   MC_PROJECT    (default: minecraft-493201)
#   MC_ZONE       (default: us-central1-a)
#   MC_INSTANCE   (default: mc-server-spot)
#   TS_HOSTNAME   (default: redstonecipher-web)
#
# Tailscale — the portal is only accessible within your Tailscale network:
#   TS_AUTHKEY   — generate at https://login.tailscale.com/admin/settings/keys
#                  Options: Reusable ✓  Ephemeral ✓  (desc: redstonecipher-web)
#   TS_TAILNET   — your tailnet domain, e.g. tail1234.ts.net
#                  (run `tailscale status` on any enrolled device to find it)

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
NEW_PROJECT="${NEW_PROJECT:-redstonecipher-web}"
REGION="${REGION:-us-central1}"
MC_PROJECT="${MC_PROJECT:-minecraft-493201}"
MC_ZONE="${MC_ZONE:-us-central1-a}"
MC_INSTANCE="${MC_INSTANCE:-mc-server-spot}"
SERVICE_NAME="redstonecipher-web"
SA_NAME="redstonecipher-sa"
SA_EMAIL="${SA_NAME}@${NEW_PROJECT}.iam.gserviceaccount.com"
REPO_NAME="app"
BUCKET="${NEW_PROJECT}-data"
AR_IMAGE="${REGION}-docker.pkg.dev/${NEW_PROJECT}/${REPO_NAME}/${SERVICE_NAME}"
FIREBASE_URL="https://${NEW_PROJECT}.web.app"

TOPIC="redstonecipher-budget-alerts"
SUB="redstonecipher-budget-push"
BUDGET_NAME="redstonecipher-8usd-monthly"
BUDGET_AMOUNT_USD=8

say()  { printf "\n\033[1;34m==> %s\033[0m\n" "$*"; }
ok()   { printf "    \033[0;32m✓ %s\033[0m\n" "$*"; }
warn() { printf "    \033[0;33m⚠ %s\033[0m\n" "$*"; }

prompt_secret() {
    local var="$1" label="$2"
    if [[ -z "${!var:-}" ]]; then
        read -rsp "  Enter ${label}: " val
        echo
        export "${var}=${val}"
    fi
}

# ── 0. Collect secrets interactively if not pre-set ──────────────────────────
say "Collecting secrets"
: "${BILLING_ACCOUNT:?BILLING_ACCOUNT env var is required (run: gcloud billing accounts list)}"
prompt_secret JWT_SECRET           "JWT_SECRET (openssl rand -hex 32)"
prompt_secret GOOGLE_CLIENT_ID     "Google OAuth Client ID"
prompt_secret GOOGLE_CLIENT_SECRET "Google OAuth Client Secret"
prompt_secret BUDGET_WEBHOOK_TOKEN "Budget webhook token (openssl rand -hex 32)"
prompt_secret TS_AUTHKEY           "Tailscale auth key (reusable+ephemeral, from admin console)"
: "${TS_TAILNET:?TS_TAILNET is required (e.g. tail1234.ts.net). Run: tailscale status}"

# ── 1. Create project ─────────────────────────────────────────────────────────
say "Creating project ${NEW_PROJECT}"
if gcloud projects describe "${NEW_PROJECT}" >/dev/null 2>&1; then
    ok "Project already exists"
else
    gcloud projects create "${NEW_PROJECT}" \
        --name="redstoneCipher Web" \
        --labels=app=redstonecipher
    ok "Project created"
fi
gcloud config set project "${NEW_PROJECT}"

# ── 2. Link billing ───────────────────────────────────────────────────────────
say "Linking billing account"
gcloud billing projects link "${NEW_PROJECT}" \
    --billing-account="${BILLING_ACCOUNT}"
ok "Billing linked"

# ── 3. Enable APIs ────────────────────────────────────────────────────────────
say "Enabling APIs (this can take ~2 minutes)"
gcloud services enable \
    run.googleapis.com \
    artifactregistry.googleapis.com \
    cloudbuild.googleapis.com \
    secretmanager.googleapis.com \
    storage.googleapis.com \
    pubsub.googleapis.com \
    billingbudgets.googleapis.com \
    iap.googleapis.com \
    firebase.googleapis.com \
    firebasehosting.googleapis.com \
    iam.googleapis.com \
    cloudresourcemanager.googleapis.com \
    --project="${NEW_PROJECT}"
ok "APIs enabled"

# ── 4. Artifact Registry repository ──────────────────────────────────────────
say "Creating Artifact Registry repo '${REPO_NAME}'"
if gcloud artifacts repositories describe "${REPO_NAME}" \
       --location="${REGION}" --project="${NEW_PROJECT}" >/dev/null 2>&1; then
    ok "Repo already exists"
else
    gcloud artifacts repositories create "${REPO_NAME}" \
        --repository-format=docker \
        --location="${REGION}" \
        --description="redstoneCipher Docker images" \
        --project="${NEW_PROJECT}"
    ok "Repo created"
fi

# Allow Cloud Build to push images
gcloud artifacts repositories add-iam-policy-binding "${REPO_NAME}" \
    --location="${REGION}" \
    --project="${NEW_PROJECT}" \
    --member="serviceAccount:$(gcloud projects describe "${NEW_PROJECT}" \
        --format='value(projectNumber)')@cloudbuild.gserviceaccount.com" \
    --role="roles/artifactregistry.writer" >/dev/null

# ── 5. GCS bucket for Litestream + backups ────────────────────────────────────
say "Creating GCS bucket gs://${BUCKET}"
if gsutil ls -b "gs://${BUCKET}" >/dev/null 2>&1; then
    ok "Bucket already exists"
else
    gcloud storage buckets create "gs://${BUCKET}" \
        --location="${REGION}" \
        --uniform-bucket-level-access \
        --project="${NEW_PROJECT}"
    ok "Bucket created"
fi

# ── 6. Service account ────────────────────────────────────────────────────────
say "Creating service account ${SA_NAME}"
if gcloud iam service-accounts describe "${SA_EMAIL}" \
       --project="${NEW_PROJECT}" >/dev/null 2>&1; then
    ok "SA already exists"
else
    gcloud iam service-accounts create "${SA_NAME}" \
        --display-name="redstoneCipher Cloud Run SA" \
        --project="${NEW_PROJECT}"
    ok "SA created"
    # GCP directory propagation delay — wait until the SA is queryable
    for i in $(seq 1 12); do
        gcloud iam service-accounts describe "${SA_EMAIL}" \
            --project="${NEW_PROJECT}" >/dev/null 2>&1 && break
        echo "    Waiting for SA propagation... (${i}/12)"
        sleep 5
    done
fi

# ── 7. Grant SA permissions in new project ────────────────────────────────────
say "Granting SA permissions in ${NEW_PROJECT}"

# Read secrets at runtime
gcloud projects add-iam-policy-binding "${NEW_PROJECT}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" >/dev/null

# Write/read GCS bucket (Litestream + backups)
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/storage.objectAdmin" >/dev/null

# Allow Cloud Run to use this SA
gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
    --project="${NEW_PROJECT}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/iam.serviceAccountUser" >/dev/null

ok "New-project permissions granted"

# ── 8. Cross-project IAM on minecraft-493201 ──────────────────────────────────
say "Granting cross-project permissions on ${MC_PROJECT}"

for ROLE in \
    "roles/compute.instanceAdmin.v1" \
    "roles/iap.tunnelResourceAccessor" \
    "roles/compute.osLogin"; do
    gcloud projects add-iam-policy-binding "${MC_PROJECT}" \
        --member="serviceAccount:${SA_EMAIL}" \
        --role="${ROLE}" >/dev/null
    ok "  ${ROLE}"
done

# ── 9. Store secrets in Secret Manager ────────────────────────────────────────
say "Storing secrets in Secret Manager"

store_secret() {
    local name="$1" value="$2"
    if gcloud secrets describe "${name}" --project="${NEW_PROJECT}" >/dev/null 2>&1; then
        echo -n "${value}" | gcloud secrets versions add "${name}" \
            --data-file=- --project="${NEW_PROJECT}" >/dev/null
        ok "  ${name} — version added"
    else
        echo -n "${value}" | gcloud secrets create "${name}" \
            --data-file=- \
            --replication-policy=user-managed \
            --locations="${REGION}" \
            --project="${NEW_PROJECT}" >/dev/null
        ok "  ${name} — created"
    fi
}

store_secret "jwt_secret"             "${JWT_SECRET}"
store_secret "google_client_id"       "${GOOGLE_CLIENT_ID}"
store_secret "google_client_secret"   "${GOOGLE_CLIENT_SECRET}"
store_secret "budget_webhook_token"   "${BUDGET_WEBHOOK_TOKEN}"
store_secret "ts_authkey"             "${TS_AUTHKEY}"

# ── 10. Grant Cloud Run SA access to secrets ──────────────────────────────────
say "Granting SA secret access"
for SECRET in jwt_secret google_client_id google_client_secret budget_webhook_token ts_authkey; do
    gcloud secrets add-iam-policy-binding "${SECRET}" \
        --project="${NEW_PROJECT}" \
        --member="serviceAccount:${SA_EMAIL}" \
        --role="roles/secretmanager.secretAccessor" >/dev/null
    ok "  ${SECRET}"
done

# ── 11. Initial Docker build & push via Cloud Build ───────────────────────────
say "Running initial Cloud Build (this will take ~10–15 min for the Rust compile)"
warn "Subsequent builds use layer cache and will be faster."

# Point Cloud Build's SA at the new SA for the deploy step
PROJECT_NUMBER=$(gcloud projects describe "${NEW_PROJECT}" --format='value(projectNumber)')
CB_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

# Cloud Build SA needs to deploy Cloud Run and act as the runtime SA
for ROLE in \
    "roles/run.admin" \
    "roles/iam.serviceAccountUser" \
    "roles/artifactregistry.writer"; do
    gcloud projects add-iam-policy-binding "${NEW_PROJECT}" \
        --member="serviceAccount:${CB_SA}" \
        --role="${ROLE}" >/dev/null
done

# Trigger a build from the current directory.
# _DEPLOY_TAG defaults to 'latest' in cloudbuild.yaml.
gcloud builds submit . \
    --config=cloudbuild.yaml \
    --project="${NEW_PROJECT}"

ok "Image built and pushed"

# ── 12. Deploy Cloud Run (first time; subsequent deploys via Cloud Build) ──────
say "Deploying Cloud Run service '${SERVICE_NAME}'"
gcloud run deploy "${SERVICE_NAME}" \
    --image="${AR_IMAGE}:latest" \
    --region="${REGION}" \
    --platform=managed \
    --service-account="${SA_EMAIL}" \
    --min-instances=1 \
    --max-instances=2 \
    --memory=512Mi \
    --cpu=1 \
    --timeout=300 \
    --concurrency=80 \
    --port=8080 \
    --allow-unauthenticated \
    --set-env-vars="HOST=0.0.0.0,DATABASE_URL=sqlite:///data/mc-manager.db,BACKUP_DIR=/data/backups,GCLOUD_BIN=/usr/bin/gcloud,CLOUDSDK_CONFIG=/tmp/gcloud-config,GCP_PROJECT=${MC_PROJECT},GCP_ZONE=${MC_ZONE},GCP_INSTANCE=${MC_INSTANCE},LITESTREAM_GCS_BUCKET=${BUCKET},TAILSCALE_IP=100.80.114.91,TS_HOSTNAME=redstonecipher-web,TS_TAILNET=${TS_TAILNET},REDIRECT_URI=https://redstonecipher-web.${TS_TAILNET}/auth/callback" \
    --set-secrets="JWT_SECRET=jwt_secret:latest,GOOGLE_CLIENT_ID=google_client_id:latest,GOOGLE_CLIENT_SECRET=google_client_secret:latest,BUDGET_WEBHOOK_TOKEN=budget_webhook_token:latest,TS_AUTHKEY=ts_authkey:latest" \
    --project="${NEW_PROJECT}"

CLOUD_RUN_URL=$(gcloud run services describe "${SERVICE_NAME}" \
    --region="${REGION}" \
    --project="${NEW_PROJECT}" \
    --format='value(status.url)')
ok "Cloud Run deployed at ${CLOUD_RUN_URL}"

# ── 13. Firebase Hosting ──────────────────────────────────────────────────────
say "Initializing Firebase Hosting"

# Add Firebase to the GCP project (idempotent)
firebase projects:addfirebase "${NEW_PROJECT}" 2>/dev/null || true

# Substitute the private network URL into the splash page.
# The placeholder __TS_APP_URL__ is replaced at deploy time so the target
# URL is baked in but not committed to version control.
# We work on a temp copy so the repo stays clean.
TS_APP_URL="https://redstonecipher-web.${TS_TAILNET}/"
TMP_INDEX="$(mktemp)"
sed "s|__TS_APP_URL__|${TS_APP_URL}|g" public/index.html > "${TMP_INDEX}"
cp "${TMP_INDEX}" public/index.html
rm -f "${TMP_INDEX}"

firebase use "${NEW_PROJECT}"
firebase deploy --only hosting --project="${NEW_PROJECT}"

# Restore the placeholder so the repo stays clean after running the script.
sed -i.bak "s|${TS_APP_URL}|__TS_APP_URL__|g" public/index.html
rm -f public/index.html.bak

ok "Firebase Hosting deployed"
warn "redstonecipher.com custom domain — complete these steps in the Firebase Console:"
warn "  Firebase Console → Hosting → Add custom domain → redstonecipher.com"
warn "  Add the two DNS TXT/A records Firebase shows you at your DNS registrar."
warn "  Firebase will provision a free TLS cert automatically."
warn "  Public visitors see the 'secure private network' page."
warn "  Tailscale members are silently redirected to the private portal."

# ── 14. Pub/Sub topic + push subscription ─────────────────────────────────────
say "Setting up Pub/Sub for budget alerts"

gcloud services enable pubsub.googleapis.com --project="${NEW_PROJECT}"

if gcloud pubsub topics describe "${TOPIC}" --project="${NEW_PROJECT}" >/dev/null 2>&1; then
    ok "Topic already exists"
else
    gcloud pubsub topics create "${TOPIC}" --project="${NEW_PROJECT}"
    ok "Topic created"
fi

PUSH_ENDPOINT="${CLOUD_RUN_URL}/internal/budget-alert?token=${BUDGET_WEBHOOK_TOKEN}"
if gcloud pubsub subscriptions describe "${SUB}" --project="${NEW_PROJECT}" >/dev/null 2>&1; then
    gcloud pubsub subscriptions update "${SUB}" \
        --push-endpoint="${PUSH_ENDPOINT}" \
        --project="${NEW_PROJECT}"
    ok "Subscription updated"
else
    gcloud pubsub subscriptions create "${SUB}" \
        --topic="${TOPIC}" \
        --push-endpoint="${PUSH_ENDPOINT}" \
        --ack-deadline=30 \
        --project="${NEW_PROJECT}"
    ok "Subscription created"
fi

# ── 15. Cloud Billing budget at $8 ────────────────────────────────────────────
say "Creating \$${BUDGET_AMOUNT_USD}/month budget"

EXISTING_BUDGET="$(gcloud billing budgets list \
    --billing-account="${BILLING_ACCOUNT}" \
    --filter="displayName=${BUDGET_NAME}" \
    --format='value(name)' | head -n1 || true)"

BUDGET_ARGS=(
    --billing-account="${BILLING_ACCOUNT}"
    --display-name="${BUDGET_NAME}"
    --budget-amount="${BUDGET_AMOUNT_USD}USD"
    # 50 % ($4) — informational
    --threshold-rule=percent=0.5
    # 100 % ($8) — triggers kill-switch via Pub/Sub push to the app webhook
    --threshold-rule=percent=1.0
    --notifications-rule-pubsub-topic="projects/${NEW_PROJECT}/topics/${TOPIC}"
    # Scope to the new project only
    --filter-projects="projects/${NEW_PROJECT}"
)

if [[ -n "${EXISTING_BUDGET}" ]]; then
    gcloud billing budgets update "${EXISTING_BUDGET}" "${BUDGET_ARGS[@]}"
    ok "Budget updated"
else
    gcloud billing budgets create "${BUDGET_ARGS[@]}"
    ok "Budget created"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
say "Setup complete"
cat <<EOF

  Project:         ${NEW_PROJECT}
  Cloud Run URL:   ${CLOUD_RUN_URL}
  Firebase URL:    ${FIREBASE_URL}
  GCS bucket:      gs://${BUCKET}
  Service acct:    ${SA_EMAIL}

  Budget:          \$${BUDGET_AMOUNT_USD}/month (100% threshold → kill-switch via Pub/Sub)
  Topic:           projects/${NEW_PROJECT}/topics/${TOPIC}
  Push endpoint:   ${PUSH_ENDPOINT}

  Access (Tailscale required):
    https://redstonecipher-web.${TS_TAILNET}/

  Next steps:
    1. Add the following redirect URI to your Google OAuth credentials:
         https://redstonecipher-web.${TS_TAILNET}/auth/callback
       (console.cloud.google.com → APIs & Services → Credentials → OAuth 2.0 client)

    2. Set up redstonecipher.com as the public domain:
       a) Firebase Console → Hosting → Add custom domain → redstonecipher.com
       b) Add the DNS records Firebase provides to your registrar.
       c) Firebase provisions TLS automatically (free).
       Visitors on the public internet get the private-network page.
       Visitors on Tailscale are silently redirected to the portal.

    3. Connect your device to Tailscale and open:
         https://redstonecipher-web.${TS_TAILNET}/
       (or https://redstonecipher.com once step 2 is complete and Tailscale is active)
       The Minecraft server is on Tailscale at 100.80.114.91 — same requirement.

    3. Connect a Cloud Build trigger to your Git repo for automatic deploys:
         gcloud builds triggers create github \\
           --repo-name=mc-manager-web \\
           --repo-owner=<YOUR_GITHUB_USER> \\
           --branch-pattern='^main$' \\
           --build-config=cloudbuild.yaml \\
           --project=${NEW_PROJECT}

    4. Smoke-test the budget kill-switch:
         gcloud pubsub topics publish ${TOPIC} \\
           --project=${NEW_PROJECT} \\
           --message '\$(echo -n "{\"costAmount\":9,\"budgetAmount\":8,\"alertThresholdExceeded\":1.0}" | base64)'

    5. Verify Tailscale gate (should return 403):
         curl -H 'X-Forwarded-For: 1.2.3.4' ${CLOUD_RUN_URL}/
EOF

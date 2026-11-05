#!/usr/bin/env bash
# Creates everything AutoDocs needs in a Google Cloud project, or checks it's there. Safe to run
# again at any time: each step skips what already exists. Reads deploy/target.env and writes back
# the values the GitHub deploy workflow needs. Never prints a secret.
#
# Exit codes: 0 done · 75 come back later (the database is still being created, or the OpenAI key
# hasn't been added yet; the message says which) · anything else is an error to fix.
set -euo pipefail
cd "$(dirname "$0")/../.."
. deploy/gcp/lib.sh
load_target

say "Checking tools and access"
need gcloud "Install the Google Cloud CLI: https://cloud.google.com/sdk/docs/install (on a Mac: brew install --cask google-cloud-sdk)."
need openssl ""
need git ""
ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -1)
[ -n "$ACCOUNT" ] || die "gcloud isn't signed in. Run: gcloud auth login"
ok "Signed in as $ACCOUNT"
PROJECT_NUMBER=$(g projects describe "$GCP_PROJECT" --format='value(projectNumber)' 2>/dev/null) ||
  die "Can't open project $GCP_PROJECT. Create it with: gcloud projects create $GCP_PROJECT   (or fix GCP_PROJECT in $TARGET)"
g services enable cloudbilling.googleapis.com serviceusage.googleapis.com >/dev/null
[ "$(g billing projects describe "$GCP_PROJECT" --format='value(billingEnabled)' 2>/dev/null)" = "True" ] ||
  die "Billing isn't on for $GCP_PROJECT. List accounts with: gcloud billing accounts list   then link one: gcloud billing projects link $GCP_PROJECT --billing-account=ACCOUNT_ID"
ok "Project $GCP_PROJECT ($PROJECT_NUMBER), billing on"

need gh "Install the GitHub CLI (on a Mac: brew install gh), then run: gh auth login"
GITHUB_REPO=${GITHUB_REPO:-$(git remote get-url origin | sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##')}
[[ "$GITHUB_REPO" == */* ]] || die "Couldn't tell which GitHub repository this is. Set GITHUB_REPO=owner/name in $TARGET."
# GitHub's numeric id never changes, so renaming or moving the repository doesn't break deploys.
if ! read -r GITHUB_REPO GITHUB_REPO_ID < <(gh api "repos/$GITHUB_REPO" --jq '"\(.full_name) \(.id)"' 2>/dev/null); then
  die "Couldn't open github.com/$GITHUB_REPO with the GitHub CLI. Run gh auth login, and check you've accepted the invitation to the repository."
fi
ok "Deploys will come from github.com/$GITHUB_REPO (id $GITHUB_REPO_ID, branch main)"

say "Turning on the Google Cloud services AutoDocs uses"
g services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com \
  iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com cloudresourcemanager.googleapis.com \
  storage.googleapis.com compute.googleapis.com certificatemanager.googleapis.com monitoring.googleapis.com \
  logging.googleapis.com billingbudgets.googleapis.com >/dev/null
ok "Services on"

say "Database (Cloud SQL for PostgreSQL 17)"
SQL_STATE=$(g sql instances describe "$SQL_INSTANCE" --format='value(state)' 2>/dev/null || true)
if [ -z "$SQL_STATE" ]; then
  g sql instances create "$SQL_INSTANCE" --database-version=POSTGRES_17 --edition=enterprise --tier="$DB_TIER" \
    --region="$GCP_REGION" --availability-type=zonal --storage-auto-increase --backup-start-time=08:00 \
    --enable-point-in-time-recovery --retained-backups-count=14 --deletion-protection --async --format=none
  SQL_STATE=PENDING_CREATE
  note "Started creating $SQL_INSTANCE ($DB_TIER). This takes 5 to 15 minutes; the steps below continue meanwhile."
else
  ok "$SQL_INSTANCE exists ($SQL_STATE)"
fi

say "Image storage (Artifact Registry)"
if ! g artifacts repositories describe "$IMAGES" --location="$GCP_REGION" >/dev/null 2>&1; then
  g artifacts repositories create "$IMAGES" --repository-format=docker --location="$GCP_REGION" --description="AutoDocs app images" --format=none
fi
POLICY=$(mktemp)
cat >"$POLICY" <<'JSON'
[
  { "name": "keep-recent", "action": { "type": "Keep" }, "mostRecentVersions": { "keepCount": 15 } },
  { "name": "delete-old", "action": { "type": "Delete" }, "condition": { "tagState": "any", "olderThan": "30d" } }
]
JSON
g artifacts repositories set-cleanup-policies "$IMAGES" --location="$GCP_REGION" --policy="$POLICY" --format=none
rm -f "$POLICY"
ok "$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/$IMAGES (keeps the 15 newest images, so rollbacks stay possible)"

say "File storage for screenshots and images (Cloud Storage)"
if ! g storage buckets describe "gs://$BUCKET" >/dev/null 2>&1; then
  g storage buckets create "gs://$BUCKET" --location="$GCP_REGION" --uniform-bucket-level-access --public-access-prevention --format=none
fi
LIFECYCLE=$(mktemp)
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"isLive":false,"daysSinceNoncurrentTime":30}}]}' >"$LIFECYCLE"
g storage buckets update "gs://$BUCKET" --versioning --lifecycle-file="$LIFECYCLE" --format=none
rm -f "$LIFECYCLE"
ok "gs://$BUCKET (private; deleted or replaced files can be recovered for 30 days)"

say "Service accounts"
for sa in "autodocs-run:AutoDocs app" "autodocs-deploy:AutoDocs deploys from GitHub"; do
  id=${sa%%:*}
  g iam service-accounts describe "$id@$GCP_PROJECT.iam.gserviceaccount.com" >/dev/null 2>&1 ||
    g iam service-accounts create "$id" --display-name="${sa#*:}" --format=none
done
retry g projects add-iam-policy-binding "$GCP_PROJECT" --member="serviceAccount:$RUN_SA" --role=roles/cloudsql.client --condition=None --format=none
retry g storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$RUN_SA" --role=roles/storage.objectAdmin --format=none
retry g projects add-iam-policy-binding "$GCP_PROJECT" --member="serviceAccount:$DEPLOY_SA" --role=roles/run.developer --condition=None --format=none
retry g artifacts repositories add-iam-policy-binding "$IMAGES" --location="$GCP_REGION" --member="serviceAccount:$DEPLOY_SA" --role=roles/artifactregistry.writer --format=none
retry g iam service-accounts add-iam-policy-binding "$RUN_SA" --member="serviceAccount:$DEPLOY_SA" --role=roles/iam.serviceAccountUser --format=none
ok "autodocs-run: runs the app (database, its files, its own secrets)"
ok "autodocs-deploy: GitHub uses it to publish new versions, nothing else"

say "Secrets"
make_secret() { # name, then a command that prints a fresh value
  local name=$1
  shift
  if ! secret_exists "$name"; then
    g secrets describe "$name" >/dev/null 2>&1 || g secrets create "$name" --replication-policy=automatic --format=none
    "$@" | tr -d '\n' | g secrets versions add "$name" --data-file=- --format=none
  fi
  grant_secret "$name"
  ok "$name"
}
make_secret session-secret openssl rand -hex 32
make_secret admin-password sh -c "openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-32"
g secrets describe openai-api-key >/dev/null 2>&1 || g secrets create openai-api-key --replication-policy=automatic --format=none
grant_secret openai-api-key
if secret_exists openai-api-key; then
  ok "openai-api-key"
else
  note "openai-api-key isn't there yet. Run deploy/gcp/put-secret.sh openai-api-key in your own terminal and paste the key."
fi

say "Trust between GitHub and this project (Workload Identity Federation, no keys stored anywhere)"
POOL=github
PROVIDER=autodocs
g iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1 ||
  g iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub Actions" --format=none
CONDITION="assertion.repository_id=='$GITHUB_REPO_ID' && assertion.ref=='refs/heads/main'"
MAPPING="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_id=assertion.repository_id,attribute.ref=assertion.ref"
if g iam workload-identity-pools providers describe "$PROVIDER" --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1; then
  g iam workload-identity-pools providers update-oidc "$PROVIDER" --location=global --workload-identity-pool="$POOL" \
    --attribute-mapping="$MAPPING" --attribute-condition="$CONDITION" --format=none
else
  g iam workload-identity-pools providers create-oidc "$PROVIDER" --location=global --workload-identity-pool="$POOL" \
    --display-name="AutoDocs repository" --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="$MAPPING" --attribute-condition="$CONDITION" --format=none
fi
retry g iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/attribute.repository_id/$GITHUB_REPO_ID" \
  --format=none
WIF_PROVIDER="projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER"
ok "Only pushes to main in $GITHUB_REPO can deploy"

# Everything below needs the database server to be up.
if [ "$SQL_STATE" != "RUNNABLE" ]; then
  SQL_STATE=$(g sql instances describe "$SQL_INSTANCE" --format='value(state)')
  [ "$SQL_STATE" = "RUNNABLE" ] || later "The database server is still being created ($SQL_STATE). Run deploy/gcp/setup.sh again in 5 minutes; it picks up from here."
fi

say "Database and its user"
CONNECTION=$(g sql instances describe "$SQL_INSTANCE" --format='value(connectionName)')
g sql databases describe autodocs --instance="$SQL_INSTANCE" >/dev/null 2>&1 ||
  g sql databases create autodocs --instance="$SQL_INSTANCE" --format=none
if ! secret_exists database-url; then
  DB_PASSWORD=$(openssl rand -hex 24)
  if g sql users list --instance="$SQL_INSTANCE" --format='value(name)' | grep -qx autodocs; then
    g sql users set-password autodocs --instance="$SQL_INSTANCE" --password="$DB_PASSWORD" --format=none
  else
    g sql users create autodocs --instance="$SQL_INSTANCE" --password="$DB_PASSWORD" --format=none
  fi
  g secrets describe database-url >/dev/null 2>&1 || g secrets create database-url --replication-policy=automatic --format=none
  printf 'postgresql://autodocs:%s@/autodocs?host=/cloudsql/%s' "$DB_PASSWORD" "$CONNECTION" | g secrets versions add database-url --data-file=- --format=none
  unset DB_PASSWORD
fi
grant_secret database-url
ok "Database autodocs on $CONNECTION (daily backups kept 14 days, point-in-time recovery on)"

say "The app (Cloud Run)"
if ! g run services describe "$SERVICE" --region="$GCP_REGION" >/dev/null 2>&1; then
  secret_exists openai-api-key || later "Waiting for the OpenAI key. Run deploy/gcp/put-secret.sh openai-api-key in your own
terminal (AI agents: ask your human to), then run deploy/gcp/setup.sh again."
  # A placeholder until GitHub builds and deploys the real app; it carries all the settings,
  # and deploys only swap the image. If SEED_IMPORT_URL is set (an existing help center to move
  # from), the real app fills itself from it on first start: articles, sections, images, redirects.
  ENV_VARS="GCS_BUCKET=$BUCKET"
  SEED_IMPORT_URL=${SEED_IMPORT_URL:-}
  if [ -n "$SEED_IMPORT_URL" ]; then ENV_VARS="$ENV_VARS,SEED_IMPORT_URL=$SEED_IMPORT_URL"; fi
  g run deploy "$SERVICE" --region="$GCP_REGION" --image=us-docker.pkg.dev/cloudrun/container/hello \
    --service-account="$RUN_SA" --add-cloudsql-instances="$CONNECTION" \
    --set-secrets="ADMIN_PASSWORD=admin-password:latest,SESSION_SECRET=session-secret:latest,DATABASE_URL=database-url:latest,OPENAI_API_KEY=openai-api-key:latest" \
    --set-env-vars="$ENV_VARS" \
    --cpu="$CPU" --memory="$MEMORY" --no-cpu-throttling --cpu-boost --min-instances=1 --max-instances="$MAX_INSTANCES" \
    --concurrency=40 --timeout=300 --execution-environment=gen2 --port=8080 --no-invoker-iam-check --format=none
fi
SERVICE_URL=$(g run services describe "$SERVICE" --region="$GCP_REGION" --format='value(status.url)')
if ! g run services describe "$SERVICE" --region="$GCP_REGION" --format=json | grep -q '"name": "PUBLIC_URL"'; then
  # Until the domains are live, the service's own address is the public one.
  g run services update "$SERVICE" --region="$GCP_REGION" --update-env-vars="PUBLIC_URL=$SERVICE_URL" --format=none
fi
ok "$SERVICE at $SERVICE_URL"

say "Saving the deploy settings to $TARGET"
set_target GCP_PROJECT "$GCP_PROJECT"
set_target GCP_REGION "$GCP_REGION"
set_target SERVICE "$SERVICE"
set_target GITHUB_REPO "$GITHUB_REPO"
set_target GITHUB_REPO_ID "$GITHUB_REPO_ID"
set_target WIF_PROVIDER "$WIF_PROVIDER"
set_target DEPLOY_SA "$DEPLOY_SA"
set_target SERVICE_URL "$SERVICE_URL"
ok "Done. No secrets are in that file; it's meant to be committed."

cat <<EOF

Setup is complete. Next:
  1. Commit and push $TARGET to main:
       git add $TARGET && git commit -m "Deploy to $GCP_PROJECT" && git push
     That push makes GitHub build the app, test it against a real database, and deploy it here.
     Watch it with: gh run watch
  2. When it's green, check: curl -s $SERVICE_URL/api/health   (should print {"ok":true})
     The help center then fills itself from its old address within a few minutes.
  3. Have your human run deploy/gcp/owner-link.sh in their own terminal to create the owner account.
EOF

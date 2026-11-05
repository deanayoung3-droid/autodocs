# Shared by the deploy/gcp scripts. Source it from the repository root.

TARGET=deploy/target.env

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  ✓ %s\n' "$*"; }
note() { printf '  · %s\n' "$*"; }
die() {
  printf '\n✗ %s\n' "$*" >&2
  exit 1
}
# Exit code 75 means "nothing is wrong; run this script again later".
later() {
  printf '\n… %s\n' "$*"
  exit 75
}
need() { command -v "$1" >/dev/null 2>&1 || die "$1 isn't installed. $2"; }

# gcloud for this project, never prompting.
g() { gcloud --project="$GCP_PROJECT" --quiet "$@"; }

# Retries a command a few times: new service accounts take a few seconds to be usable in IAM.
retry() {
  local i
  for i in 1 2 3 4 5 6; do
    "$@" && return 0
    sleep 10
  done
  return 1
}

load_target() {
  [ -f "$TARGET" ] || die "$TARGET doesn't exist. Copy deploy/target.env.example to $TARGET and fill in GCP_PROJECT."
  set -a
  # shellcheck disable=SC1090
  . "./$TARGET"
  set +a
  [ -n "${GCP_PROJECT:-}" ] || die "Set GCP_PROJECT in $TARGET."
  GCP_REGION=${GCP_REGION:-us-central1}
  SERVICE=${SERVICE:-autodocs}
  SQL_INSTANCE=${SQL_INSTANCE:-autodocs-db}
  DB_TIER=${DB_TIER:-db-custom-1-3840}
  CPU=${CPU:-1}
  MEMORY=${MEMORY:-2Gi}
  MAX_INSTANCES=${MAX_INSTANCES:-4}
  BUCKET=${BUCKET:-$GCP_PROJECT-autodocs-files}
  RUN_SA=autodocs-run@$GCP_PROJECT.iam.gserviceaccount.com
  DEPLOY_SA=autodocs-deploy@$GCP_PROJECT.iam.gserviceaccount.com
  IMAGES=autodocs
}

# Writes KEY=value into deploy/target.env, replacing the line if it's there.
set_target() {
  if grep -q "^$1=" "$TARGET"; then
    sed -i.bak "s|^$1=.*|$1=$2|" "$TARGET" && rm -f "$TARGET.bak"
  else
    printf '%s=%s\n' "$1" "$2" >>"$TARGET"
  fi
}

secret_exists() { g secrets versions list "$1" --filter=state=enabled --limit=1 --format='value(name)' 2>/dev/null | grep -q .; }

# Lets the running app read one secret (and nothing else in the project).
grant_secret() {
  g iam service-accounts describe "$RUN_SA" >/dev/null 2>&1 || return 0
  retry g secrets add-iam-policy-binding "$1" --member="serviceAccount:$RUN_SA" --role=roles/secretmanager.secretAccessor --format=none
}

# Restarts the app on its current image so it reads secrets again (they're read at start).
restart_service() {
  g run services describe "$SERVICE" --region="$GCP_REGION" >/dev/null 2>&1 || return 0
  g run services update "$SERVICE" --region="$GCP_REGION" --update-labels="restarted=$(date +%s)" --format=none
}

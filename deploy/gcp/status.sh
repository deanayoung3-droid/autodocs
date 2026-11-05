#!/usr/bin/env bash
# One look at everything: the app's address and health, what's deployed, the database, secrets
# (names only), domains, and the latest errors. Changes nothing.
set -uo pipefail
cd "$(dirname "$0")/../.."
. deploy/gcp/lib.sh
load_target

say "App"
URL=$(g run services describe "$SERVICE" --region="$GCP_REGION" --format='value(status.url)' 2>/dev/null)
if [ -z "$URL" ]; then
  note "Not deployed yet (run deploy/gcp/setup.sh)"
else
  ok "$URL"
  g run services describe "$SERVICE" --region="$GCP_REGION" \
    --format='value(status.latestReadyRevisionName,spec.template.spec.containers[0].image)' | awk '{print "  · revision " $1 "\n  · image " $2}'
  printf '  · health: %s\n' "$(curl -s --max-time 10 "$URL/api/health" || echo 'no answer')"
fi

say "Database"
g sql instances describe "$SQL_INSTANCE" --format='value(state,settings.tier,databaseVersion)' 2>/dev/null | awk '{print "  · " $1 ", " $2 ", " $3}' || note "missing"

say "Secrets (names only)"
for s in admin-password session-secret database-url openai-api-key; do
  if secret_exists "$s"; then ok "$s"; else note "$s is missing"; fi
done

if [ -n "${PUBLIC_DOMAIN:-}" ]; then
  say "Domains"
  deploy/gcp/domains.sh status 2>/dev/null | sed -n '/Certificate:/,$p' | sed 's/^/  /'
fi

say "Latest errors (last 24 hours)"
g logging read "resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE AND severity>=ERROR" \
  --freshness=1d --limit=5 --format='value(timestamp,textPayload)' 2>/dev/null | cut -c1-220 | sed 's/^/  /'
echo
echo "Full logs: gcloud run services logs read $SERVICE --region=$GCP_REGION --project=$GCP_PROJECT --limit=200"

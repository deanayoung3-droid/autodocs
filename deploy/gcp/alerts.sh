#!/usr/bin/env bash
# Emails ALERT_EMAILS when AutoDocs stops answering, when it logs errors (at most every 6 hours),
# and as spending passes 50%, 90%, and 100% of MONTHLY_BUDGET_USD. Safe to run again; run it once
# more after domains.sh go-live so the public domain is watched too.
set -euo pipefail
cd "$(dirname "$0")/../.."
. deploy/gcp/lib.sh
load_target
[ -n "${ALERT_EMAILS:-}" ] || die "Set ALERT_EMAILS in $TARGET (comma-separated)."
SERVICE_URL=$(g run services describe "$SERVICE" --region="$GCP_REGION" --format='value(status.url)' 2>/dev/null) ||
  die "The app isn't deployed yet. Run deploy/gcp/setup.sh first."

say "Where alerts go"
CHANNELS=()
IFS=',' read -ra EMAILS <<<"$ALERT_EMAILS"
for email in "${EMAILS[@]}"; do
  email=$(echo "$email" | tr -d ' ')
  [ -n "$email" ] || continue
  id=$(g beta monitoring channels list --filter="type=\"email\" AND labels.email_address=\"$email\"" --format='value(name)' | head -1)
  [ -n "$id" ] || id=$(g beta monitoring channels create --display-name="AutoDocs: $email" --type=email --channel-labels="email_address=$email" --format='value(name)')
  CHANNELS+=("$id")
  ok "$email"
done
[ ${#CHANNELS[@]} -gt 0 ] || die "ALERT_EMAILS has no addresses."
CHANNEL_JSON=$(printf '"%s",' "${CHANNELS[@]}")
CHANNEL_JSON="[${CHANNEL_JSON%,}]"

# One uptime check per address: the Cloud Run address until deploy/gcp/iap.sh lock closes it to the
# internet, and the public domain once it's live. (The admin domain is behind IAP, so the public one
# stands in for it: it's the same app.)
HOSTS=()
INGRESS=$(g run services describe "$SERVICE" --region="$GCP_REGION" --format='value(metadata.annotations."run.googleapis.com/ingress")' 2>/dev/null || true)
if [ "${INGRESS:-all}" = all ]; then HOSTS+=("${SERVICE_URL#https://}"); fi
if [[ "${PUBLIC_URL:-}" == https://* && "${PUBLIC_URL#https://}" != "${SERVICE_URL#https://}" ]]; then HOSTS+=("${PUBLIC_URL#https://}"); fi
[ ${#HOSTS[@]} -gt 0 ] || die "Nothing public to watch: the Cloud Run address is closed and PUBLIC_URL isn't set. Run deploy/gcp/domains.sh go-live."

say "Uptime checks (every 5 minutes, from several regions)"
for host in "${HOSTS[@]}"; do
  label="AutoDocs $host"
  check=$(g monitoring uptime list-configs --filter="displayName=\"$label\"" --format='value(name.basename())' | head -1)
  if [ -z "$check" ]; then
    check=$(g monitoring uptime create "$label" --resource-type=uptime-url --resource-labels="host=$host,project_id=$GCP_PROJECT" \
      --protocol=https --path=/api/health --period=5 --timeout=10 --format='value(name.basename())')
  fi
  ok "https://$host/api/health"

  policy="AutoDocs is down ($host)"
  if [ -z "$(g monitoring policies list --filter="displayName=\"$policy\"" --format='value(name)')" ]; then
    FILE=$(mktemp)
    cat >"$FILE" <<JSON
{
  "displayName": "$policy",
  "combiner": "OR",
  "conditions": [{
    "displayName": "Health check failing",
    "conditionThreshold": {
      "filter": "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.label.check_id=\"$check\" AND resource.type=\"uptime_url\"",
      "aggregations": [{ "alignmentPeriod": "1200s", "perSeriesAligner": "ALIGN_NEXT_OLDER", "crossSeriesReducer": "REDUCE_COUNT_FALSE", "groupByFields": ["resource.label.*"] }],
      "comparison": "COMPARISON_GT",
      "thresholdValue": 1,
      "duration": "60s",
      "trigger": { "count": 1 }
    }
  }],
  "notificationChannels": $CHANNEL_JSON,
  "documentation": { "mimeType": "text/markdown", "content": "https://$host/api/health is failing from more than one region. Logs: gcloud run services logs read $SERVICE --region=$GCP_REGION --project=$GCP_PROJECT --limit=200" }
}
JSON
    g monitoring policies create --policy-from-file="$FILE" --format=none
    rm -f "$FILE"
  fi
  ok "Alert: $policy"
done

say "Error alert"
policy="AutoDocs logged errors"
if [ -z "$(g monitoring policies list --filter="displayName=\"$policy\"" --format='value(name)')" ]; then
  FILE=$(mktemp)
  cat >"$FILE" <<JSON
{
  "displayName": "$policy",
  "combiner": "OR",
  "conditions": [{
    "displayName": "Error in the app's logs",
    "conditionMatchedLog": { "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$SERVICE\" AND severity>=ERROR" }
  }],
  "alertStrategy": { "notificationRateLimit": { "period": "21600s" }, "autoClose": "86400s" },
  "notificationChannels": $CHANNEL_JSON,
  "documentation": { "mimeType": "text/markdown", "content": "AutoDocs wrote an error to its logs. Recent errors: gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE AND severity>=ERROR' --project=$GCP_PROJECT --limit=20 --freshness=1d" }
}
JSON
  g monitoring policies create --policy-from-file="$FILE" --format=none
  rm -f "$FILE"
fi
ok "Alert: $policy (at most one email every 6 hours)"

say "Budget"
BUDGET=${MONTHLY_BUDGET_USD:-200}
ACCOUNT=$(g billing projects describe "$GCP_PROJECT" --format='value(billingAccountName)' | sed 's#billingAccounts/##')
CHANNEL_LIST=$(
  IFS=,
  echo "${CHANNELS[*]}"
)
if [ -z "$ACCOUNT" ]; then
  note "Couldn't read the billing account, so no budget was set."
elif g billing budgets list --billing-account="$ACCOUNT" --format='value(displayName)' 2>/dev/null | grep -qx "AutoDocs ($GCP_PROJECT)"; then
  ok "Budget already set"
elif g billing budgets create --billing-account="$ACCOUNT" --display-name="AutoDocs ($GCP_PROJECT)" --budget-amount="${BUDGET}USD" \
  --filter-projects="projects/$GCP_PROJECT" --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 \
  --notifications-rule-monitoring-notification-channels="$CHANNEL_LIST" --format=none 2>/dev/null; then
  ok "Emails at 50%, 90%, and 100% of \$$BUDGET a month (a warning only; nothing is switched off)"
else
  note "Couldn't create the budget (it needs Billing Account Administrator). Set one in the console: Billing → Budgets & alerts."
fi

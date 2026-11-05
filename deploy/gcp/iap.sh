#!/usr/bin/env bash
# Puts everything that isn't for readers behind Google's Identity-Aware Proxy (IAP), so only the
# Google accounts in IAP_USERS (deploy/target.env) can reach the admin at all, even its sign-in page.
# Run after domains.sh. Safe to run again.
#
#   deploy/gcp/iap.sh           IAP backend, routing, and who may pass
#   deploy/gcp/iap.sh lock      also close the Cloud Run address to the internet (run after go-live)
#
# Routing on the load balancer:
#   ADMIN_DOMAIN           everything behind IAP
#   PUBLIC_DOMAIN          public, except the admin paths below (behind IAP)
#   any other host header  behind IAP
# Webhooks (GitHub, Linear, Slack), MCP and OAuth metadata, the widget, the extension's API, and
# /api/v1 all use PUBLIC_DOMAIN, so they stay public.
set -euo pipefail
cd "$(dirname "$0")/../.."
. deploy/gcp/lib.sh
load_target
[ -n "${IAP_USERS:-}" ] || die "Set IAP_USERS in $TARGET (comma-separated Google accounts in the organization)."
g compute url-maps describe autodocs-map --global >/dev/null 2>&1 || die "Run deploy/gcp/domains.sh first."

# Same list as ADMIN_PATHS in src/proxy.ts: pages that need the admin session.
ADMIN_PATHS="/admin /login /oauth/authorize /invite /welcome /api/admin /api/github/manifest /api/github/setup /api/linear/connect /api/linear/callback /api/extension/download"

say "IAP backend"
g services enable iap.googleapis.com >/dev/null
if ! g compute backend-services describe autodocs-admin-backend --global >/dev/null 2>&1; then
  g compute backend-services create autodocs-admin-backend --global --load-balancing-scheme=EXTERNAL_MANAGED --format=none
  g compute backend-services add-backend autodocs-admin-backend --global --network-endpoint-group=autodocs-neg --network-endpoint-group-region="$GCP_REGION" --format=none
fi
# No OAuth client of our own: Google's managed one only admits accounts in this organization.
g compute backend-services update autodocs-admin-backend --global --iap=enabled --format=none
# IAP calls Cloud Run as its own service agent, which has to exist and be allowed to invoke the app.
g beta services identity create --service=iap.googleapis.com --format=none
PROJECT_NUMBER=$(g projects describe "$GCP_PROJECT" --format='value(projectNumber)')
retry g run services add-iam-policy-binding "$SERVICE" --region="$GCP_REGION" \
  --member="serviceAccount:service-$PROJECT_NUMBER@gcp-sa-iap.iam.gserviceaccount.com" --role=roles/run.invoker --format=none
ok "autodocs-admin-backend (same app, IAP on)"

say "Who may pass IAP"
IFS=',' read -ra USERS <<<"$IAP_USERS"
for u in "${USERS[@]}"; do
  u=$(echo "$u" | tr -d ' ')
  [ -n "$u" ] || continue
  [[ "$u" == *:* ]] || u="user:$u"
  retry g iap web add-iam-policy-binding --resource-type=backend-services --service=autodocs-admin-backend \
    --member="$u" --role=roles/iap.httpsResourceAccessor --format=none
  ok "$u"
done

say "Routing"
BASE="https://www.googleapis.com/compute/v1/projects/$GCP_PROJECT/global/backendServices"
MAP=$(mktemp)
{
  echo "name: autodocs-map"
  echo "defaultService: $BASE/autodocs-admin-backend"
  echo "hostRules:"
  echo "- hosts: ['$PUBLIC_DOMAIN']"
  echo "  pathMatcher: public"
  echo "- hosts: ['$ADMIN_DOMAIN']"
  echo "  pathMatcher: admin"
  echo "pathMatchers:"
  echo "- name: public"
  echo "  defaultService: $BASE/autodocs-backend"
  echo "  pathRules:"
  echo "  - service: $BASE/autodocs-admin-backend"
  echo "    paths:"
  for p in $ADMIN_PATHS; do printf "    - '%s'\n    - '%s/*'\n" "$p" "$p"; done
  echo "- name: admin"
  echo "  defaultService: $BASE/autodocs-admin-backend"
} >"$MAP"
g compute url-maps import autodocs-map --global --source="$MAP" --format=none
rm -f "$MAP"
ok "$ADMIN_DOMAIN: IAP · $PUBLIC_DOMAIN: public, admin paths IAP · anything else: IAP"

if [ "${1:-}" = lock ]; then
  say "Cloud Run address"
  [[ "${PUBLIC_URL:-}" == https://* ]] || die "Run deploy/gcp/domains.sh go-live first: the Cloud Run address is the only way in until then."
  g run services update "$SERVICE" --region="$GCP_REGION" --ingress=internal-and-cloud-load-balancing --format=none
  ok "Only the load balancer can reach $SERVICE; its run.app address no longer answers from the internet"
fi

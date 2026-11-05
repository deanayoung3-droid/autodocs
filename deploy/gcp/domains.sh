#!/usr/bin/env bash
# Serves AutoDocs on your own domains through Google's load balancer with a Google-managed HTTPS
# certificate: PUBLIC_DOMAIN (docs.…) for the help center and widget, ADMIN_DOMAIN (admin-docs.…)
# for the admin. The certificate is proven with DNS records rather than by serving traffic, so it's
# ready before the help center's domain leaves its old host: switching over has no downtime.
#
#   deploy/gcp/domains.sh           create or check everything, then list the DNS records to add
#   deploy/gcp/domains.sh status    certificate, DNS, and whether each address answers
#   deploy/gcp/domains.sh go-live   make the app use the domains (run right after the switch-over)
set -euo pipefail
cd "$(dirname "$0")/../.."
. deploy/gcp/lib.sh
load_target
[ -n "${PUBLIC_DOMAIN:-}" ] && [ -n "${ADMIN_DOMAIN:-}" ] ||
  die "Set PUBLIC_DOMAIN and ADMIN_DOMAIN in $TARGET (for example docs.example.com and admin.docs.example.com)."

name_for() { printf 'autodocs-%s' "$(printf '%s' "$1" | tr '.' '-')" | cut -c1-63; }
cert_state() { g certificate-manager certificates describe autodocs-cert --format='value(managed.state)' 2>/dev/null || echo MISSING; }
lb_ip() { g compute addresses describe autodocs-ip --global --format='value(address)' 2>/dev/null || true; }
resolve() { # public DNS answer for a name and type, last line only
  if command -v dig >/dev/null 2>&1; then dig +short "$1" "$2" @1.1.1.1 2>/dev/null | tail -1; else nslookup -type="$2" "$1" 1.1.1.1 2>/dev/null | awk '/^Address: |canonical name/{v=$NF} END{print v}'; fi
}

records() {
  local ip
  ip=$(lb_ip)
  echo
  echo "Add these records where your domain's DNS is managed (Cloudflare, Google Domains, GoDaddy, …)."
  echo "If it's Cloudflare, set each one to \"DNS only\" (grey cloud), not proxied."
  echo
  echo "Now. These prove you own the domains, so Google can issue the certificate:"
  for d in "$PUBLIC_DOMAIN" "$ADMIN_DOMAIN"; do
    read -r rname rdata < <(g certificate-manager dns-authorizations describe "$(name_for "$d")" --format='value(dnsResourceRecord.name,dnsResourceRecord.data)')
    printf '  CNAME  %-48s → %s\n' "${rname%.}" "${rdata%.}"
  done
  printf '  A      %-48s → %s\n' "$ADMIN_DOMAIN" "$ip"
  echo
  echo "When you're ready for readers to see it (if $PUBLIC_DOMAIN already serves an old help center,"
  echo "add this on the day you switch over; until then nothing changes for readers):"
  printf '  A      %-48s → %s   (replace whatever %s points to now; remove a CNAME there if it has one)\n' "$PUBLIC_DOMAIN" "$ip" "$PUBLIC_DOMAIN"
}

case "${1:-setup}" in
setup)
  say "Load balancer address"
  g compute addresses describe autodocs-ip --global >/dev/null 2>&1 ||
    g compute addresses create autodocs-ip --global --ip-version=IPV4 --format=none
  ok "$(lb_ip)"

  say "Route from the load balancer to the app"
  g compute network-endpoint-groups describe autodocs-neg --region="$GCP_REGION" >/dev/null 2>&1 ||
    g compute network-endpoint-groups create autodocs-neg --region="$GCP_REGION" --network-endpoint-type=serverless --cloud-run-service="$SERVICE" --format=none
  if ! g compute backend-services describe autodocs-backend --global >/dev/null 2>&1; then
    g compute backend-services create autodocs-backend --global --load-balancing-scheme=EXTERNAL_MANAGED --format=none
    g compute backend-services add-backend autodocs-backend --global --network-endpoint-group=autodocs-neg --network-endpoint-group-region="$GCP_REGION" --format=none
  fi
  g compute url-maps describe autodocs-map --global >/dev/null 2>&1 ||
    g compute url-maps create autodocs-map --global --default-service=autodocs-backend --format=none
  if ! g compute url-maps describe autodocs-redirect --global >/dev/null 2>&1; then
    REDIRECT=$(mktemp)
    printf 'name: autodocs-redirect\ndefaultUrlRedirect:\n  httpsRedirect: true\n  redirectResponseCode: MOVED_PERMANENTLY_DEFAULT\n' >"$REDIRECT"
    g compute url-maps import autodocs-redirect --global --source="$REDIRECT" --format=none
    rm -f "$REDIRECT"
  fi
  ok "https://… goes to $SERVICE; http://… redirects to https"

  say "HTTPS certificate for $PUBLIC_DOMAIN and $ADMIN_DOMAIN"
  for d in "$PUBLIC_DOMAIN" "$ADMIN_DOMAIN"; do
    g certificate-manager dns-authorizations describe "$(name_for "$d")" >/dev/null 2>&1 ||
      g certificate-manager dns-authorizations create "$(name_for "$d")" --domain="$d" --format=none
  done
  g certificate-manager certificates describe autodocs-cert >/dev/null 2>&1 ||
    g certificate-manager certificates create autodocs-cert --domains="$PUBLIC_DOMAIN,$ADMIN_DOMAIN" \
      --dns-authorizations="$(name_for "$PUBLIC_DOMAIN"),$(name_for "$ADMIN_DOMAIN")" --format=none
  g certificate-manager maps describe autodocs-certmap >/dev/null 2>&1 ||
    g certificate-manager maps create autodocs-certmap --format=none
  for d in "$PUBLIC_DOMAIN" "$ADMIN_DOMAIN"; do
    g certificate-manager maps entries describe "$(name_for "$d")" --map=autodocs-certmap >/dev/null 2>&1 ||
      g certificate-manager maps entries create "$(name_for "$d")" --map=autodocs-certmap --hostname="$d" --certificates=autodocs-cert --format=none
  done
  ok "Certificate requested ($(cert_state)); Google issues it once the CNAME records below exist"

  say "Front door (ports 443 and 80)"
  g compute target-https-proxies describe autodocs-https --global >/dev/null 2>&1 ||
    g compute target-https-proxies create autodocs-https --global --url-map=autodocs-map --certificate-map=autodocs-certmap --format=none
  g compute target-http-proxies describe autodocs-http --global >/dev/null 2>&1 ||
    g compute target-http-proxies create autodocs-http --global --url-map=autodocs-redirect --format=none
  g compute forwarding-rules describe autodocs-https-rule --global >/dev/null 2>&1 ||
    g compute forwarding-rules create autodocs-https-rule --global --load-balancing-scheme=EXTERNAL_MANAGED \
      --address=autodocs-ip --target-https-proxy=autodocs-https --ports=443 --format=none
  g compute forwarding-rules describe autodocs-http-rule --global >/dev/null 2>&1 ||
    g compute forwarding-rules create autodocs-http-rule --global --load-balancing-scheme=EXTERNAL_MANAGED \
      --address=autodocs-ip --target-http-proxy=autodocs-http --ports=80 --format=none
  set_target LB_IP "$(lb_ip)"
  ok "Ready"
  records
  echo
  echo "Then check progress with: deploy/gcp/domains.sh status"
  ;;

status)
  IP=$(lb_ip)
  [ -n "$IP" ] || die "Nothing set up yet. Run: deploy/gcp/domains.sh"
  say "Certificate: $(cert_state)"
  g certificate-manager certificates describe autodocs-cert --format='table[no-heading](managed.authorizationAttemptInfo[].domain,managed.authorizationAttemptInfo[].state,managed.authorizationAttemptInfo[].details)' 2>/dev/null | sed 's/^/  /' || true
  say "DNS (load balancer is $IP)"
  for d in "$PUBLIC_DOMAIN" "$ADMIN_DOMAIN"; do
    want=$(g certificate-manager dns-authorizations describe "$(name_for "$d")" --format='value(dnsResourceRecord.data)')
    have=$(resolve "_acme-challenge.$d" CNAME)
    if [ "${have%.}" = "${want%.}" ]; then ok "_acme-challenge.$d CNAME is set"; else note "_acme-challenge.$d CNAME missing (want ${want%.}, found ${have:-nothing})"; fi
    a=$(resolve "$d" A)
    if [ "$a" = "$IP" ]; then
      code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$d/api/health" || true)
      ok "$d points here; https://$d/api/health answers $code"
    else
      note "$d points to ${a:-nothing} (not here yet)"
    fi
  done
  echo
  case "$(cert_state)" in
  ACTIVE) echo "The certificate is ready. Point $PUBLIC_DOMAIN's A record here (when you're ready for readers), then run deploy/gcp/domains.sh go-live" ;;
  *) echo "Google issues the certificate within an hour of the CNAME records appearing (often 10 to 20 minutes). Check again later." ;;
  esac
  ;;

go-live)
  [ "$(cert_state)" = ACTIVE ] || die "The certificate isn't ready yet ($(cert_state)). See: deploy/gcp/domains.sh status"
  g run services update "$SERVICE" --region="$GCP_REGION" \
    --update-env-vars="PUBLIC_URL=https://$PUBLIC_DOMAIN,ADMIN_URL=https://$ADMIN_DOMAIN" --format=none
  set_target PUBLIC_URL "https://$PUBLIC_DOMAIN"
  set_target ADMIN_URL "https://$ADMIN_DOMAIN"
  ok "Help center: https://$PUBLIC_DOMAIN   Admin: https://$ADMIN_DOMAIN/admin"
  note "Each address now only serves its own half; the Cloud Run address still serves both."
  note "Commit $TARGET so the next person sees the current setup."
  ;;

*) die "Unknown command $1. Use: deploy/gcp/domains.sh [setup|status|go-live]" ;;
esac

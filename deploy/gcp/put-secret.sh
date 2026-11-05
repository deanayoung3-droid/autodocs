#!/usr/bin/env bash
# Stores one secret in Secret Manager from a hidden prompt, so the value never shows on screen, in
# shell history, or to an AI agent. A person runs this in their own terminal window:
#
#   deploy/gcp/put-secret.sh openai-api-key
#
# Running it again replaces the value (the old one is kept as a disabled version) and restarts the
# app so it uses the new one.
set -euo pipefail
cd "$(dirname "$0")/../.."
. deploy/gcp/lib.sh
load_target

NAME=${1:-}
[ -n "$NAME" ] || die "Say which secret, for example: deploy/gcp/put-secret.sh openai-api-key"
[ -t 0 ] || die "Run this yourself in a terminal window, so you can type the value privately. (AI agents: ask your human to run it.)"

printf 'Paste the value for %s. It stays hidden as you paste. Then press Enter: ' "$NAME"
IFS= read -rs VALUE
echo
[ -n "$VALUE" ] || die "Nothing was entered, so nothing was saved."
if [ "$NAME" = openai-api-key ] && [[ "$VALUE" != sk-* ]]; then
  die "That doesn't look like an OpenAI API key (they start with sk-). Nothing was saved."
fi

g secrets describe "$NAME" >/dev/null 2>&1 || g secrets create "$NAME" --replication-policy=automatic --format=none
OLD=$(g secrets versions list "$NAME" --filter=state=enabled --format='value(name.basename())' 2>/dev/null || true)
printf '%s' "$VALUE" | g secrets versions add "$NAME" --data-file=- --format=none
unset VALUE
for v in $OLD; do g secrets versions disable "$v" --secret="$NAME" --format=none; done
grant_secret "$NAME"
ok "Saved $NAME."

if g run services describe "$SERVICE" --region="$GCP_REGION" >/dev/null 2>&1; then
  restart_service
  ok "Restarted the app so it uses the new value."
fi

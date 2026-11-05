#!/usr/bin/env bash
# Prints (and opens) the one-time link that creates the AutoDocs owner account. The link works until
# an owner account exists, and only for whoever has it, so a person runs this in their own
# terminal window:
#
#   deploy/gcp/owner-link.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
. deploy/gcp/lib.sh
load_target
[ -t 0 ] || die "Run this yourself in a terminal window: the link it prints is private. (AI agents: ask your human to run it.)"

PASSWORD=$(g secrets versions access latest --secret=admin-password 2>/dev/null) || die "Couldn't read the setup password. Run deploy/gcp/setup.sh first."
# The app checks the same code (users.ts), so the password itself never goes in a link.
CODE=$(printf '%s' "autodocs-owner-setup" | openssl dgst -sha256 -hmac "$PASSWORD" -r | cut -d' ' -f1)
unset PASSWORD
BASE=${ADMIN_URL:-$(g run services describe "$SERVICE" --region="$GCP_REGION" --format='value(status.url)')}
LINK="$BASE/welcome?code=$CODE"

echo
echo "Open this link to create the owner account. It stops working once that account exists:"
echo
echo "  $LINK"
echo
if command -v open >/dev/null 2>&1; then open "$LINK"; fi

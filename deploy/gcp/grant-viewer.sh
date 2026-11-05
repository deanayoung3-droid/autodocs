#!/usr/bin/env bash
# Gives someone read-only access to the Google Cloud project that runs AutoDocs: logs, the app's settings and
# revisions, monitoring, and the database's status. They can't change or deploy anything, and they
# can't read secrets or data.
#
#   deploy/gcp/grant-viewer.sh someone@gmail.com
set -euo pipefail
cd "$(dirname "$0")/../.."
. deploy/gcp/lib.sh
load_target
EMAIL=${1:-}
[[ "$EMAIL" == *@* ]] || die "Give the Google account's email: deploy/gcp/grant-viewer.sh someone@gmail.com"
for role in roles/run.viewer roles/logging.viewer roles/monitoring.viewer roles/cloudsql.viewer roles/errorreporting.viewer; do
  g projects add-iam-policy-binding "$GCP_PROJECT" --member="user:$EMAIL" --role="$role" --condition=None --format=none
done
ok "$EMAIL can now read logs and status in $GCP_PROJECT (https://console.cloud.google.com/run?project=$GCP_PROJECT)"

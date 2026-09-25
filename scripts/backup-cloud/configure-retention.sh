#!/usr/bin/env bash
# Belt-and-braces retention on the bucket itself: lifecycle rules that expire
# daily/ after 14 days and weekly/ after 56, and purge hidden versions a day
# after hiding. The ENFORCED retention is prune.sh in the workflow (it runs and
# is checked every night); these rules cover the case where the workflow stops
# running. B2 accepts a subset of the S3 lifecycle grammar — if this PUT is
# rejected the script says so and exits 1; nothing else depends on it.
#
#   bash scripts/backup-cloud/configure-retention.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=s3env.sh
. "$HERE/s3env.sh"

cat > /tmp/lifecycle.json <<'JSON'
{
  "Rules": [
    { "ID": "daily-14d",  "Status": "Enabled", "Filter": { "Prefix": "daily/" },
      "Expiration": { "Days": 14 }, "NoncurrentVersionExpiration": { "NoncurrentDays": 1 } },
    { "ID": "weekly-56d", "Status": "Enabled", "Filter": { "Prefix": "weekly/" },
      "Expiration": { "Days": 56 }, "NoncurrentVersionExpiration": { "NoncurrentDays": 1 } }
  ]
}
JSON

if s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration file:///tmp/lifecycle.json; then
  echo "[retention] lifecycle rules applied; bucket reports:"
  s3api get-bucket-lifecycle-configuration --bucket "$BUCKET" --output json
else
  echo "[retention] the bucket rejected the lifecycle configuration — prune.sh remains the only retention. Set the rules in the B2 console instead (docs/OPS_RUNBOOK.md)." >&2
  exit 1
fi

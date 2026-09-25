#!/usr/bin/env bash
# Retention: daily/ objects older than 14 days and weekly/ older than 56 days are
# deleted — EVERY VERSION of them. B2 buckets keep file versions by default, so
# a plain S3 DeleteObject only "hides" the file and the bytes stay billable;
# deleting by version id is what actually removes them. The date is read from
# the object NAME, not its metadata, so a re-uploaded old object is still old.
#
#   bash scripts/backup-cloud/prune.sh                   apply retention
#   bash scripts/backup-cloud/prune.sh --plant-probe     upload a fake 26-year-old object
#   bash scripts/backup-cloud/prune.sh --expect-probe-gone
#                                                        apply, then FAIL unless the probe
#                                                        (every version) is gone
#
# The probe is how retention is proven before a real object is ever old enough
# to be pruned — a cleanup step nobody has watched delete something is a hope.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=s3env.sh
. "$HERE/s3env.sh"
DAILY_DAYS=14; WEEKLY_DAYS=56
PROBE_KEY="daily/rennovaite-2000-01-01T00-00-00Z.tar.gpg"
NOW="$(date -u +%s)"

if [ "${1:-}" = "--plant-probe" ]; then
  printf 'retention probe %s\n' "$(date -u +%FT%TZ)" > /tmp/probe.txt
  s3api put-object --bucket "$BUCKET" --key "$PROBE_KEY" --body /tmp/probe.txt > /dev/null
  s3api put-object --bucket "$BUCKET" --key "$PROBE_KEY" --body /tmp/probe.txt > /dev/null   # a second version, on purpose
  echo "[prune] planted $PROBE_KEY (2 versions)"
  exit 0
fi

deleted=0; kept=0
prune_prefix() { # prefix max_days
  local prefix="$1" max="$2"
  # Versions and delete markers alike — both count as "the object still exists".
  s3api list-object-versions --bucket "$BUCKET" --prefix "$prefix" \
    --query '[Versions[].{Key:Key,VersionId:VersionId}, DeleteMarkers[].{Key:Key,VersionId:VersionId}][]' --output json \
  | jq -c '.[]?' | while read -r row; do
      key="$(jq -r .Key <<<"$row")"; vid="$(jq -r .VersionId <<<"$row")"
      d="$(object_date "$key")"
      if [ -z "$d" ]; then echo "[prune] keep   $key (no date in name)"; continue; fi
      age=$(( (NOW - $(date -u -d "$d" +%s)) / 86400 ))
      if [ "$age" -gt "$max" ]; then
        s3api delete-object --bucket "$BUCKET" --key "$key" --version-id "$vid" > /dev/null
        echo "[prune] delete $key version=$vid age=${age}d (> ${max}d)"
      else
        echo "[prune] keep   $key age=${age}d"
      fi
    done
}
prune_prefix "daily/" "$DAILY_DAYS"
prune_prefix "weekly/" "$WEEKLY_DAYS"

if [ "${1:-}" = "--expect-probe-gone" ]; then
  left="$(s3api list-object-versions --bucket "$BUCKET" --prefix "$PROBE_KEY" \
    --query 'length([Versions[], DeleteMarkers[]][])' --output text)"
  if [ "$left" != "0" ] && [ "$left" != "None" ]; then
    echo "[prune] RETENTION SELF-TEST FAILED — $left version(s) of the probe remain" >&2; exit 1
  fi
  echo "[prune] retention self-test passed — every version of the probe is gone"
fi
echo "[prune] done"

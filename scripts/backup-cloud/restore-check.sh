#!/usr/bin/env bash
# Restore a fetched, decrypted dump into a throwaway Postgres and check it the
# way the I9 rehearsal did: auth schema present with the accounts, RLS state
# present, and every public table's row count equal to the source's at dump
# time (counts.txt, recorded by source-counts.sh). Any mismatch fails.
#
# Scratch only — a container that exists for this script and is removed by it.
# Nothing here can reach production: the connection string is not even passed.
#
#   bash scripts/backup-cloud/restore-check.sh <decrypted-dump-dir>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="${1:?decrypted dump dir}"
PG_IMAGE="${PG_IMAGE:-postgres:17}"
CHECK="rv-cloud-restore-$$"
[ -s "$DIR/full.dump" ] && [ -s "$DIR/counts.txt" ] || { echo "[restore] full.dump or counts.txt missing in $DIR" >&2; exit 1; }

cleanup() { docker rm -f "$CHECK" > /dev/null 2>&1 || true; }
trap cleanup EXIT

# Same Windows accommodation as backup-production.sh: under Git Bash a /c/...
# path is an MSYS invention docker has never heard of, so host paths go through
# cygpath -m and MSYS_NO_PATHCONV stops the container-side /tmp/... being
# rewritten. On the Linux runner both are no-ops.
host_path() { if command -v cygpath > /dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
export MSYS_NO_PATHCONV=1

docker run -d --name "$CHECK" -e POSTGRES_HOST_AUTH_METHOD=trust "$PG_IMAGE" > /dev/null
for _ in $(seq 1 60); do docker exec "$CHECK" pg_isready -U postgres > /dev/null 2>&1 && break; sleep 1; done
docker cp "$(host_path "$DIR/full.dump")" "$CHECK:/tmp/full.dump"
docker cp "$(host_path "$HERE/counts.sql")" "$CHECK:/tmp/counts.sql"

# The dump was taken with --schema='*', which also swept in pg_catalog and
# information_schema entries — including TABLE DATA for pg_catalog.pg_event_trigger.
# A superuser restore COPYs production's event-trigger rows into the scratch
# catalog with function OIDs that mean something else there, and from that
# point every DDL statement fails ("event trigger functions cannot have declared
# arguments"), including all 25 ENABLE ROW LEVEL SECURITY. Found 2026-09-25:
# the unfiltered restore reported 2,981 errors and zero RLS state; with the
# system schemas left out of the TOC it reports 45 (pg_temp_* schemas, vault)
# and the RLS state comes back exactly as the I9 rehearsal saw it.
#
# Since the dump-time fix (--exclude-schema on backup-production.sh) the archive
# must carry NO system-schema entries; that is asserted below and fails the run
# if a regression ever puts them back. The TOC filter stays as a second line of
# defence so an old archive still restores, but it is no longer what makes the
# RLS state come back.
SYSTEM_ENTRIES="$(docker exec "$CHECK" sh -c "pg_restore -l /tmp/full.dump | grep -cE ' (pg_catalog|information_schema) ' || true")"
docker exec "$CHECK" sh -c "pg_restore -l /tmp/full.dump | grep -vE ' (pg_catalog|information_schema) ' > /tmp/toc.list"
docker exec "$CHECK" pg_restore -U postgres -d postgres --no-owner --no-privileges -L /tmp/toc.list /tmp/full.dump 2> "$DIR/cloud-restore.log" || true
docker exec "$CHECK" psql -U postgres -v ON_ERROR_STOP=1 -At -F '|' -f /tmp/counts.sql > "$DIR/counts.restored.txt"

REPORT="$DIR/RESTORE-TEST.txt"
fail=0
{
  echo "object_dir=$(basename "$DIR")"
  echo "restore_errors_logged=$(grep -c 'ERROR' "$DIR/cloud-restore.log" || true)   (expected a handful: vault; NOT thousands — that means system-schema entries were restored)"
  echo "system_schema_toc_entries=${SYSTEM_ENTRIES:-?}   (must be 0 since the dump-time --exclude-schema fix)"
  echo
  printf '%-34s %12s %12s  %s\n' "check" "source" "restored" "verdict"
} > "$REPORT"

# Every line of counts.txt must appear in counts.restored.txt with the same value.
while IFS='|' read -r kind name value; do
  got="$(awk -F'|' -v k="$kind" -v n="$name" '$1==k && $2==n {print $3}' "$DIR/counts.restored.txt")"
  label="$kind${name:+ $name}"
  if [ "$got" = "$value" ]; then v="ok"; else v="MISMATCH"; fail=1; fi
  printf '%-34s %12s %12s  %s\n' "$label" "$value" "${got:-<absent>}" "$v" >> "$REPORT"
done < "$DIR/counts.txt"

# Plausibility floors, the same ones the dump script applies, plus the two the
# rehearsal made explicit: at least one account came back, and RLS state exists.
val() { awk -F'|' -v k="$1" '$1==k {print $3}' "$DIR/counts.restored.txt"; }
floor() { # kind min
  local got; got="$(val "$1")"; got="${got:-0}"
  if [ "$got" -ge "$2" ]; then echo "floor $1 >= $2: ok ($got)"; else echo "floor $1 >= $2: FAILED ($got)"; fail=1; fi
}
{
  echo
  floor public_tables 20
  floor auth_users 1
  floor rls_enabled_auth 1
  floor rls_enabled_storage 1
  if [ "${SYSTEM_ENTRIES:-1}" = "0" ]; then echo "dump carries no pg_catalog/information_schema entries: ok"; else echo "dump carries ${SYSTEM_ENTRIES:-?} system-schema TOC entries: FAILED (dump-time --exclude-schema regressed)"; fail=1; fi
  echo
  echo "restored_at=$(date -u +%FT%TZ)"
  echo "verdict=$([ "$fail" = 0 ] && echo PASSED || echo FAILED)"
} >> "$REPORT"

cat "$REPORT"
[ "$fail" = 0 ] || { echo "[restore] RESTORE TEST FAILED" >&2; exit 1; }
echo "[restore] restore test passed — the cloud copy gives back every row and every account"

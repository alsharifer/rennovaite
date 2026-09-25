#!/usr/bin/env bash
# Record the SOURCE database's row counts (counts.sql) next to the dump, so the
# restore test can compare the cloud copy against what production held at the
# moment it was taken — the I9 rehearsal read production live for this; here
# the same credential does it at dump time.
#
#   SUPABASE_DB_URL=... bash scripts/backup-cloud/source-counts.sh <out-file>
set -euo pipefail
: "${SUPABASE_DB_URL:?}"
OUT="${1:?output file}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PG_IMAGE="${PG_IMAGE:-postgres:17}"

run_counts() {
  docker run --rm -i -e PGURL="$SUPABASE_DB_URL" "$PG_IMAGE" \
    sh -c 'psql "$PGURL" -v ON_ERROR_STOP=1 -At -F "|" -f -' < "$HERE/counts.sql"
}
# Same pooler-drop retry as the dump script.
n=0
until run_counts > "$OUT.tmp"; do
  n=$((n + 1)); [ "$n" -ge 3 ] && { echo "[counts] failed after 3 attempts" >&2; exit 1; }
  echo "[counts] attempt $n failed — retrying in 10s"; sleep 10
done
mv "$OUT.tmp" "$OUT"
echo "[counts] $(grep -c '^table|' "$OUT") tables · auth_users=$(awk -F'|' '$1=="auth_users"{print $3}' "$OUT") · rls_policies=$(awk -F'|' '$1=="rls_policies"{print $3}' "$OUT")"

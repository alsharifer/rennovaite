#!/usr/bin/env bash
# One query a day against the AuraDB instance over its HTTP Query API, so a
# Free-tier instance never reaches the inactivity pause, and so an unreachable
# KG fails RED here — the app itself falls back to un-grounded prompts without
# a word (lib/kg/context.ts, by design).
#
#   NEO4J_URI=neo4j+s://<id>.databases.neo4j.io NEO4J_USER=… NEO4J_PASSWORD=… \
#   bash scripts/backup-cloud/kg-keepalive.sh
set -euo pipefail
: "${NEO4J_URI:?}"; : "${NEO4J_USER:?}"; : "${NEO4J_PASSWORD:?}"
host="${NEO4J_URI#*://}"; host="${host%%/*}"; host="${host%%:*}"
echo "::add-mask::$host" 2>/dev/null || true
body="$(curl -fsS --max-time 30 -u "$NEO4J_USER:$NEO4J_PASSWORD" \
  -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d '{"statement":"MATCH (n) RETURN count(n) AS nodes"}' \
  "https://$host/db/neo4j/query/v2")"
nodes="$(printf '%s' "$body" | jq -r '.data.values[0][0] // empty')"
[ -n "$nodes" ] || { echo "[kg-keepalive] unexpected reply: $(printf '%s' "$body" | head -c 200)" >&2; exit 1; }
echo "[kg-keepalive] KG reachable — $nodes nodes"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '\n## KG keepalive\nAuraDB reachable — %s nodes\n' "$nodes" >> "$GITHUB_STEP_SUMMARY"
exit 0

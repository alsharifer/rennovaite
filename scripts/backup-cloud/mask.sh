#!/usr/bin/env bash
# GitHub masks a secret's exact value in logs — not its parts. A pg_dump error
# prints host and user separately ("connection to server at ..."), so each part
# of the connection string is registered as its own mask before anything that
# could fail runs. The repository is public; this is not optional.
set -euo pipefail
: "${SUPABASE_DB_URL:?}"
u="${SUPABASE_DB_URL#*://}"
creds="${u%%@*}"
rest="${u#*@}"
user="${creds%%:*}"
pw="${creds#*:}"
host="${rest%%[:/]*}"
ref="${user#postgres.}"
for v in "$pw" "$user" "$host" "$ref"; do
  if [ -n "$v" ] && [ "${#v}" -ge 6 ]; then echo "::add-mask::$v"; fi
done
echo "[mask] connection-string parts masked"

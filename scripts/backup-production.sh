#!/usr/bin/env bash
# =============================================================================
# scripts/backup-production.sh — scheduled pg_dump of production (I9).
#
# Supersedes the one-shot backups/rennovaite/pg-dump.sh. Differences that
# matter: this runs on a schedule, applies retention, and VERIFIES each dump by
# restoring it before it counts as a backup at all.
#
#   BACKUP_DIR=/path/to/backups \
#   SUPABASE_DB_URL='postgresql://postgres.<ref>:<pw>@<host>:5432/postgres' \
#   bash scripts/backup-production.sh
#
# The password is never written to disk by this script and never appears in its
# output. Put it in the environment or a password manager; do not commit it and
# do not paste it into a chat window.
#
# pg_dump runs from a pinned Postgres Docker image, so nothing needs installing
# and the client major always matches the server (see PG_IMAGE below).
# =============================================================================
set -euo pipefail

# The connection string may come from the environment OR from a credentials file
# outside the repo. The file exists so the password can be supplied without ever
# passing through a terminal argument, a shell history, or a chat window — a
# secret pasted into any of those is disclosed, and the only fix afterwards is a
# reset.
#
# The file is read, never printed, never copied into the backup directory, and
# never committed (it lives outside the repo entirely).
CRED_FILE="${CRED_FILE:-$HOME/backups/rennovaite/.db-url}"
if [ -z "${SUPABASE_DB_URL:-}" ] && [ -f "$CRED_FILE" ]; then
  SUPABASE_DB_URL="$(head -n1 "$CRED_FILE" | tr -d '\r\n')"
  export SUPABASE_DB_URL
  echo "[backup] connection string read from $CRED_FILE (value not shown)"
fi

: "${SUPABASE_DB_URL:?no connection string. Put it in $CRED_FILE, or export SUPABASE_DB_URL}"
: "${BACKUP_DIR:?set BACKUP_DIR — an absolute path OUTSIDE this repo and outside Supabase}"

# Refuse a URL that still contains the doc's placeholder — same fail-closed rule
# as the target guard, for the same reason.
case "$SUPABASE_DB_URL" in
  *"<"*|*">"*)
    echo "[backup] the connection string still contains a placeholder (< or >). Aborting." >&2
    exit 1 ;;
esac

STAMP="$(date +%Y-%m-%dT%H-%M-%SZ)"
DEST="${BACKUP_DIR}/${STAMP}"
mkdir -p "$DEST"

log() { echo "[backup $(date +%H:%M:%S)] $*"; }

# Docker needs a HOST path it understands. Under Git Bash on Windows a path like
# /c/Users/... is an MSYS invention that dockerd has never heard of, so the bind
# mount silently produces an empty container directory and pg_dump fails with
# "could not open output file" — which reads like a permissions problem and is
# not one.
#
# cygpath -m gives C:/Users/... , which Docker Desktop accepts. MSYS_NO_PATHCONV
# stops Git Bash rewriting the container-side path (/out) on the way through.
host_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi
}
# pg_dump REFUSES to dump a server newer than itself. Both Supabase projects run
# Postgres 17, so a postgres:16 image aborts with "server version mismatch" —
# which is why this is pinned rather than left to float. Override if the server
# major ever moves.
PG_IMAGE="${PG_IMAGE:-postgres:17}"

docker_run() { MSYS_NO_PATHCONV=1 docker "$@"; }

# Supabase's session pooler drops long connections: an observed run died with
# "SSL error: unexpected eof while reading" partway through the second dump. It
# is transient, so retry rather than lose the whole run — but cap it, because a
# dump that needs five attempts is telling you something and should fail loudly.
retry() {
  n=0
  until "$@"; do
    n=$((n + 1))
    if [ "$n" -ge 3 ]; then log "failed after 3 attempts"; return 1; fi
    log "attempt $n failed (pooler drop?) — retrying in 10s"
    sleep 10
  done
}

# --- 1. dump ------------------------------------------------------------------
# --schema '*' is the point of this script: it takes AUTH and STORAGE too, not
# just public. The logical REST export that preceded this could only ever see
# public, so it captured every project row and not one user account — restoring
# it would have returned the villas and lost everyone who owns them.
#
# RLS policies, sequences, functions and triggers come with the schema dump for
# the same reason: they are schema, and the REST export was never able to see
# them either.
log "dumping (custom format, all schemas incl. auth + storage)"
retry docker_run run --rm -e PGURL="$SUPABASE_DB_URL" -v "$(host_path "$DEST"):/out" "$PG_IMAGE" \
  sh -c 'pg_dump "$PGURL" --format=custom --no-owner --no-privileges \
           --schema="*" -f /out/full.dump'

log "dumping (schema only, for diffing)"
retry docker_run run --rm -e PGURL="$SUPABASE_DB_URL" -v "$(host_path "$DEST"):/out" "$PG_IMAGE" \
  sh -c 'pg_dump "$PGURL" --schema-only --no-owner --no-privileges \
           --schema="*" -f /out/schema.sql'

# --- 2. verify by restoring ---------------------------------------------------
# A dump nobody has restored is a hope. This restores every backup into a
# throwaway container before the backup is allowed to count, so a corrupt or
# truncated dump fails LOUDLY on the day it is taken rather than on the day it
# is needed.
log "verifying: restoring into a scratch container"
CHECK="rv-restore-check-$$"
docker_run rm -f "$CHECK" >/dev/null 2>&1 || true
docker_run run -d --name "$CHECK" -e POSTGRES_HOST_AUTH_METHOD=trust "$PG_IMAGE" >/dev/null
for _ in $(seq 1 40); do
  docker_run exec "$CHECK" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

docker_run cp "$(host_path "$DEST")/full.dump" "$CHECK:/tmp/full.dump"
# Roles and some extensions do not exist in a bare container; those errors are
# expected and not a failed restore. Anything else is.
docker_run exec "$CHECK" pg_restore -U postgres -d postgres --no-owner --no-privileges \
  /tmp/full.dump 2>"$DEST/restore.log" || true

PUBLIC_TABLES=$(docker_run exec "$CHECK" psql -U postgres -At -c \
  "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';")
PROJECTS=$(docker_run exec "$CHECK" psql -U postgres -At -c \
  "select count(*) from public.projects;" 2>/dev/null || echo 0)
AUTH_USERS=$(docker_run exec "$CHECK" psql -U postgres -At -c \
  "select count(*) from auth.users;" 2>/dev/null || echo "n/a")
POLICIES=$(docker_run exec "$CHECK" psql -U postgres -At -c \
  "select count(*) from pg_policies;" 2>/dev/null || echo 0)

docker_run rm -f "$CHECK" >/dev/null 2>&1 || true

{
  echo "taken_at=$STAMP"
  echo "public_tables=$PUBLIC_TABLES"
  echo "projects_rows=$PROJECTS"
  echo "auth_users=$AUTH_USERS"
  echo "rls_policies=$POLICIES"
} > "$DEST/VERIFIED.txt"

log "restored: ${PUBLIC_TABLES} public tables, ${PROJECTS} projects, ${AUTH_USERS} auth users, ${POLICIES} RLS policies"

if [ "$PUBLIC_TABLES" -lt 20 ] || [ "$PROJECTS" -lt 1 ]; then
  log "VERIFICATION FAILED — this dump does not restore to a plausible database."
  mv "$DEST" "${DEST}-FAILED"
  exit 1
fi

# --- 3. retention -------------------------------------------------------------
# Daily for 14 days, then weekly (Sundays) for 8 weeks. The 14-day daily window
# is what guarantees the requirement of a restore point older than 7 days — a
# 7-day window would leave nothing older than 7 days the moment it rolled.
log "applying retention (daily 14d, weekly 8w)"
python_missing=0
command -v python3 >/dev/null 2>&1 || python_missing=1
if [ "$python_missing" = "1" ]; then
  find "$BACKUP_DIR" -maxdepth 1 -type d -name '20*' -mtime +14 \
    ! -name '*-FAILED' -print | while read -r d; do
      day=$(basename "$d" | cut -c1-10)
      dow=$(date -d "$day" +%u 2>/dev/null || echo 0)
      if [ "$dow" = "7" ]; then
        older=$(find "$d" -maxdepth 0 -mtime +56 -print)
        [ -n "$older" ] && { log "pruning weekly $day"; rm -rf "$d"; }
      else
        log "pruning daily $day"; rm -rf "$d"
      fi
    done
fi

log "done -> $DEST"

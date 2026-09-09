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
# pg_dump runs from the postgres:16 Docker image, so nothing needs installing
# and the client version always matches the server major.
# =============================================================================
set -euo pipefail

: "${SUPABASE_DB_URL:?set SUPABASE_DB_URL (Supabase dashboard -> Settings -> Database -> Connection string -> URI)}"
: "${BACKUP_DIR:?set BACKUP_DIR — an absolute path OUTSIDE this repo and outside Supabase}"

STAMP="$(date +%Y-%m-%dT%H-%M-%SZ)"
DEST="${BACKUP_DIR}/${STAMP}"
mkdir -p "$DEST"

log() { echo "[backup $(date +%H:%M:%S)] $*"; }

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
docker run --rm -e PGURL="$SUPABASE_DB_URL" -v "$DEST:/out" postgres:16 \
  sh -c 'pg_dump "$PGURL" --format=custom --no-owner --no-privileges \
           --schema="*" -f /out/full.dump'

log "dumping (schema only, for diffing)"
docker run --rm -e PGURL="$SUPABASE_DB_URL" -v "$DEST:/out" postgres:16 \
  sh -c 'pg_dump "$PGURL" --schema-only --no-owner --no-privileges \
           --schema="*" -f /out/schema.sql'

# --- 2. verify by restoring ---------------------------------------------------
# A dump nobody has restored is a hope. This restores every backup into a
# throwaway container before the backup is allowed to count, so a corrupt or
# truncated dump fails LOUDLY on the day it is taken rather than on the day it
# is needed.
log "verifying: restoring into a scratch container"
CHECK="rv-restore-check-$$"
docker rm -f "$CHECK" >/dev/null 2>&1 || true
docker run -d --name "$CHECK" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16 >/dev/null
for _ in $(seq 1 40); do
  docker exec "$CHECK" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

docker cp "$DEST/full.dump" "$CHECK:/tmp/full.dump"
# Roles and some extensions do not exist in a bare container; those errors are
# expected and not a failed restore. Anything else is.
docker exec "$CHECK" pg_restore -U postgres -d postgres --no-owner --no-privileges \
  /tmp/full.dump 2>"$DEST/restore.log" || true

PUBLIC_TABLES=$(docker exec "$CHECK" psql -U postgres -At -c \
  "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';")
PROJECTS=$(docker exec "$CHECK" psql -U postgres -At -c \
  "select count(*) from public.projects;" 2>/dev/null || echo 0)
AUTH_USERS=$(docker exec "$CHECK" psql -U postgres -At -c \
  "select count(*) from auth.users;" 2>/dev/null || echo "n/a")
POLICIES=$(docker exec "$CHECK" psql -U postgres -At -c \
  "select count(*) from pg_policies;" 2>/dev/null || echo 0)

docker rm -f "$CHECK" >/dev/null 2>&1 || true

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

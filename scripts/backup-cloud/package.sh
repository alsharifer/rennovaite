#!/usr/bin/env bash
# tar + gpg-symmetric (AES-256) one dump directory into a single object.
#
#   BACKUP_ENCRYPTION_KEY=... bash scripts/backup-cloud/package.sh <dump-dir> <out-dir>
#
# gpg symmetric rather than age: gpg is on every runner and every laptop, and
# its passphrase can come from a file descriptor instead of a terminal. The key
# is the ONLY way to read a backup — it is not derivable from anything else in
# this repository or the bucket. Losing it loses every backup taken with it.
set -euo pipefail
: "${BACKUP_ENCRYPTION_KEY:?}"
DUMP_DIR="${1:?dump dir}"; OUT_DIR="${2:?out dir}"
[ "${#BACKUP_ENCRYPTION_KEY}" -ge 24 ] || { echo "[package] BACKUP_ENCRYPTION_KEY is shorter than 24 characters — refusing" >&2; exit 1; }
[ -s "$DUMP_DIR/full.dump" ] || { echo "[package] $DUMP_DIR/full.dump missing or empty" >&2; exit 1; }
[ -s "$DUMP_DIR/counts.txt" ] || { echo "[package] $DUMP_DIR/counts.txt missing — source-counts.sh did not run" >&2; exit 1; }

mkdir -p "$OUT_DIR"
STAMP="$(basename "$DUMP_DIR")"
NAME="rennovaite-${STAMP}.tar.gpg"
TAR="$OUT_DIR/$STAMP.tar.gz"

tar --force-local -C "$(dirname "$DUMP_DIR")" -czf "$TAR" "$STAMP"
printf '%s' "$BACKUP_ENCRYPTION_KEY" | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 0 \
  --symmetric --cipher-algo AES256 --s2k-digest-algo SHA512 --s2k-mode 3 --s2k-count 65011712 \
  -o "$OUT_DIR/$NAME" "$TAR"
rm -f "$TAR"

SHA="$(sha256sum "$OUT_DIR/$NAME" | cut -d' ' -f1)"
printf '%s  %s\n' "$SHA" "$NAME" > "$OUT_DIR/$NAME.sha256"
SIZE="$(du -h "$OUT_DIR/$NAME" | cut -f1)"
echo "[package] $NAME ($SIZE) sha256=$SHA"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  { echo "file=$OUT_DIR/$NAME"; echo "sha256=$SHA"; echo "size=$SIZE"; } >> "$GITHUB_OUTPUT"
fi

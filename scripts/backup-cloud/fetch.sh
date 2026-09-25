#!/usr/bin/env bash
# Download an object FROM THE BUCKET, verify its sha256 against the sidecar,
# decrypt and unpack it. With no key given, takes the newest daily/ object —
# which is what a real restore would do at 03:00 on a bad day.
#
#   BACKUP_ENCRYPTION_KEY=... bash scripts/backup-cloud/fetch.sh [object-key] <work-dir>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=s3env.sh
. "$HERE/s3env.sh"
: "${BACKUP_ENCRYPTION_KEY:?}"
KEY="${1:-}"; WORK="${2:?work dir}"
mkdir -p "$WORK"

if [ -z "$KEY" ]; then
  KEY="$(s3api list-objects-v2 --bucket "$BUCKET" --prefix daily/ --query 'Contents[].Key' --output json \
         | jq -r '[.[] | select(endswith(".tar.gpg"))] | sort | last // empty')"
  [ -n "$KEY" ] || { echo "[fetch] no daily/*.tar.gpg object in the bucket" >&2; exit 1; }
  echo "[fetch] newest object: $KEY"
fi
NAME="$(basename "$KEY")"
s3api get-object --bucket "$BUCKET" --key "$KEY" "$WORK/$NAME" > /dev/null
s3api get-object --bucket "$BUCKET" --key "$KEY.sha256" "$WORK/$NAME.sha256" > /dev/null
(cd "$WORK" && sha256sum -c "$NAME.sha256")

printf '%s' "$BACKUP_ENCRYPTION_KEY" | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 0 \
  --decrypt -o "$WORK/bundle.tar.gz" "$WORK/$NAME"
tar --force-local -C "$WORK" -xzf "$WORK/bundle.tar.gz"
rm -f "$WORK/bundle.tar.gz"
DIR="$(ls -d "$WORK"/20* | head -n1)"
[ -s "$DIR/full.dump" ] || { echo "[fetch] decrypted bundle has no full.dump" >&2; exit 1; }
echo "[fetch] $KEY → $DIR ($(du -h "$DIR/full.dump" | cut -f1) dump)"
[ -n "${GITHUB_OUTPUT:-}" ] && { echo "dir=$DIR"; echo "object_key=$KEY"; } >> "$GITHUB_OUTPUT"

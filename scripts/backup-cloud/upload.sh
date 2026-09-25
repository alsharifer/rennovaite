#!/usr/bin/env bash
# Upload one encrypted object (+ its .sha256 sidecar) to daily/, and to weekly/
# as well when it is Sunday in Dubai. Confirms each upload by HEAD size.
#
#   bash scripts/backup-cloud/upload.sh <file.tar.gpg> <stamp>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=s3env.sh
. "$HERE/s3env.sh"
FILE="${1:?file}"; STAMP="${2:?stamp}"
NAME="$(basename "$FILE")"
[ -s "$FILE" ] && [ -s "$FILE.sha256" ] || { echo "[upload] $FILE or its .sha256 missing" >&2; exit 1; }
LOCAL_SIZE="$(stat -c %s "$FILE")"

put() { # key file
  s3api put-object --bucket "$BUCKET" --key "$1" --body "$2" --content-type application/octet-stream > /dev/null
  remote="$(s3api head-object --bucket "$BUCKET" --key "$1" --query ContentLength --output text)"
  [ "$remote" = "$(stat -c %s "$2")" ] || { echo "[upload] size mismatch for $1: local $(stat -c %s "$2") remote $remote" >&2; exit 1; }
  echo "[upload] $1 ($remote bytes) confirmed"
}

put "daily/$NAME" "$FILE"
put "daily/$NAME.sha256" "$FILE.sha256"
KEYS="daily/$NAME"
if [ "$(TZ=Asia/Dubai date +%u)" = "7" ]; then
  put "weekly/$NAME" "$FILE"
  put "weekly/$NAME.sha256" "$FILE.sha256"
  KEYS="$KEYS weekly/$NAME"
fi
[ -n "${GITHUB_OUTPUT:-}" ] && { echo "object_key=daily/$NAME"; echo "keys=$KEYS"; } >> "$GITHUB_OUTPUT"
echo "[upload] $LOCAL_SIZE bytes → $KEYS"

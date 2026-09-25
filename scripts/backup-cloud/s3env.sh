# Sourced, not run. Turns the BACKUP_STORAGE_* secrets into what aws-cli needs
# to talk to Backblaze B2's S3-compatible endpoint, and defines `s3api`.
#
# The region MUST match the endpoint for SigV4 — B2 endpoints are
# s3.<region>.backblazeb2.com, so it is read off the hostname. The two checksum
# variables are set at workflow level (aws-cli ≥ 2.23 sends CRC checksums B2
# rejects); they are repeated here so the scripts also work from a laptop.
: "${BACKUP_STORAGE_ENDPOINT:?BACKUP_STORAGE_ENDPOINT is required}"
: "${BACKUP_STORAGE_KEY_ID:?BACKUP_STORAGE_KEY_ID is required}"
: "${BACKUP_STORAGE_APP_KEY:?BACKUP_STORAGE_APP_KEY is required}"
: "${BACKUP_STORAGE_BUCKET:?BACKUP_STORAGE_BUCKET is required}"

# The secret may hold a bare hostname (s3.<region>.backblazeb2.com) — that is
# how B2's console shows it, and run #2 (2026-09-25) failed on exactly that:
# aws-cli refuses an --endpoint-url without a scheme. Normalise here rather
# than asking for the secret to be re-entered.
case "$BACKUP_STORAGE_ENDPOINT" in
  http://*|https://*) ;;
  *) BACKUP_STORAGE_ENDPOINT="https://${BACKUP_STORAGE_ENDPOINT}" ;;
esac
BACKUP_STORAGE_ENDPOINT="${BACKUP_STORAGE_ENDPOINT%/}"

export AWS_ACCESS_KEY_ID="$BACKUP_STORAGE_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$BACKUP_STORAGE_APP_KEY"
export AWS_EC2_METADATA_DISABLED=true
export AWS_REQUEST_CHECKSUM_CALCULATION="${AWS_REQUEST_CHECKSUM_CALCULATION:-when_required}"
export AWS_RESPONSE_CHECKSUM_VALIDATION="${AWS_RESPONSE_CHECKSUM_VALIDATION:-when_required}"
export AWS_PAGER=""

_region="$(printf '%s' "$BACKUP_STORAGE_ENDPOINT" | sed -nE 's#^https?://s3\.([a-z0-9-]+)\.backblazeb2\.com/?$#\1#p')"
export AWS_DEFAULT_REGION="${_region:-us-east-1}"

s3api() { aws s3api --endpoint-url "$BACKUP_STORAGE_ENDPOINT" "$@"; }
BUCKET="$BACKUP_STORAGE_BUCKET"

# Object naming — the date in the name is what retention reads, so it is fixed:
#   daily/rennovaite-<YYYY-MM-DDTHH-MM-SSZ>.tar.gpg   (+ .sha256 sidecar)
#   weekly/rennovaite-<same stamp>.tar.gpg            (Sundays, Asia/Dubai)
object_date() { printf '%s' "$1" | sed -nE 's#^.*/rennovaite-([0-9]{4}-[0-9]{2}-[0-9]{2})T.*$#\1#p'; }

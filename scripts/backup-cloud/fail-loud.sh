#!/usr/bin/env bash
# A backup that fails silently is worse than none. On any failed job this opens
# a repository issue (label: backup-failure) pointing at the run, and writes the
# same to the step summary. The repository is public, so the body carries the
# job name and run link only — never a count, a name or an error string.
#
#   GH_TOKEN=... bash scripts/backup-cloud/fail-loud.sh <job-name>
set -euo pipefail
JOB="${1:?job name}"
RUN_URL="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:?}/actions/runs/${GITHUB_RUN_ID:?}"
TITLE="Backup workflow failed: ${JOB} (run #${GITHUB_RUN_NUMBER:-?}, $(date -u +%F))"
BODY="The \`${JOB}\` job of the scheduled backup workflow failed.

Run: ${RUN_URL}

Until this is fixed there is no fresh off-platform backup. See docs/OPS_RUNBOOK.md → Backups → When the workflow fails."

gh label create backup-failure --color B60205 --description "The scheduled backup workflow failed" --force > /dev/null 2>&1 || true
url="$(gh issue create --repo "$GITHUB_REPOSITORY" --title "$TITLE" --body "$BODY" --label backup-failure)"
echo "[fail-loud] opened $url"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '\n## ❌ %s failed — issue: %s\n' "$JOB" "$url" >> "$GITHUB_STEP_SUMMARY"
exit 0

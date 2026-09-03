# Post-demo follow-ups

Deliberately **not** actioned during the Sprint-2 deploy (partner demo, 2026-09-04).
Each was a conscious deferral, not an oversight. Do these after the demo.

## 1. `.claude/` local config is tracked and shouldn't be

`.claude/settings.local.json` and `.claude/launch.json` are **tracked in git and not
ignored** — only `/.claude/worktrees` is in `.gitignore`. They are per-machine config
(tool permission grants, local dev-server launch definitions) and carry no value for
anyone else; `settings.local.json` in particular churns constantly as permissions are
granted.

**Fix:** `git rm --cached .claude/settings.local.json .claude/launch.json`, then add
`/.claude/settings.local.json` and `/.claude/launch.json` to `.gitignore`.

**Why not tonight:** untracking files touched by the release would have muddied the
release diff for no demo benefit.

## 2. `.gitattributes` line-ending normalisation

The repo has no `.gitattributes`, so line endings are whatever each machine produces.
This is invisible on Windows but shows up as ~185 "modified" files with a ~42k-line
whitespace diff when the same repo is read through a Linux mount (e.g. a Cowork
session), which is how the pre-deploy audit was initially misread.

**Fix:** add a `.gitattributes` with `* text=auto eol=lf` (plus `-text` for the binary
paths — `*.png`, `*.pdf`, `*.xlsx`, `*.webp`, `*.jpg`), then run
`git add --renormalize .` as a **single dedicated commit** on a quiet day.

**Why not tonight:** a 42k-line whitespace commit hours before a demo is not a risk
worth taking, and it would have buried the eight feature commits in the PR diff.

## 3. Merge the lucide → Material Symbols conversion

`CLAUDE.md` mandates Material Symbols and forbids `lucide-react` in new code, but the
app still **ships two icon sets**: `lucide-react` imports remain in at least
`app/project/[id]/boq/_components/generate-boq-button.tsx`,
`app/project/[id]/plan/_components/editable-plan-viewer.tsx`,
`app/project/[id]/plan/_components/editable-project-name.tsx`,
`components/back-button.tsx` and several `components/ui/*` primitives.

The conversion already exists on **`claude/priceless-jones-bb887c`** (commit
`7925644 refactor: convert remaining lucide icons to Material Symbols + fix dead
tokens (VP6)`, plus related VP4–VP10 commits). That branch also carries
`scripts/backfill-renders.ts` (328 lines, re-hosting hero renders), which is **not on
master** and is worth keeping.

**Caveat:** the branch was 86 commits behind `master` at the time of the Sprint-2
deploy, so this is a real merge with real conflict surface — give it a proper session.
Note that its `fix: re-host Replicate renders` commit is already **superseded**:
master has `rehostImage` in `lib/render-storage`, wired into `/api/render/status`.

**Why not tonight:** merging a branch 86 commits behind, the night before a demo,
against the whole point of the exercise.

## 4. Re-enable KG grounding

`KG_ENABLED` was set to `false` in Vercel production for the demo, because Neo4j runs
only in local Docker on the founder's PC and an unreachable KG costs a **10-second
timeout per render call** before its silent fallback.

Note for whoever picks this up: **BoQ generation never touches KG on the default
path** — the deterministic engine branch in `app/api/generate-boq/route.ts` returns at
line ~768, while `getKgContext` is at ~783, so it is unreachable unless
`BOQ_ENGINE="llm"`. Only the **render** path (`app/api/render/route.ts`) grounds.

**Fix:** host Neo4j somewhere reachable from Vercel (Aura, or a small VM), set
`NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD` in production, then flip `KG_ENABLED`
back to `true`. Until then, leaving it off costs nothing but render grounding.

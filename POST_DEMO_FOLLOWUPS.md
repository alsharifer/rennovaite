# Post-demo follow-ups

## 0. Production has no backups — due diligence, and it has no undo

**Priority item.** As of 2026-09-05 the production Supabase project has no
verified backup configured, and because development shares that same project
(see `docs/DEV_PROD_SEPARATION.md`), a bad development write against production
has **no undo at all**. An investor will ask about this, and today the honest
answer is bad.

Two things need doing, and they are separate:

**Automated, platform-side.** Confirm in the Supabase dashboard
(Settings → Database → Backups) what the current plan actually provides. The
shape of the offering is: the **Free** tier has no automated backups; **Pro**
adds daily backups with roughly a week of retention; **point-in-time recovery**
is a paid add-on above that. Those tiers and prices change, so read the
dashboard rather than trusting this paragraph — the point is that *whatever it
says today, nobody has looked*. If the project is on Free, that is the finding.

**Manual, and already started.** A logical export exists at
`C:\Users\alsha\backups\rennovaite\<timestamp>\` — 29 table JSON files
(1,781 rows) plus a storage-bucket manifest. Its restore has been **verified**:
migrations 001–029 replay cleanly onto vanilla Postgres 16 and the data loads
back with "Mudon pilot villa" and all of its rows intact.

Known limits of that export, which is why it is a stopgap and not the answer:
  · It is **not a `pg_dump`** — no sequences, functions, triggers, RLS policies,
    or anything created ad hoc in the SQL editor. A true dump needs the database
    password (Settings → Database → Connection string), which is not in
    `.env.local`; the service-role JWT cannot produce one.
  · The storage manifest **lists** objects, it does not copy their bytes. The
    floorplans and renders themselves are not backed up.
  · It lives on one laptop. That is off-platform, but it is not offsite.
  · It is a point-in-time snapshot taken by hand, not a schedule.

**Also check while in there: region and data residency.** The project's region
has never been confirmed, and for a Dubai product handling client floorplans and
contracts it is a question that will be asked alongside backups.



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

## 4. B3 taste-seed stays OFF — references override the room

`TASTE_SEED_ENABLED` was trialled on 2026-09-05 and **left off**. It was never
enabled in production.

**Test.** Mudon master bedroom, style `luxe-minimal`, board of three
Contemporary Majlis style images (deliberately contrasting, to make any effect
legible). Identical source photo, model (`google/nano-banana`) and mode
(`photo`) on both sides — the only variable was the flag.

**What worked.** The prompt assembles exactly as designed: one new `References:`
block between the style prompt and the STAGING block, nothing displaced, the
"Do not copy their layout or furniture placement" guardrail present.
`renders.reference_refs` recorded all three moodboard item ids and they resolve
back to the exact style images. The palette transferred — the conditioned render
is convincingly walnut-and-brass.

**Why it is off anyway.** The conditioned render is **not the same room**. The
source is a narrow bedroom shot from a corner, with two arched windows on the
right wall looking onto the neighbouring villa. The conditioned output is a
wide, symmetrical room shot head-on, with the arched windows moved to flank a
walnut slat feature wall behind the bed, and a city skyline outside. Output
aspect even changed, 1344×768 → 1024×1024.

The prompt was not the problem — it says "Keep the room's architecture, wall
positions, window and door locations, and camera angle exactly the same". The
IMAGES are. Three full-scene references at equal weight to the source photo
overwhelm that instruction. For a product whose promise is "this is *your*
villa", inventing a different room is a worse failure than losing the palette
benefit.

**What would make it shippable**, roughly in order of cost:
  · Send fewer references — one, not three — and re-test.
  · Crop references to material/palette swatches rather than whole rooms, so
    there is no competing composition to copy.
  · Check whether the edit model supports per-image weighting, and weight the
    source photo far above the references.
  · Only seed the off-plan path (`mode="offplan"`), where there is no real room
    to preserve and a reference cannot destroy anything.

The code, migration and lineage are all shipped and correct; only the flag is
off. Re-testing is a flag flip plus one render.

## 5. Re-enable KG grounding

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

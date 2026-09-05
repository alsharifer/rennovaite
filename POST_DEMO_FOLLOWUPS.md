# Post-demo follow-ups

## 0. Backups: a verified manual snapshot, no automation, and no auth-schema dump

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

**Manual, and done — with one gap left.** A verified off-platform snapshot lives
at `C:\Users\alsha\backups\rennovaite\<timestamp>\`:

  · `tables/` — 29 table JSON files (1,767 rows as of 2026-09-05, after the one
    deletion; the earlier 16-11-14 snapshot holds 1,781 and is the pre-deletion
    copy).
  · `storage/` — the actual BYTES of all 70 storage objects, 101.4 MB across
    `moodboards`, `plan-uploads`, `renders` and the private `drawings` bucket,
    with a sha256 per object in `storage-manifest.json`. An earlier pass only
    listed these; floorplans and renders are the one class of data here that
    cannot be regenerated, so listing them was not a backup.

**Restore verified**, not assumed: migrations 001–030 replay cleanly onto a
vanilla Postgres 16 container (30/30) and all 1,767 rows reload, with "Mudon
pilot villa" returning at 13 rooms and 31 renders. The 70 storage files were
checked by magic bytes — 67 images/PDFs and 3 SVG drawing sheets, no truncated
downloads and no error pages saved as files.

**The remaining gap is the dump itself.** This is still NOT a `pg_dump`: no
sequences, functions, triggers, RLS policies or grants, and nothing created ad
hoc in the SQL editor. That needs the database password (Supabase dashboard →
Settings → Database → Connection string), which is not in `.env.local` and
cannot be derived from the service-role JWT. `backups/rennovaite/pg-dump.sh`
is written and ready — it runs `pg_dump` out of the `postgres:16` Docker image,
so nothing needs installing; it only needs `SUPABASE_DB_URL` exported. Until
that is run, the snapshot is data-only.

It also still lives on one laptop — off-platform, but not offsite — and it is a
point-in-time copy taken by hand, not a schedule.

**The auth schema is NOT captured, and that is why the dump is required.**
`auth.users` is managed by Supabase, is created by no numbered migration, and
PostgREST refuses the schema outright (`PGRST106: Only the following schemas are
exposed: public, graphql_public`). The logical export therefore contains none of
it. `auth-users.json` in each snapshot now captures the identities via the Auth
admin API — but that endpoint does **not** return `encrypted_password`, so it
restores who existed, not their ability to log in. Everyone would need a reset.

How bad that is, precisely, today: there is **one** account
(`alsharifer@gmail.com`, created 2026-05-19, email provider) and **nothing in
`public` references it** — no table has a `user_id` foreign key, `projects` has
no owner column, and the one bare `feedback_events.user_id` uuid is null in all
23 rows. So a restore today returns every project intact and loses one login.
That is survivable exactly once, and stops being survivable the moment projects
gain an owner.

**RLS and hand-made objects — checked, and clean.** Migrations explicitly
`disable row level security` on every table and create **no** policies,
functions or triggers. Cross-checking PostgREST's live schema against the
migrations found **29 live tables and 29 declared, with no ad-hoc table in
either direction** — so nothing was created in the SQL editor outside version
control. Policies and functions cannot be enumerated through the REST API at
all, so "none exist" is inference from the migrations plus the table match, not
proof. Only a `pg_dump` proves it.

**Verdict: the dump is required, not optional.** It is the only thing that
captures auth credentials, sequences, functions, triggers, policies and grants.

**Off-machine copy — done.** Both snapshots are mirrored to
`C:\Users\alsha\OneDrive\Documents\rennovaite-backups\`, which syncs off the
laptop. All 70 storage objects re-verified there by sha256 against the manifest:
70 matched, 0 mismatched, 0 missing. A `README.txt` in that folder marks it as
customer data — not to be shared, linked or committed. Consider moving it into
OneDrive Personal Vault, which is encrypted at rest.

**Cadence — this is a snapshot, not a backup.** It is stale the moment anything
writes. Supabase's own documented tiers (read 2026-09-05):

| Plan | Daily backups | Retention | PITR add-on |
| --- | --- | --- | --- |
| Free | **none** | — | not available |
| Pro | yes | 7 days | ~$100/mo (7-day) |
| Team | yes | 14 days | ~$200/mo (14-day) |
| Enterprise | yes | up to 30 days | ~$400/mo (28-day) |

Supabase explicitly tells Free-tier projects to export their own data and keep
off-site copies, which is what the snapshot above is. Enabling PITR **replaces**
daily backups rather than adding to them, and requires at least a Small compute
add-on.

**Which tier this project is actually on is still unanswered** — it cannot be
read through the service-role key or the Vercel env, only from the dashboard
(Settings → Database → Backups). Read it and record the answer here: tier,
whether daily backups are listed, the retention shown, and the PITR quote if
it is offered. If it says Free, that is the finding, and the manual snapshot is
the only backup that exists.

### Ritual — run before any destructive operation

Until automated backups are confirmed on, this is a rule, not a memory. A
"destructive operation" is any delete, any `update` touching rows you did not
just create, any migration that drops or alters a column, and any script run
against production with a `DELETE`/`UPDATE` verb in it.

1. Take a fresh snapshot — table export **and** storage bytes **and**
   `auth-users.json`. A snapshot older than the last write is not an undo.
2. Verify the restore, do not assume it: replay the migrations onto a scratch
   Postgres container and reload the rows. Confirm a known project returns with
   its child-row counts.
3. Copy it off the machine and verify the copy by hash, not by file count.
4. Count the exact rows the operation will affect, and state the number, before
   running it.
5. Only then run it — and re-count afterwards to prove the blast radius matched.

Steps 1–3 are what `4a` did. Step 4 is what caught that the "13 rows" figure
was actually 14. Skipping step 5 is how a cascade goes unnoticed.

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

## 6. Overlap census at the time the 409 shipped

Recorded so it is not lost once the scratch projects are archived and the number
silently becomes zero.

On 2026-09-05, when the `plan_has_overlaps` gate shipped, **6 of 7 plans in the
database carried overlapping rooms**, between 3 and 8 pairs each:

| Project | Overlapping pairs |
| --- | --- |
| `3793a5af` Untitled | 8 |
| `c41c6189` Untitled | 6 |
| `9512695f` Untitled | 6 |
| `e44956f2` Untitled | 5 |
| `e4b66381` Untitled | 4 |
| `0089e18a` Untitled | 3 |
| `6b5fda9d` **Mudon pilot villa** | **0** |

Every affected plan is a scratch parse predating the editor's overlap repair, so
the blast radius of the gate is contained — no named project is blocked from
costing. But the census is the reason the gate was worth shipping rather than a
reason it wasn't: the failure mode it prevents was present in 86% of plans, and
a BoQ generated from any of them would have double-counted floor and wall area
while looking like a finished price.

None were auto-fixed. Repair is a user action in the plan editor, and it moves
rooms apart without reshaping them, so area — and therefore every BoQ quantity —
is preserved.

The gate was verified against production on 2026-09-05: `POST /api/generate-boq`
for `e44956f2` returned **409 `plan_has_overlaps`** naming all 7 rooms, and row
counts across `boqs`, `takeoff_items`, `feedback_events`, `boq_outcomes`,
`approved_designs`, `whatif_scenarios`, `plans`, `rooms` and `renders` were
byte-identical before and after.

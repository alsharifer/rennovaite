# Platform status — O0–O4 (2026-09-09)

| Item | Status |
| --- | --- |
| **O0** Baseline | ✅ Done |
| **O1** Migration runner (I7) | ✅ Done |
| **O2** Dev/prod separation (I8) | ⛔ **Blocked on Abdallah** — code built |
| **O3** Production backups (I9) | ⛔ **Blocked on Abdallah** — script built |
| **O4** Route boundaries (I10) | ✅ Done |

Gates at every commit: `tsc` clean · `eslint` 0 errors (1 pre-existing font
warning) · **359 tests** · build green.

---

## O0 — Baseline ✅

Green on arrival. Two facts had moved since the addendum, both now corrected in
`SPRINT_ADDENDUM.md`:

- High-water mark **026 → 030**, and **029 is the single unapplied migration**.
  `plans.has_overlaps` does not exist in production; 030 was applied out of
  order ahead of it.
- `TEXTURED_WALKTHROUGH` now exists in Vercel production and locally.

One correction carried forward: an earlier probe called 027 partially applied
because it selected `project_briefs.id`, and that table has no `id` column — its
key is `project_id`. Through PostgREST a missing column and a missing table look
identical, so probe a column the migration actually creates.

## O1 — Migration runner ✅

30 files converted to `supabase/migrations/`. **Verified from zero:** all 30
applied in order into a scratch Postgres 16 — 30/30, no failures — then diffed
column-by-column against production:

```
shadow: 29 tables, 257 columns
tables in shadow, absent in production : none
columns in shadow, absent in production: plans.has_overlaps,
                                         plans.overlap_pairs,
                                         plans.overlaps_checked_at
```

Those three **are** migration 029. The diff is the outstanding migration and
nothing else.

**Two guards, for two different failures.** The CLI ledger stops a version
running twice. It cannot see a file *edited* after it ran — the version is
unchanged, so databases that already applied it keep the old statements while
the repo shows new ones, and they drift apart permanently.
`supabase/migrations.manifest.json` holds a sha256 per file;
`scripts/check-migrations.mjs` fails on any edit or deletion and runs with the
suite. Verified by editing a migration: it fails and names the file.

**Manual SQL is gone as an instruction** from `CLAUDE.md`,
`PILOT_SEVEN_DEPLOY.md`, `PILOT_SEVEN_STATUS.md` and
`RENDER_UPGRADE_PLAYBOOK.md`. `scripts/migrations/` is frozen with a README and
per-file OBSOLETE banners — kept because it is the only record of how production
was actually built.

**Known limit, stated in `docs/MIGRATIONS.md`:** PostgREST cannot enumerate a
schema, so objects existing in production but in no migration are invisible to
the diff. Closing that needs `pg_dump --schema-only` → the database password →
I9.

## O2 — Dev/prod separation ⛔ blocked

Executed `docs/DEV_PROD_SEPARATION.md` rather than redesigning it. Full detail
and the verbatim steps: **`docs/I8_EXECUTION_STATUS.md`**.

### Abdallah must do this

1. **Create the `rennovaite-dev` Supabase project.** Same region as production
   (check Settings → General first). **Save the database password** — I9 needs
   it too and it can only be reset, never recovered.
2. **Copy three values** from the new project's Settings → API into `.env.local`:
   Project URL → `NEXT_PUBLIC_SUPABASE_URL`, anon key →
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, service_role key →
   `SUPABASE_SERVICE_ROLE_KEY`. Production's values must not remain there.
3. **Create three storage buckets:** `plan-uploads` (public), `renders`
   (public), `drawings` (**private** — the code stores signed URLs, so a public
   drawings bucket makes them pointless).
4. **Vercel → Settings → Environment Variables:** add the same three as
   **Preview**-scoped, pointing at dev. Leave Production untouched. *This is the
   half that protects live data day to day — today every PR preview reads and
   writes production.*

Then tell me, and I will run the migrations, seeds and drift check against dev
and verify the app boots end to end.

### Built and committed

`scripts/_target-guard.mjs` (prints the target ref, **refuses production**
unless `ALLOW_PROD_WRITE=1`; production's ref hard-coded, since a guard reading
its limit from the environment it guards protects nothing) ·
`scripts/seed-dev-demo.mjs` · `scripts/check-schema-drift.mjs` ·
`.env.local.example` rewritten to lead with which database it points at.

Verified firing today:

```
[demo] target: !! PRODUCTION (efrcgktrlsjnzkzzuhof) !!
[demo] REFUSING TO WRITE TO PRODUCTION.
```

### Deviations from the proposal

1. **The demo seed copies no commercial data.** The proposal recommended
   exporting the Mudon rows into dev under the same id. Those rows carry Atrium,
   Global Creation, Laspinas and RAK quotations, contract totals and discount
   percentages held under a client relationship — and a dev database is what
   people point throwaway branches at and hand to a contractor to debug.
   Geometry is real, prices are catalogue-only, quotations absent. The project
   **id** still matches so hard-coded references keep working; an id is not
   commercial data. **`seed-rate-book-actuals.ts` must never run against dev.**
2. **Migrations reach dev by `supabase db push`,** not a hand replay — I7 landed
   first, so the proposal's "expect drift" becomes a checked condition.
3. **The drift check reads the migrations, not `information_schema`** — PostgREST
   does not expose it and there is no DB password yet. Stated in the script's
   own header.
4. **029 is unapplied in production,** so dev built from all 30 will differ until
   `supabase db push` runs against prod. Additive and safe.

## O3 — Production backups ⛔ blocked

`scripts/backup-production.sh` + `docs/BACKUPS.md`.

**The gap in what existed:** PostgREST only exposes `public`, so the previous
REST export captured every project row and **not one user account** — restoring
it would have returned the villas and lost everyone who owns them. No RLS
policies, sequences, functions or triggers either.

The new script dumps `--schema='*'` (auth and storage included) and **restores
every dump into a throwaway container before it counts as a backup**, recording
public tables, project rows, **auth users** and **RLS policies** in
`VERIFIED.txt`. An implausible dump is renamed `-FAILED` and exits non-zero.

| | |
| --- | --- |
| Cadence | Daily, 03:00 |
| Retention | Daily 14 days, then weekly 8 weeks |
| Oldest restore point | ~56 days |
| Cost | **AED 0** — ~4 MB/dump, ~90 MB steady state |

The 14-day daily window is deliberate: a 7-day window meets "older than 7 days"
on paper and leaves nothing older than 7 days the moment it rolls.

### Abdallah must do this

1. **The database password** — Settings → Database → Connection string → URI.
   Export `SUPABASE_DB_URL` in your own shell. **Do not paste it into a chat
   window.**
2. **Choose where backups live.** Default proposed: **OneDrive**
   (`$HOME/OneDrive/rennovaite-backups`) — already syncing, private, free, and
   it gets dumps off the laptop today. It is a default, not the right long-term
   answer: personal account, customer data. Alternatives priced in
   `docs/BACKUPS.md` (Cloudflare R2 / Backblaze B2 ≈ AED 1/month; second disk,
   not offsite).

### Not done

**The restore test is the deliverable and it is not complete.** I9 asks for a
restore into the dev project from I8, which does not exist. The per-run
container restore proves the dump is readable and complete; it is not the same
as proving it restores into a live Supabase project.

## O4 — Route boundaries ✅

One shared implementation, `components/app/boundaries.tsx`; every boundary file
is three lines. Root `error`/`global-error`/`not-found`, project-scoped
`error`/`not-found`, and **15 loading skeletons** shaped to the page arriving.

**The part that was not adding files:** five pages never called `notFound()` —
they rendered their own bare sentence, so a shared boundary would never have
applied. Two printed the raw project UUID at the user
(`Project 11111111-…-555555555555 not found.`). `boq`, hub, `plan`, `render` and
`vendors` now call `notFound()`. Adding the files alone would have looked
complete while leaving the 404 a user is most likely to hit — a stale project
link — exactly as it was.

Money-path routes say the figures are unchanged, because there the first fear is
"have I lost my work" and the answer is no. Errors log with route context. No
stack traces reach users; the digest is shown as support's handle.

Verified by forcing a real error and a real 404 on three routes including the
money path — `screenshots/ops-hardening/README.md`.

---

## Open, not blocked

- ~~**PR #42**~~ — merged. No open PRs remain.
- ~~**Migration 029** unapplied~~ — **applied 2026-09-09** via `supabase db
  push`, the first migration in this project applied by the runner rather than
  by hand. Re-verified: a shadow database built from all 30 migrations now
  differs from production in **nothing** (29 tables, 257 columns, zero drift).
- **`/privacy` and `/terms`** are honest stubs and need real legal drafting.
- **Screenshot directories** hold text records, not PNGs — the preview pane
  returns images to the conversation, and adding a headless browser for this was
  not a call to make unasked.

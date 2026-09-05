# Separating development from production

**Status: proposal. Nothing here has been implemented.**
Written 2026-09-05, after the Sprint-2 deploy established that production and
development share one Supabase project.

---

## The problem, precisely

`.env.local` and Vercel Production both point at Supabase project
`efrcgktrlsjnzkzzuhof`. There is no second database anywhere. Consequences
already observed, not hypothetical:

- Every migration run during development was, by definition, run against
  production. 026/027/028 were "already applied" when the deploy needed them
  because development had applied them to the live database weeks earlier.
- Development test data is live. As of today the production project list shows
  **six "Untitled" scratch plans** and a project literally named **"B1B2B3
  verification villa"**, all created by development activity.
- Test renders consumed live Replicate credits and are stored in the live
  bucket.
- A destructive development mistake — a bad `DELETE`, a careless reseed — has
  no blast radius limit. `scripts/seed-accessory-catalog.ts` already contains a
  delete-then-insert fallback that clears `accessory_catalog` wholesale.
- Preview deployments (every PR) also read and write production data.

The risk is not that this *might* cause a problem. It is that the only reason
it has not caused a serious one is that a single person has been doing the
development.

---

## Options

### A. Supabase branching (paid feature)

Supabase's branching creates an ephemeral database per git branch, seeded from
migrations, torn down when the branch merges.

**For:** purpose-built for exactly this; preview deploys get their own database
automatically; migrations are applied by the platform from a `supabase/`
migrations directory.
**Against:** requires the Pro plan and, more importantly, requires adopting the
Supabase CLI migration format. This repo has **no migration runner** — 29 hand-
numbered `.sql` files applied by pasting into the SQL editor. Branching is not
usable until that changes, which makes A a consequence of doing the migration-
runner work rather than an alternative to it.
**Effort:** 1–2 days, most of it migrating 029 files into CLI format and proving
they replay from empty.

### B. A second Supabase project for development ← **recommended**

Create `rennovaite-dev` as a separate free-tier Supabase project. Local
`.env.local` points at it; Vercel Production keeps the current project.

**For:** the smallest change that removes the whole class of risk. No new
tooling, no format migration, works with the existing paste-the-SQL workflow.
Free tier is ample for development volume.
**Against:** migrations must be applied **twice**, by hand, and the two schemas
can drift silently. That is the real cost and it needs a guard (see below).
**Effort:** half a day, plus seeding.

### C. Local Postgres / `supabase start`

Run the whole stack locally in Docker.

**For:** fastest iteration, zero cloud cost, no possibility of touching
production.
**Against:** Storage and Auth need local equivalents and diverge from hosted
behaviour; the KG Neo4j container already runs locally and a second stack adds
weight; and the team is one person on Windows, where Docker friction is real.
Renders still hit live Replicate regardless.
**Effort:** 1 day, and ongoing maintenance.

**Recommendation: B now, A later.** B removes the risk this week without
blocking on a migration-runner project. Revisit A when the runner exists —
at which point B's schemas can be replayed into branches from the same files.

---

## What changes, concretely (option B)

### Environment variables

| Variable | Local `.env.local` | Vercel Preview | Vercel Production |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **dev project** | **dev project** | prod (unchanged) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **dev** | **dev** | prod (unchanged) |
| `SUPABASE_SERVICE_ROLE_KEY` | **dev** | **dev** | prod (unchanged) |
| everything else | unchanged | unchanged | unchanged |

Pointing **Preview** at dev is the half of this that actually protects the live
data day to day — today every PR preview reads and writes production.

`REPLICATE_API_TOKEN` and `ANTHROPIC_API_KEY` stay shared: they are metered, not
stateful, and splitting them buys nothing.

### Migrations

Both databases must receive every `scripts/migrations/*.sql`. With no runner
this is manual and therefore will drift. Two mitigations, in order of value:

1. **A schema-diff check.** A script that reads `information_schema` from both
   projects and fails when tables or columns differ. Run it in CI or before any
   deploy. Perhaps two hours of work and it converts silent drift into a loud
   error — worth doing on day one.
2. **A `schema_migrations` table** recording which files have been applied to
   the database being pointed at, so `applied` is queryable rather than
   remembered. This is the first step toward option A.

Order for a new migration becomes: apply to dev → verify → apply to prod →
deploy code. Today's order is: apply once → deploy, which only works because
there is one database.

### Storage buckets

`plan-uploads` (public), `renders` (public) and `drawings` (private) must be
recreated in the dev project, with matching public/private settings — the
drawings bucket being private is load-bearing, since the code stores signed
URLs. Existing objects do **not** need copying; dev can start empty and
regenerate.

### Auth

Auth is currently barely used — RLS is disabled on every table and all access is
via the service role. So dev needs the Supabase Auth provider enabled and the
redirect URL pointed at `localhost:3091`, and nothing else. **This gets harder
later**: once RLS lands, dev and prod will need matching policies, and the
schema-diff check above should be extended to cover policies at that point.

### Seed data for dev

Existing scripts cover most of it and are already idempotent:
`seed-labour-rates.ts`, `seed-pricing.ts` (600 SKUs), `seed-rate-book.ts`,
`seed-rate-book-actuals.ts`, `seed-accessory-catalog.ts`,
`seed-furniture-prices.ts`.

Missing is a **demo project**. Mudon is the canonical fixture and its id
(`6b5fda9d-…`) is hard-coded in `scripts/record-boq-outcome.ts`,
`scripts/verify-graph-integrity.ts` and the test fixtures. Options: export the
Mudon rows and re-import them into dev under the **same id** (preserves every
hard-coded reference — recommended), or add a `seed-demo-project.ts` that builds
it from `lib/boq/fixtures/mudon-first-floor.ts`. The first is a couple of hours;
the second is cleaner and half a day.

---

## What could take the live site down

Ranked by likelihood, since this is the part worth being careful about.

1. **Pointing Production at the dev database by mistake.** Instant, total data
   loss from the user's perspective — the site would come up empty. *Mitigation:
   change Preview and local first, leave Production untouched entirely, and
   verify by loading `/project/6b5fda9d-…` and seeing "Mudon pilot villa" before
   and after each step.*
2. **A partially-migrated dev database.** Not a production outage, but every
   preview deploy starts 500ing and the cause looks like a code bug. *Mitigation:
   the schema-diff check, run before the switch.*
3. **Missing storage buckets in dev.** Uploads and drawing generation fail in
   preview only. *Mitigation: create all three buckets before switching.*
4. **Rotating or regenerating the production service-role key while wiring dev.**
   Would break production immediately. *Mitigation: never touch the prod
   project's settings during this work; only add new variables.*

Production is **not** modified by option B at all. Every step happens in a new
project plus local and Preview environment variables. That is what makes it the
safe choice.

---

## Order of operations

1. Create the `rennovaite-dev` Supabase project. *(prod untouched)*
2. Apply `scripts/migrations/001…029` to it, in order.
3. Create the three storage buckets with matching visibility.
4. Run the seed scripts against dev.
5. Import the Mudon demo project under its existing id.
6. Write the schema-diff script; confirm dev and prod match.
7. Point **local `.env.local`** at dev. Work for a day; confirm nothing is
   missing.
8. Point **Vercel Preview** at dev. Open a throwaway PR and confirm the preview
   builds and reads dev.
9. Leave **Production** exactly as it is.
10. Delete the scratch projects from production (separately — see the deletion
    list in the Phase 4 report).

Steps 1–6 are reversible and invisible to production. Step 7 is reversible in
one edit. Step 8 is the first change anything outside this machine can see, and
it affects previews only.

**Estimated effort: half a day for steps 1–5, two hours for step 6, a day of
ordinary work to shake out step 7.** Call it two days total, none of which needs
production downtime.

---

## What this does not fix

- **Replicate and Anthropic calls still cost real money from dev**, and renders
  still land in whichever storage bucket the environment points at. Dev renders
  would fill the dev bucket, which is the desired outcome, but the spend is
  shared. A separate Replicate token with its own budget would fix the
  accounting if that becomes a concern.
- **The KG (Neo4j) is still a single local container** on one machine. Separate
  issue, tracked in `POST_DEMO_FOLLOWUPS.md`.
- **No backups are configured** on the production project. Worth doing
  independently of this work, and arguably more urgent: today a bad development
  write against production has no undo at all.

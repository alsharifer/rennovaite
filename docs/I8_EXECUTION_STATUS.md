# I8 — dev/prod separation: execution status

Executing `docs/DEV_PROD_SEPARATION.md`, not redesigning it. This records what
is built, what is blocked, and where I departed from the proposal and why.

## Blocked on Abdallah — everything below step 1 waits on this

The proposal's step 1 is *"Create the `rennovaite-dev` Supabase project"*. That
cannot be done from here and nothing after it can be verified without it. The
code that does not need the project is written, tested and committed; the steps
that do are printed below verbatim.

### What you need to do

**1 — Create the dev Supabase project**

- <https://supabase.com/dashboard> → **New project**
- Organisation: the one holding `rennovaite`
- Name: **`rennovaite-dev`**
- Database password: generate one and **save it in your password manager** —
  it is also what I9 needs for `pg_dump`, and it cannot be recovered later,
  only reset
- Region: **the same region as production.** Check production's region first
  (Settings → General); a different region changes data-residency answers and
  makes latency comparisons meaningless
- Plan: Free is sufficient for dev

**2 — Copy three values** from Settings → API of the NEW project:

| Value | Where it goes |
| --- | --- |
| Project URL (`https://<ref>.supabase.co`) | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` public key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` secret key | `SUPABASE_SERVICE_ROLE_KEY` |

Paste them into your local `.env.local`, replacing the production values.
**Production's values must not remain in `.env.local`.**

**3 — Create three storage buckets** in the dev project (Storage → New bucket).
The visibility is load-bearing — `drawings` is private because the code stores
signed URLs, and a public `drawings` bucket would make them pointless:

| Bucket | Public? |
| --- | --- |
| `plan-uploads` | **public** |
| `renders` | **public** |
| `drawings` | **private** |

**4 — Point Vercel Preview at dev.** Vercel → project → Settings → Environment
Variables.

> Corrected 2026-09-09. This step previously read "add a Preview-scoped value",
> which does not work: all three variables currently exist as a SINGLE entry
> scoped to `Production, Preview, Development`, and Vercel rejects a second
> entry claiming an environment the first already holds. The existing entry has
> to be narrowed first.

For each of `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY`, **in this order**:

**A. Narrow the existing entry to Production only**
1. Find the row — it shows `Production, Preview, Development`
2. `⋯` → **Edit**
3. Untick **Preview** and **Development**; leave **Production** ticked
4. Save. The value is not edited — only its scope.

**B. Add a second entry for dev**
1. **Add New** → same variable name
2. Value: the **dev** project's (the same one going into `.env.local`)
3. Tick **Preview** and **Development**; leave Production unticked
4. Save

You end with two rows per variable: Production holding prod, Preview+Development
holding dev. Doing B before A is rejected as a scope conflict.

**Env changes only affect NEW deployments** — existing previews keep the old
values until redeployed. Open a throwaway PR afterwards and confirm the preview
builds and reads dev.

This is the half that protects live data day to day: today every PR preview
reads and writes production.

> This is the half that protects live data day to day: today every PR preview
> reads and writes production.

**5 — Tell me when those are done** and I will run the migrations, the seeds and
the drift check against dev, and verify the app boots end-to-end.

## Built and committed (no dev project required)

| Piece | What it does |
| --- | --- |
| `scripts/_target-guard.mjs` | Resolves the target project ref, prints it before any write, and **refuses production** unless `ALLOW_PROD_WRITE=1`. Production's ref is hard-coded — a guard that reads its own limit from the environment it guards protects nothing. |
| `scripts/seed-dev-demo.mjs` | Seeds a demo project, plan and 13 rooms into dev from the committed plan fixture. Idempotent. |
| `scripts/check-schema-drift.mjs` | Compares dev and prod against the migrations, read-only, no data crossing between them. |
| `.env.local.example` | Leads with which database the variables point at, and the prod ref that must never appear locally. |
| `supabase/migrations` (I7) | `supabase db push` applies the schema to dev in one command — the proposal assumed hand-pasting 29 files. |

Verified now, against production, that the guard fires:

```
[demo] target: !! PRODUCTION (efrcgktrlsjnzkzzuhof) !!
[demo] REFUSING TO WRITE TO PRODUCTION.
```

## Deviations from the proposal, with reasons

**1 · The demo project carries no commercial data.** The proposal recommended
exporting the Mudon rows and re-importing them into dev under the same id. The
seed builds the project from the committed plan fixture instead, and copies
nothing from `lib/ground-truth/mudon-actuals.ts`.

Those rows carry Atrium, Global Creation, Laspinas and RAK quotations, contract
totals and discount percentages, held under a client relationship. A dev
database is what people point throwaway branches at and hand to a contractor to
debug. Geometry is real, prices are catalogue-only, quotations are absent.

Not seeded by design: renders, room photos, BoQs, takeoff items, `boq_outcomes`,
moodboard items, and every `rate_book` row with provenance `actual_transaction`.
**`seed-rate-book-actuals.ts` must never run against dev** — it seeds exactly
the data this keeps out.

The project **id** does match the fixture, so scripts and tests with it
hard-coded keep working. An id is not commercial data. The row is named
"Demo villa (dev)" so nobody mistakes it for the real record.

**2 · Migrations are a CLI push, not a manual replay.** The proposal's step 2
said apply 001–029 by hand and warned the two databases would drift. I7 landed
first, so dev gets `supabase db push` and drift is a checked condition rather
than an expected one. Its mitigation 2 — a `schema_migrations` table — now
exists as the CLI's own ledger.

**3 · The drift check reads migrations, not `information_schema`.** The proposal
assumed reading `information_schema` from both projects. PostgREST does not
expose it, and there is no database password yet, so the check probes each
column the migrations describe. It proves both databases match the migrations;
it cannot see anything created by hand in a dashboard. That gap closes with I9's
password and `pg_dump --schema-only` — and it is stated in the script's own
header rather than left for someone to discover.

**4 · Migration 029 is unapplied in production.** Not a deviation, but it lands
here: dev will be built from all 30 migrations and will therefore have
`plans.has_overlaps` while production does not. The drift check will report it
until `supabase db push` runs against production. It is additive and safe.

## Verification still owed, once the project exists

- A destructive migration applied to dev provably cannot touch prod — different
  refs, different keys, and the guard refusing prod by default.
- The app boots against dev end to end: intake → plan → render → BoQ.
- `check-schema-drift.mjs` reports no drift between dev and prod (except 029
  until production is pushed).

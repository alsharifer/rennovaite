# U1 — firm ownership + requireFirm on all firm routes (2026-09-26)

- **Migration 043 `firm_members (firm_id, user_id)`** — applied on dev
  (`npm run db:push`, 43/43). No teams, no roles: creating a firm makes the
  creator a member; the Newspace firm 041 backfilled has no member until its
  account signs in and `scripts/firm-member-add.mjs` adds it. **U6's
  migration is therefore 044, not 043.**
- **`requireFirm(db, firmId, caller)`** answers **401 `unauthenticated` → 404
  `firm_not_found` → 403 `not_a_member`** in that order (an anonymous call
  learns nothing about which firms exist; cross-firm is refused on
  authentication grounds, not 404-by-scoping — the L1 scoping still holds
  underneath). Every store function takes the caller; every handler under
  `app/api/firms/**` resolves it with `getCaller(request)`
  (`lib/auth/caller.ts`: Bearer Supabase JWT for scripts, cookie session for
  the browser, never a request body). Covered too: `GET /api/firms` (the
  caller's firms only), `PATCH /api/projects/:id { firm_id }` (attach needs
  membership of that firm; detach, of the one being detached),
  `POST /api/boq-corrections` with `firm_id` / `attributed_to` (a correction
  with no firm attribution — what the in-app form sends — is unchanged).
- **Session plumbing added:** sign-out (`app/_actions/sign-out.ts`, `logout`
  in the top bar when a session exists). No browser Supabase client — no UI
  reads firm data yet.
- **Dev-auth path, not a bypass:** `scripts/lib/dev-auth.mjs` mints a REAL
  session for `dev-scripts+<tag>@rennovaite.local` (admin createUser →
  generateLink → anon verifyOtp) and scripts send it as a Bearer token; the
  routes contain no dev mode. Documented in `docs/AUTH.md`.
- **Verification:** vitest **839/839** (store tests rewritten with `alice` /
  `bob` / `nobody`: 401 on all 15 operations, 403 on all 9 cross-firm ones,
  404 after 401, detach needs membership; `route-auth.test.ts` scans every
  firm route + the two unscoped paths for `getCaller(request)` and a caller on
  every store call); `scripts/firm-overlay-check.mjs 3098` through two
  authenticated dev accounts: **ALL CHECKS PASSED** (401 anonymous, 403
  `not_a_member` on all seven cross-firm route calls, only-my-firms listing,
  L1 pricing invariants and `rate_book` unchanged). First run showed six
  failures that were all the stale-`.next` nested-route 404 (known; `rm -rf
  .next`) plus a cleanup assertion that assumed zero prior pilot events.
- **Not fixed, by design — named deployment blocker:** the other ~44 of 49 API
  route files are still unauthenticated on the service role; pages do not
  redirect signed-out visitors; no middleware; RLS off. `docs/AUTH.md` states
  it; the UV report carries it with 042-on-prod and the Mudon
  `rate_book.source` cleanup.

# Ops addendum — Neo4j off the PC, backups off the PC (O1–O3, 2026-09-25)

_Prepended to the Sprint-4 addendum. Infra only: no Sprint-4 code surface
(firm tables, auth, UI) was touched — `git status` on `ops/neo4j-aura-cloud-backups`
names no file under `lib/firms`, `app/api/firms`, `app/auth`, `components/`,
`lib/rates` or `supabase/migrations`. Full detail: `docs/OPS_RUNBOOK.md`._

- **The failure that started this, measured.** `rennovaite-neo4j` exited at
  **2026-09-21 17:53:21 Z** (the PC shut down; restart policy `no`) and was
  restarted by the Sprint-4 pre-flight at **2026-09-25 09:49:12 Z** — **3 d
  15 h 56 m** during which every render / BoQ prompt was silently
  un-grounded (`lib/kg/context.ts` swallows the error and costs 10 s per call
  doing so). Nothing alerted. That is the case for O1.
- **O1 tooling done and proven; cut-over waits on the Aura credentials.**
  `scripts/kg/{export,import,verify}-graph.mjs` + `equivalence-check.ts`
  (§1 of the runbook). Round trip local → throwaway container:
  **204 nodes / 528 relationships / 14 constraints / 3 indexes IDENTICAL** by
  per-element fingerprint; the app's six briefs **EQUIVALENT** (content
  identical, tie order differs — the queries' `UNION` / `ORDER BY score` leave
  that to the planner; consequence: one render-cache miss per room × style
  after cut-over). Export on disk at `~/backups/rennovaite/kg/kg-2026-09-25T13-41-14Z.json`
  (outside the repo). **No code change**: `neo4j-driver` takes `neo4j+s://`
  from the URI. **Against Aura (`a9bb4074.databases.neo4j.io`, 5.27-aura),
  later the same day:** import 204/528 with matching fingerprints; verify
  **IDENTICAL** on all eight checks; equivalence **EQUIVALENT** 6/6 (0 content
  differences); `getKgContext` with `KG_ENABLED=true` → GROUNDED in 3.9 s
  cold. **Container stopped 2026-09-25 15:22:42 Z** (owner's instruction;
  volumes intact) — before the env switch, so local dev is un-grounded until
  `.env.local` carries the Aura variables. Still pending on Abdallah: Vercel
  env (Production + Preview), the three `NEO4J_*` Actions secrets for
  `kg-keepalive` (none set as of 15:15 Z), `.env.local`, then rotate the Aura
  password (it passed through a chat window). **Rollback** = `docker start
  rennovaite-neo4j`, kept for one clean week from the Vercel switch.
- **O2 built and proven locally; the first cloud run needs the workflow on
  `master`.** `.github/workflows/backup.yml` + `scripts/backup-cloud/` wrap
  `backup-production.sh` unchanged: 03:00 Dubai · gpg AES-256 · B2 `daily/`
  + Sunday `weekly/` · prune every B2 version past 14 d / 56 d (with a
  `prune_probe` self-test) · **restore-test job that downloads from the
  bucket**, decrypts, restores into scratch `postgres:17` and compares every
  table's row count + `auth_users` + `rls_policies` + RLS-enabled counts
  against the source · a failed job opens a `backup-failure` issue. The six
  `BACKUP_*` repo secrets exist (set 2026-09-25). Local end-to-end on the real
  2026-09-11 production dump: package → sha → decrypt → filtered restore →
  **32/32 checks ok, verdict PASSED** (29 tables, 1 account, RLS auth 16 /
  storage 8). GitHub registers `workflow_dispatch` only from the default
  branch → PR #62 merged (`175de65`), workflow registered (id 367010494).
  **First cloud run (#1, 36144700303) FAILED at the dump step — and the
  fail-loud path worked: issue #63 opened automatically.** Cause: the
  `BACKUP_DB_URL` secret points at Supabase's direct host, which has only an
  IPv6 address; GitHub runners have no IPv6 (`Network is unreachable` ×3).
  Fix is the pooler URL from `~/backups/rennovaite/.db-url`
  (`gh secret set BACKUP_DB_URL < …`, runbook §2) — a secret Abdallah sets,
  then re-dispatch with `prune_probe` + `configure_lifecycle`. **Run #2
  (36145453268) reproduced it** — the secret had not been changed (issue #65
  opened) — and exposed a second defect: `BACKUP_STORAGE_ENDPOINT` is stored
  as a bare hostname and aws-cli refused it; `s3env.sh` now normalises the
  scheme (PR #64). **Run #3 (36146020484), after the pooler secret was set:
  the dump, the scratch verification and the source counts all succeeded** —
  the connection string is right — and the run stopped at *Package +
  encrypt* because `BACKUP_ENCRYPTION_KEY` is **shorter than 24 characters**
  (the guard did its job; a short passphrase is the only thing between a
  public-cloud copy of customer data and anyone holding the object). B2 also
  rejected the lifecycle rules (it wants a companion
  `ExpiredObjectDeleteMarker` rule per prefix — fixed in
  `configure-retention.sh`). **Run #4 (36149806456), after the key was
  replaced: ALL FOUR JOBS GREEN.** Dump 14:47→15:09 (36 tables, 9 projects,
  1 auth user), 1.2 MB encrypted object uploaded and size-confirmed, retention
  probe planted and both versions deleted, lifecycle rules accepted by B2;
  **restore-test downloaded the object from the bucket, verified the sha256,
  decrypted, restored into scratch `postgres:17` and matched 41/41 checks —
  every table's row count, 1 account, RLS auth 16 / storage 8 — verdict
  PASSED.** The acceptance criterion is met; the nightly cron (`0 23 * * *`)
  now runs on `master`. Issues #63/#65/#66 (the failed dispatches) closed.
  **Run #5 (36156648413), with the dump-time fix (PR #70) and the `NEO4J_*`
  secrets in place: green again — dump under 2 min (was 22), object 284 KB
  (was 1.2 MB), `system_schema_toc_entries=0`, restore-test PASSED, and
  `kg-keepalive` ran for the first time: "KG reachable — 204 nodes".**
- **Dump-time fix applied and proven (item 4).** `backup-production.sh` now
  excludes `pg_*` / `information_schema`; a local round trip against
  production the same day: 0 system-schema TOC entries, an **unfiltered**
  restore logs 2 errors instead of 2,981 with RLS state intact (auth 16 /
  storage 8 / public 0); `restore-check.sh` asserts the zero and keeps the
  filter only for older archives. Every scratch copy of production data was
  deleted after the test.
- **KG module off the laptop (item 5).** Pushed to the private remote
  `alsharifer/rennovaite-kg` (3 commits), after committing the seven
  `seed/**/mudon_*.json` files the loader reads but nobody had tracked — a
  reseed from the repo alone would have rebuilt the pre-Mudon graph.
- **Dev-server smoke against Aura (item 3) — done 2026-09-26** once
  `.env.local` was switched (it had not been on 2026-09-25: mtime 09-10,
  `bolt://localhost`). `next dev` on 3091 with `KG_ENABLED=true`, one
  `POST /api/render` on the dev demo villa's living room (a style locked for
  the test through `/api/style-choice`, removed afterwards): the route logged
  `[api/render] KG context injected (bundle=bundle:1790397949572:hqcpxc)`
  with the full grounding block, no `[lib/kg] KG retrieval failed` line, 200
  in 17.5 s (the render model's time, not the KG's), and render row
  `e572ad4d` carries the `kg_bundle_id`. Grounding answers from Aura without
  the timeout.
- **Finding — the dump carries `pg_catalog` and it corrupts a superuser
  restore.** `--schema='*'` includes `pg_catalog.pg_event_trigger` TABLE
  DATA; restoring it plants production's event-trigger rows with foreign
  function OIDs and every later DDL fails, silently dropping all 25 `ENABLE
  ROW LEVEL SECURITY` (2,981 errors, zero RLS state — the I9 rehearsal never
  saw this because it restored into a full Supabase stack). The cloud restore
  test and the runbook's real-restore procedure filter
  `pg_catalog`/`information_schema` from the TOC (45 benign errors, RLS state
  exact). `backup-production.sh` was left unchanged as instructed; the
  dump-time fix (`--exclude-schema='pg_*' --exclude-schema=information_schema`)
  is a follow-up.
- **There was no PC schedule.** `Get-ScheduledTask` shows no `RennovAIte
  backup` task; `docs/BACKUPS.md`'s `schtasks /create` was never run. Nothing
  to disable. OneDrive holds the single 2026-09-11 manual dump.
- **Still PC-dependent, none load-bearing:** the stopped Neo4j container
  (rollback), `~/backups/rennovaite/{.db-url,kg/}` (convenience copies), the
  KG module repo in OneDrive (reseed only — should get a remote), the CLI link.
- **Baseline after the change:** vitest **822/822**, every new shell script
  `bash -n` clean, workflow YAML parses; `.env.local` mtime unchanged
  (2026-09-10); credential scan of the diff clean (placeholders only).
- **Vercel: every production deploy from PR #62 through #71 FAILED** (found
  2026-09-26 from the failure emails). Cause: `scripts/kg/equivalence-check.ts`
  indexed the `{}` that the untyped `.mjs` env reader was inferred to return —
  TS7053 under strict — and `tsconfig` includes `**/*.ts`, so `next build`'s
  type-check rejects a one-off script the app never imports. vitest was green,
  and no `tsc`/`next build` was run after the script was added — that is the
  lesson (memory: *build before push*). Fixed at the source with a JSDoc
  return type on `readEnvFile` (`scripts/_target-guard.mjs`); `tsc` 0 errors,
  `next build` exit 0. **Consequence while it lasted:** production stayed on
  the pre-#62 build, so the Vercel `NEO4J_*` switch to Aura did not reach a
  running deployment until this fix deployed — production grounding was still
  in the silent-fallback state the whole time.

---

# Sprint-4 Addendum — confirmed facts (pre-flight)

_Prepend this block to every Sprint-4 prompt. It **supersedes** the Sprint-3
addendum (itself superseding Sprint-2, Sprint-1 and the Pilot-Seven P0
addendum; all are in git history). Every fact below was re-verified against the
code and the database during the Sprint-4 pre-flight on **2026-09-25**. Facts
read from the running database are marked **[DB]**; facts read from source are
marked **[code]**. Nothing here was carried over unverified._

> **"[DB]" means dev.** `.env.local` **and** the Supabase CLI link
> (`supabase/.temp/project-ref`) both point at the **dev** project
> `askzyqgcnjmbqegfifxq`, not production (`efrcgktrlsjnzkzzuhof`,
> `PRODUCTION_REF` in `scripts/_target-guard.mjs`). Production was **not**
> probed in this pre-flight — no production credentials are in `.env.local`,
> by design. The 46 Mudon interior `actual_transaction` rate rows and
> `boq_outcomes` entry #1 exist **only** in production.

---

## 00. Standing rules — verification hygiene

Two rules that hold for every sprint, every phase, and every agent working in
this repo. Both were written after being broken.

### Verification never writes to production data

**Mudon pilot villa (`6b5fda9d`) is calibration ground truth, not a test
fixture**, and so are the garden ground truth (`8d460645`, Villa 94) and the
live client garden (`ec4497c7`, Arabella). Their rows are evidence. If a check
needs state that does not exist, create it on a **scratch project** —
`12904f6d` "Client garden stand-in (isolation fixture)", seeded from the same
records by `scripts/lib/garden-seed.ts` — or a local seed. Read production;
fabricate elsewhere. Scripts that can write refuse production unless
`ALLOW_PROD_WRITE=1` (`scripts/_target-guard.mjs`). Where a write is
unavoidable, the pre-destructive ritual in `POST_DEMO_FOLLOWUPS.md` applies:
count the blast radius before, state it, re-count after.

### Never edit `.env.local`

It holds live secrets and is the one file git cannot restore. Pass a flag
inline instead — the process gets it, the file is never touched:

```bash
GARDEN_PILOT_ENABLED=true DRAWINGS_ENABLED=true PACK_EXPORT_ENABLED=true npm run dev
```

`.claude/launch.json` carries an **uncommitted** local `garden` preview entry
(port 3098) that does exactly this; leave it out of commits unless asked.

---

## 0. Repo state at pre-flight

- Base is **`master` @ `cd59728`** (merge of PR #60 `chore/t6-verification`;
  PR #59 `feat/firm-rate-books` landed T1.0 · L1 · I4 · T3b · D4/D5 · T5).
  Working tree: `.claude/launch.json` modified (local preview config) and an
  untracked `QS Package/`; nothing else.
- Baseline is **GREEN** (re-run 2026-09-25):
  - `tsc --noEmit` **0 errors**
  - `eslint` **0 errors**, 1 pre-existing warning (custom fonts,
    `app/layout.tsx:71`)
  - `vitest run` **822 tests / 74 files, all passing** (was 769 / 71 after
    T3b, 694 / 61 at the Sprint-3 pre-flight)
  - `next build` **exit 0** — 25 `page.tsx` routes, 49 API `route.ts` files
    (+ `auth/callback`)
  - `npm run db:check` — "checked 42 migrations against the manifest · frozen
    mirror: 30 historical files, all mapped · history intact"
- Next.js **16.2.4**, React **19.2.4**, TypeScript 5, Tailwind v4, zod 4,
  three 0.185 / r3f 9 / drei 10, `@supabase/ssr` 0.10. App Router. **Read
  `node_modules/next/dist/docs/` before writing Next code** (per `AGENTS.md`).
- **Neo4j**: container `rennovaite-neo4j` was `Exited (255)`; started during
  this pre-flight, now `running / healthy` on 7474 + 7687, **204 nodes / 528
  relationships** [DB]. `KG_ENABLED=true` in `.env.local`, so KG grounding is
  live again. It stops with the machine — `docker start rennovaite-neo4j`
  (~40 s to healthy) before any KG-dependent check.
- `PILOT_SEVEN_STATUS.md` is still the stale root status file; use §1 here.

## 1. Migrations — high-water mark **042**, ALL APPLIED on dev [DB]

`supabase migration list` against dev: **42 local = 42 remote**, no drift
(`20260101000100` → `20260101004200_pack_exports.sql`). `scripts/migrations/`
is **formally retired** at 030 (T6): `checkFrozenMirror` in
`lib/migrations/history.ts` fails `npm run db:check` and the suite if a file is
added to or removed from the mirror, or if any route/script/doc tells a reader
to run one. Apply with `npm run db:manifest` + `npm run db:push` (the wrapper
refuses when the CLI link and `.env.local` disagree); see `docs/MIGRATIONS.md`.

Since Sprint-3 (031–040 were tabled there):

| # | Name | Creates |
|---|---|---|
| 041 | firm rate books (L1) | `firms`, `firm_rate_books`, `firm_rate_entries`, `projects.firm_id`, `boq_corrections.firm_id / promoted_at / promoted_entry_id` |
| 042 | pack exports (T5) | `pack_exports` + private `packs` bucket |

Live dev counts [DB, 2026-09-25]: `projects` 4 · `plans` 4 · `rooms` **49** ·
`takeoff_items` **269** · `boqs` **69** · `rate_book` 35 (15 `seed` + 20
`actual_transaction` `garden.%`) · `boq_outcomes` 1 · `boq_corrections` 3 ·
`pilot_events` **299** · `plan_elements` 16 · `plan_context` 33 ·
`plan_fixtures` 109 · `plan_openings` 1 · `renders` 394 · `pricing_skus` 600 ·
`labour_rates` 52 · `project_assets` 14 · **`firms` 1 · `firm_rate_books` 0 ·
`firm_rate_entries` 0 · `pack_exports` 13** (6 passed · 6 failed · 1 blocked).

Production: 031–041 were pushed on 2026-09-22 (garden rate book seeded, 20
rows). **042 has not been confirmed on production** — do that before any
deploy that exercises Export pack.

## 2. Feature flags — current states [.env.local + code]

All flags are `process.env.X === "true"`, **read at server start — flipping one
requires a dev-server restart.** Every flag defaults **off**; off == pre-flag
behaviour.

| Flag | `.env.local` | Gates |
|---|---|---|
| `KG_ENABLED` | **true** | KG grounding (needs Neo4j reachable — §0) |
| `DRAWINGS_ENABLED` | **true** | `/project/[id]/drawings`, document routes |
| `OVERLAYS_ENABLED` | **true** | electrical/plumbing overlays + BoQ sections |
| `VIEWER_3D_ENABLED` | **true** | `/project/[id]/viewer` (also gates P4 inspect + T3b element-section resolver path) |
| `WHATIF_ENABLED` | **true** | grade toggles / budget dial |
| `PERMIT_CHECK_ENABLED` | **true** | Dubai permit-trigger checklist |
| `STAGING_ENABLED` | **true** | furniture staging |
| `PROPERTY_OS_LANDING` | **true** | `/` = Property OS intro; homepage at `/rennovaite` |
| `TEXTURED_WALKTHROUGH` | **true** | F1 finishes in the 3D walkthrough |
| `TASTE_SEED_ENABLED` | **false** | B3 moodboard conditions renders |
| `GARDEN_PILOT_ENABLED` | **unset** | G1+: authored plans, outdoor zones, elements layer, photo pairs, `/api/pilot-events`, `/api/boq-corrections`. Run inline |
| `PACK_EXPORT_ENABLED` | **unset** (new, T5) | with `DRAWINGS_ENABLED`: in-app Export pack + document routes answer a running job. Off = every document route 404s |
| `BOQ_ENGINE` / `RENDER_MODEL` / `PARSE_PROVIDER` | **unset** | deterministic engine / `google/nano-banana` / `"inhouse"` |

Non-flag env for scripts only (not in `.env.local`): `ALLOW_PROD_WRITE`,
`DEV_/PROD_SUPABASE_URL`, `DEV_/PROD_SERVICE_ROLE_KEY`.

## 3. BoQ · rates · corrections shapes (what moved since Sprint-3)

- **BoQ storage** unchanged: one jsonb `boqs.sections` holding the document
  (`sections[]`, subtotal, `ohp_pct`/`ohp_aed` when a firm with OH&P prices
  it, contingency, VAT, grand total, `engine`, `programme?`, `garden?`).
  **Every generation inserts a new `boqs` row; nothing deletes them** — there
  is no revision number, parent id or plan-snapshot link, only `created_at`.
  `takeoff_items` are **delete-then-insert per project** on every generation
  (`lib/boq/element-map.ts:111`, `lib/boq/garden-boq-feed.ts:463`), no
  `boq_id`; `plan_snapshot_id` is always null. See spot-check (c).
- **Rate resolution** is one order for every path (`lib/rates/tiers.ts`):
  firm_private → firm_correction → reference (`rate_book`) → catalog /
  allowance / labour_book → indicative. Every line carries `rate_tier`.
  The Sprint-3 statement "rate_book is not on either pricing path" is
  **superseded** — the garden take-off reads it (T1.0) and the interior
  resolver reads it as tier 3. `REFERENCE_COLUMNS` never selects `source` /
  `internal_ref`.
- **Firms** [DB, dev]: one firm (`Newspace`, `private: true`,
  `created_by: "migration 041 (boq_corrections.attributed_to)"`), **no books,
  no entries, no project has a `firm_id`** → every BoQ regenerates unchanged
  (`lib/boq/__tests__/pricing-golden.test.ts`, `scripts/boq-regen-check.mjs`).
- **`boq_corrections`** [DB]: 3 rows (1 confirm · 1 scope · 1 design), all
  `firm_id` = Newspace, `promoted_at` null. `correction_type` ∈ rate |
  quantity | scope | design | confirm; `provenance` always `market_fair`;
  040 `attributed_to` / `confidence` / `session_ref`; 041 `firm_id` /
  `promoted_at` / `promoted_entry_id`. The in-app `ReviewCorrections` form
  sends **none** of the 040/041 fields (only scripts do), and renders for
  garden BoQs only.
- **Identity**: `lib/identity/curation.ts` is server-only; firm names appear
  only on their own projects; `NAME_RULINGS` (Laspinas, "Villa 94", RAK) as
  documented in `CLAUDE.md` §I4.
- **Figures**: `lib/format/aed.ts` + `<Figure>` are the only sanctioned
  formatter/component; `lib/boq/totals.ts` `chainTotals` is the one summary
  chain; REF codes via `lib/boq/refs.ts` (position-based — see (c)).
- **Read-time-only sections** unchanged: Joinery & Aluminum; Furniture
  (optional) as a separate prop, never in `boqs.sections`.

## 4. Documents — one gated export path (T5) [code + DB]

`lib/documents/pack-export/run.ts` is the only way a document leaves: BoQ
regeneration → checklist gate → renders (anchor-first, faithfulness +
consistency) → photo pairs → documents through their routes → printed-content
checks → outputs + manifest into the private `packs` bucket. Every document
route calls `guardDocumentRoute` (serves only a RUNNING `pack_exports` job,
header `x-pack-export-job`, 3 h TTL); `ungated-paths.test.ts` scans for
bypasses. Visibility is `packExportEnabled()` = `PACK_EXPORT_ENABLED &&
DRAWINGS_ENABLED` on button AND routes. `pack_exports` columns: `source`
(app | cli), `status` (queued | running | passed | blocked | failed),
`options`, `progress {step, pct, note, log}`, `checklist`, `manifest`,
`outputs`, `error`, `created_at` / `started_at` / `finished_at`. **No actor,
no firm.** The Sprint-3 (d) gap (consistency gate + photo pairs script-only,
BoQ-PDF button not gated) is closed.

## 5. Projects on dev [DB]

| id | name | display_name | firm_id | boqs | role |
|---|---|---|---|---|---|
| `6b5fda9d` | Demo villa (dev) | — | null | 3 | Mudon demo, dev copy (13 rooms) |
| `8d460645` | Villa 94 garden (ground truth) | Contemporary Villa Garden — Completed Renovation | null | 16 | garden ground truth, delta-log #2 (−2.88 %) |
| `ec4497c7` | Arabella Garden — Draft for Review | — | null | 45 | live client garden (G5 → G5d) |
| `12904f6d` | Client garden stand-in (isolation fixture) | Courtyard Garden — Review Copy | null | 5 | scratch — the one to write to |

`pilot_events` by project: Arabella 272 · Villa 94 17 · stand-in 10 · Demo
**0** (interior projects write none — see (b)).

## 6. Test runner + fixtures [code]

vitest (`npm test`), **74 files / 822 tests**. `tsx` is not installed —
`.ts` scripts run via `node --import ./scripts/_alias-hook.mjs <script>`.
Still pure-module tests plus scene / sheet SVG assertions; **no component or
route tests**. Fixtures unchanged (`lib/boq/fixtures/mudon-first-floor.ts`,
`lib/plan/__tests__/*.fixture*`, `lib/ground-truth/villa94-garden-geometry.ts`,
`lib/client-garden/arabella-reference.ts`, `lib/firms/__tests__/fake-db.ts`).

---

## 7. Sprint-4 spot checks (report only — nothing changed)

### (a) User auth today — the shape `requireFirm` must fit

**What exists [code]:**
- Sessions: `@supabase/ssr` via `lib/supabase-server.ts:17-43`
  (`createServerClient`, **anon key**, cookies through `next/headers`
  `getAll`/`setAll`; writes fail silently in Server Components). There is
  **no browser client** (`createBrowserClient` appears nowhere;
  `lib/supabase.ts` is an unused anon singleton). Service role lives in
  `lib/supabase-admin.ts` (throws if imported client-side).
- Accounts: **magic link only** — `app/_actions/sign-in-with-email.ts:43-48`
  (`signInWithOtp` → `/auth/callback?next=/project`);
  `app/auth/callback/route.ts:22-28` `exchangeCodeForSession`. No OAuth, no
  password, **no sign-out**. No `profiles` / `users` / memberships table; no
  migration references `auth.users` or `auth.uid()`; `projects` has no owner
  column (`app/api/projects/[id]/route.ts:18-19` says so). The only user-like
  columns: `feedback_events.user_id` (no FK, always null in practice) and
  `firms.created_by` (free text label, three writers).
- **RLS is off on every table** — zero `enable row level security` / `create
  policy` statements; each migration explicitly disables it.
- **Middleware: none.** No `middleware.ts` / `proxy.ts` anywhere; no session
  refresh, no matcher, no redirect. (`next.config.ts` only sets
  `proxyClientMaxBodySize`.)
- **What is protected: nothing.** `getUser` is called in exactly two places,
  neither blocking: `app/page.tsx:39-43` (signed-in visitor → `/project` when
  `PROPERTY_OS_LANDING`) and `app/dashboard/page.tsx:178-181` (greeting +
  PostHog identify; data via admin client, unfiltered). **0 of 49 API routes
  check the caller**; all but three use the service-role client (`health`,
  `projects/[id]/drawings`, `render/consistency` use none). The only gates are
  feature flags.
- `requireFirm(db, firmId)` (`lib/firms/store.ts:72-76`) only proves the firm
  **exists** (404 `firm_not_found`); its header and `CLAUDE.md` say "who is
  asking" belongs here. Callers: every `app/api/firms/[firmId]/**` handler
  (firmId from the **path**), `assignProjectFirm` (firm_id from the PATCH
  **body**, no project-ownership check), `POST /api/boq-corrections` (firm_id
  from the body, else `findOrCreateFirmByName`). Not called by `listFirms` /
  `createFirm`. `promoteCorrection` adds one check — the correction's
  `firm_id` equals the path firm (`store.ts:332-334`) — data consistency, not
  identity. `FirmOverlay.forProject` / `FirmIsolationError`
  (`lib/rates/firm.ts:52-104`) likewise assert data belongs to
  `projects.firm_id`, not who is calling.

**The shape:** a route handler can obtain a Supabase user
(`(await createSupabaseServerClient()).auth.getUser()` → `{id, email}` |
null) from cookies; none does. There is **no user → firm mapping**. So
`requireFirm` needs: (1) a membership table (`firm_members(firm_id, user_id →
auth.users, role)` or equivalent), (2) a caller argument —
`requireFirm(db, firmId, user)` → 401 no user / 403 not a member / 404 no
firm, (3) the unscoped paths covered separately (`listFirms`, `createFirm`,
`assignProjectFirm` needs project → firm or project-owner authority,
`findOrCreateFirmByName`), (4) enforcement **in application code** — every
firm route runs on the service role, so RLS would not help unless routes
switched clients. A session-refresh proxy is optional for API routes (the
handler reads cookies itself) but needed for pages if any page is to redirect.

### (b) `pilot_events` today vs L5 (prep time, checking time, correction patterns, support load per firm project)

**Schema [code + DB]** (`20260101003700_client_garden_draft.sql:67-78`, kind
CHECK widened in 040): `id`, `project_id` (FK, cascade), `kind`, `detail`
jsonb, `recorded_at`; index `(project_id, kind, recorded_at)`. **Kinds**:
plan_started · plan_saved · design_edit · boq_generated · pack_exported ·
friction · session_decision · correction — enforced by
`pilot_events_kind_chk`, so **any new kind is a migration**. **No `firm_id`,
no actor, no session id, no duration; `stage` is inside `detail`** and is
mostly patched on afterwards by scripts (`reference_layout`, `design_seed`,
`session_apply`, `geometry_fix`, `verification`) or by the pack runner when
`options.stage` is set (default null). Dev tally [DB]: design_edit 155 ·
pack_exported 62 · boq_generated 56 · friction 12 · plan_saved 6 ·
session_decision 4 · correction 3 · plan_started 1; **zero rows carry a
`stage` key at top level** — it is in `detail`.

**Writer** `recordPilotEvent` (`lib/pilot/events.ts:26-45`) returns without
writing unless the latest plan is `source = 'user_drawn'` → **interior
projects are not instrumented at all** (Demo villa: 0 events), and
`boq_generated` is skipped when the BoQ has no `garden` block
(`generate-boq/route.ts:1016`). `POST /api/pilot-events` (friction,
session_decision) inserts directly and 404s without `GARDEN_PILOT_ENABLED`.
`plan-openings` writes nothing; no delete or render events.

**Reader** `computePilotMetrics` (`events.ts:99-156`), per project only: time
to draw (first counted edit → last edit before first FULL BoQ), active minutes
(sum of edit gaps ≤ 30 min — inferred, no heartbeat), time to first full BoQ,
scene-render gate pass rate, friction list, corrections by type + per
`session_ref`. Never groups by firm.

**Gap table:**

| L5 metric | Exists | Missing |
|---|---|---|
| Prep time | edit / plan / boq_generated timestamps; ≤30-min-gap active minutes; time to first full BoQ | firm only via join on `projects.firm_id`; **no actor** (firm edits vs ours indistinguishable); no session/heartbeat; interior projects write nothing; stage patched after the fact; no "handed to client" event |
| Checking time | `pack_exports` created/started/finished + status; `pack_exported` events; `boq_corrections.recorded_at` | no review-opened/closed or BoQ-viewed events; no actor on `pack_exports`; pack events fire during OUR export, not a firm's review |
| Correction patterns | typed corrections with item_key / field / old / new / element_refs / firm_id / confidence / session_ref; per-session counts | UI form sends no firm_id / session_ref; metrics count by type only (no by-section / by-item / by-firm rollup); interior BoQs cannot be corrected in the UI |
| Support load | `friction {note, area}`; `feedback_events` (KG accept/reject) | no help-request / error / intervention kind (CHECK blocks it → migration); no "who intervened"; route errors not captured; friction POST needs the garden flag |

Minimum schema move for L5: a migration replacing `pilot_events_kind_chk`,
plus `firm_id`, `actor` (or `user_id`), `session_id` columns and a firm index —
and lifting the `user_drawn` guard so interior projects are instrumented.

### (c) The change-report engine — generalizable to "diff any two BoQ revisions"?

**Where it lives [code]:** `lib/pilot/change-report.ts` — `snapshotOf()`
(:40-78) and `changeReport(before, after)` (:107-155), **pure, no I/O**, one
two-line test (`lib/pilot/__tests__/pilot.test.ts:64-83`). Callers:
`scripts/garden-change-report.ts`, `scripts/arabella-session-apply.ts`,
`scripts/arabella-unmap-front-border.ts`, and `pack-export/run.ts:233-235`
(baseline). Garden coupling is thin: draft/watermark fields in the snapshot
and callers' `garden.%` take-off filter; no Arabella constants in the core.

**What it keys on:** line key = `${work_section}|${rule_id ?? description}`
(+ `#n` on repeats, `:51-55`); take-off rows `${work_item_key}|${element_id}`
(rows without an element are dropped). **The line key is not stable across
regenerations**: the engine writes `rule_id` as
`${item.rule_id}/${rate.notes?.split(":")[0]}` (`lib/boq/engine.ts:61`), so a
rate-source or tier change reads as removed + added, and `#n` depends on
order. Garden `GL-xx` ids are stable. REF codes (`lib/boq/refs.ts`,
`${work_section}-${idx}`) are **positional** and shift on insert — not a
match key. Stored lines carry no `item_key`; `lineItemKey()`
(`lib/provenance/boq.ts:126-133`) reverse-derives it and is the best
semantic key available.

**Inputs / storage:** the snapshot accepts either a stored `boqs` row or the
draft-pack baseline JSON. **Line-level diff of any two stored revisions is
possible today** (rows are never deleted). **Element-level is not**:
`takeoff_items` are overwritten per project each generation, no `boq_id`,
`plan_snapshot_id` always null; `plan_snapshots` exist only at parse-confirm
and design lock. `boq_generated` events record `boq_id` for gardens only.

**Cause attribution:** none generic. Arabella got causes by staging
regenerations; `villa94-garden-dryrun.ts` classifies platform-vs-actual only
(hard-coded `MAP` / `OVER_MEASURED`); `boq_corrections.correction_type` is
the only stored cause taxonomy (joinable by `boq_id`). A quantity / rate /
added / removed split is trivial to add — `MovedLine` already has old/new
quantity and total; rates need carrying through. Reusable neighbours:
what-if `scenarioChain` for OH&P / contingency / VAT movement;
`buildBoqProvenance` to explain each side.

**Verdict:** the diff shape is reusable as-is; generalise the key
(`lineItemKey` or a persisted `item_key`, `rule_id` without the notes
suffix), make draft fields optional, drop the garden filter, add rate + class
+ chain breakdown, write real tests. **S–M** for a line-level diff of two
stored BoQs with a route and view; **M–L** for per-element parity (needs
`takeoff_items.boq_id` or a take-off snapshot on the BoQ, a revision/parent
column, and a backfill).

### (d) Promoted-correction storage shape — the delete-to-replace limitation (U4)

**DDL [code]** (`20260101004100_firm_rate_books.sql`): `firm_rate_entries`
(:55-84) — `book_id` → books (cascade), `firm_id` → firms (cascade, nothing
checks it matches the book's firm), `item_key`, `grade` (null | economy |
standard | premium), `unit`, `rate_aed ≥ 0`, `kind`, `origin` (`firm_entry`
default | `promoted_correction`), `correction_id` → `boq_corrections` (SET
NULL), `note`, `created_at`, `updated_at`. **The only unique index**:
`(firm_id, item_key, coalesce(grade,'*'), origin)` (:83-84). **No
`valid_from` / `superseded_*` / `version` / `active`; no history table.**
`boq_corrections.promoted_entry_id` → entries **ON DELETE SET NULL**;
`promoted_at` is a plain timestamp (:90-92).

**Promote** (`lib/firms/store.ts:310-368`): 404 / 403 `not_this_firms_correction`
/ **409 `already_promoted` if `promoted_at` is set** (:335) / 422 (`not_a_rate`,
`no_item_key`, `no_rate`, `invalid_entry`, `unit_required`) → `insertEntry`
with `origin='promoted_correction'`, `correction_id`, rate = `new_value`, grade
null by default → update the correction's `promoted_at` /
`promoted_entry_id`, compensating delete on failure. **Two writes, no
transaction.** A second promotion for the same (firm, key, grade) hits 23505 →
**409 `conflict` "entry … (promoted_correction): already exists"** — nothing
says "delete first". A `firm_entry` on the same key does **not** conflict
(origin is in the index) — the promotion succeeds but stays behind tier 1.

**Rates routes:** POST inserts `firm_entry` (same 409 on duplicate). PATCH
(`grade`, `unit`, `rate_aed`, `kind`, `note`) overwrites in place with **no
origin guard** — a promoted entry's rate can drift from its correction's
`new_value`, history lost. DELETE is a **hard delete**: the FK nulls
`promoted_entry_id` but **`promoted_at` stays set, so the correction is never
re-promotable**.

**So "delete-to-replace" means:** to bring a newer correction for a key you
must DELETE the current promoted entry, losing the old rate (no table records
it) and orphaning the old correction (points at nothing, still "promoted");
even then the *same* correction cannot be re-promoted. `scripts/firm-overlay-check.mjs:121-122`
does exactly this to let tier 2 answer. **Tests cover a single promotion and
the 409s; none cover promote-over-existing, delete of a promoted entry,
re-promotion or PATCH on a promoted entry.**

**Reader** (`lib/rates/firm.ts:94-127`): entries grouped by `item_key` into
arrays, tier by `origin` alone, exact grade before grade-null, **`Array.find`
with no ORDER BY** — a second active row per (key, grade, origin) would pick
whichever the DB returned first. Any versioning must filter to active rows in
`loadFirmBook` / `listEntries`.

**What U4 needs:** partial unique index on active rows (`… where superseded_at
is null`) in place of `firm_rate_entries_key_uidx`; `superseded_at` +
`superseded_by` (self-FK) or `valid_from`/`valid_to`; promote-over-existing in
**one transaction (RPC)** — retire old, insert new, link correction; PATCH
creates a version or is blocked on promoted entries; DELETE becomes retire;
decide whether retiring clears `promoted_at` (re-promotable); active-row
filter on every read; tests for promote-over-existing, history kept,
re-promotion.

---

## 8. Pre-flight verdict — **GO**

Baseline is green on every gate (tsc, eslint, 822/822, build, migration
history), 042 migrations are applied and in sync on the database the app
targets, Neo4j is healthy with the seed intact, and nothing in the spot-checks
blocks starting Sprint 4. Carry these into scoping:

- **Auth (a)** is greenfield below the magic link: no membership, no
  middleware, no route checks, RLS off everywhere. `requireFirm` needs a
  caller identity and a user→firm table before it can mean anything; do it in
  application code on the service-role path.
- **L5 (b)** needs a migration first (kind CHECK, `firm_id` / actor / session
  columns) and the `user_drawn` guard lifted, or interior firm projects will
  report nothing.
- **Revision diff (c)** is S–M at line level from stored `boqs` rows; the
  unstable `rule_id` key is the first thing to fix. Per-element needs storage
  changes.
- **U4 (d)** is a schema change (partial unique + supersession) plus an RPC;
  the current promote path is non-transactional and PATCH has no origin
  guard — fix both in the same pass.
- Production: confirm **042** before any deploy; the Mudon interior seed's
  `rate_book.source` supplier names remain latent (production-only).

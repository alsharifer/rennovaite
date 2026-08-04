# Sprint-1 Addendum — confirmed facts

_Prepend this block to every Sprint-1 prompt. It **supersedes** the
Pilot-Seven-era P0 Addendum. Every fact below was verified against the code
and the live DB during the Sprint-1 pre-flight (see the GO summary at the
bottom). Where a figure comes from the running database it is marked **[DB]**;
where it comes from source it is marked **[code]**._

---

## 0. Repo state at pre-flight

- Working branch **`feat/ground-truth-mudon-actuals`** — 21 commits ahead of,
  0 behind, local `master`. It is a clean superset containing all pilot-seven
  **and** P8/P8b ground-truth work; treat it as the Sprint-1 base. Master has
  **not** yet been fast-forwarded (last master commit `c767891`, the
  durable-render-images merge).
- Baseline is **GREEN**: `tsc --noEmit` 0 errors · `eslint` 0 errors (1
  pre-existing warning — custom fonts in `app/layout.tsx:71`) · `vitest run`
  **87/87** across 13 files · `next build` exit 0.
- Next.js **16.2.4**, React **19.2.4**, TypeScript 5, Tailwind v4, zod 4.
  App Router. **Read `node_modules/next/dist/docs/` before writing Next code —
  this is not the Next.js in your training data** (per `AGENTS.md`).

## 1. BoQ storage shape [code + DB]

- BoQ is persisted as a single **jsonb** column: `boqs.sections`. The stored
  object is `{ sections: BoqSection[], subtotal_aed, contingency_pct,
  contingency_aed, vat_pct, vat_aed, grand_total_aed, engine{...} }` — the
  `sections` **column** holds this whole object (the array lives at
  `boqs.sections.sections`).
- `BoqSection = { work_section, lines: BoqLine[], section_total_aed }`.
  `work_section` is a **POMI** enum, never a room/trade/free-form name
  (`lib/boq/schema.ts:13-31`). The 16 valid sections include the two P2 overlay
  sections `"Electrical Installations"` and `"Plumbing & Sanitary"`, plus the
  ground-truth additions surfaced at read time (see §2/§5).
- `BoqLine` required fields: `description, quantity, unit, rate_aed, total_aed,
  vendor_or_source, notes, rule_id, kind, rate_band, wastage_pct`. Additive
  **optional** fields (pre-P2 lines still validate without them):
  - **`element_refs: string[] | null`** — the fixture/element ids this line's
    quantity was counted from (P2/P4). 224 refs across the Mudon BoQ, 0 dangling.
  - **`rate_status: "priced" | "needs_qs"`** — `"needs_qs"` (rate 0) renders
    with a terracotta dot; the QS must price it. (Staging furniture uses a
    third value **`"indicative"`** but that section is never written into
    `boqs.sections` — see §5.)
- Schema + zod validators: `lib/boq/schema.ts` (`BoqSchema`, `BoqSectionSchema`,
  `BoqLineSchema`). The engine output is a strict superset of the legacy LLM
  `BoqResponse`, so it drops into the same column and `/project/[id]/boq` UI.
- **Never** hand raw model output into a render or DB write — validate with the
  zod schema at the boundary first (project convention).

## 2. Takeoff layer + aggregation-at-assembly [code + DB]

- **`takeoff_items`** (migration 017) — one row per `(project × work_item)` or
  `(element × work_item)`, computed deterministically from the `PlanGraph`
  **before** POMI aggregation. Columns: `project_id, plan_snapshot_id,
  work_item_key, room_id, element_id, qty, unit, wet_area, computed_at`.
  **184 rows** for Mudon [DB].
- **Aggregation-at-assembly rule** (the element↔line contract): an aggregated
  POMI line's `quantity` is the **SUM** over its take-off items, and its
  `element_refs` are those items' element ids. Per-room detail lives **only** in
  `takeoff_items` + views — the stored POMI document format never gains extra
  per-room lines. Pure geometry, no LLM/DB/aggregation inside the quantify step
  (`lib/boq/quantify.ts:6-11`, `element-map.ts:5`). Unit-tested for the
  invariant "per-room sums == each aggregated line quantity"
  (`lib/boq/__tests__/quantify.test.ts`).
- Deterministic pipeline: `computeTakeoff` (F-xx formulas in `rules.ts`) →
  `rates.ts` (R-xx resolution) → priced BoQ (`lib/boq/engine.ts`). This is the
  default path; `BOQ_ENGINE="llm"` selects the legacy Claude-priced path.

## 3. rate_book — columns, scope & provenance in use [code + DB]

- **`rate_book`** (018, extended by 022). Columns: `city (default 'Dubai'),
  work_section, item_key, grade ∈ {economy,standard,premium}, unit, rate_aed
  (NET), source, qs_validated, valid_from`, plus 022's additions:
  - **`list_rate_aed`** — pre-discount list price (net stays in `rate_aed`).
  - **`scope`** — `null | supply_only | install_only | supply_and_install`
    (CHECK-constrained).
  - **`provenance`** — `seed | indicative | actual_transaction` (CHECK,
    default `'seed'`).
- Resolution reads the **newest `valid_from`** per `(city, item_key, grade,
  scope)` — the actuals reseed **supersedes** seed rows rather than deleting
  them (idempotent; the reseed only deletes prior `actual_transaction` rows).
- **Values actually present [DB]**: 61 rows total — provenance
  `seed`=15, `actual_transaction`=46; scope `null`=15, `supply_only`=22,
  `install_only`=2, `supply_and_install`=22. **`indicative` is not currently
  used in `rate_book`** (it is the furniture-price marker elsewhere).
- **Scope enforcement** (`lib/boq/scope.ts`, unit-tested): a
  `supply_and_install` composite (joinery, aluminum — specialist prices with no
  labour section) must **never** get an added install line; a `supply_only`
  line (tiles, sanitary) must be paired with its `install_only` labour line or
  is flagged `install_missing`. This prevents double-counting install labour.

## 4. boq_outcomes + delta-log state [code + DB]

- **`boq_outcomes`** (023) — the feedback-loop ledger. Columns: `project_id,
  platform_boq_total, platform_by_section (jsonb), actual_total,
  actual_by_section (jsonb), delta_pct, capture_gap_notes, recorded_at`.
- **Delta-log entry #1 (Mudon), current [DB]**: platform **460,470** vs actual
  **453,228.50** (gross-labour, excl VAT) → **delta +1.6 %**, recorded
  2026-08-04. Written replace-in-place (one current row) by
  `scripts/record-boq-outcome.ts`; that script also reconciles the platform
  column to the BoQ subtotal exactly and prints the section crosswalk.
- Ground-truth source of truth is `lib/ground-truth/mudon-actuals.ts`
  (transcribed programmatically from
  `data/ground-truth/Mudon_Villa94_Ground_Truth_and_Delta_Log.xlsx` — Villa 94,
  first floor, `MUDON_M2 = 178.5`). Contract actual total = **453,228.50**;
  trade totals: labour net 200,000 / tiles 39,263.94 / joinery 70,090.56 /
  aluminum 92,449 / sanitary 14,925. Known **capture gaps** (platform can't
  itemise): staircase renovation, office build-out, terrace balcony, master-bath
  built-in; and tile-supply / supply-install split / openings deductions.

## 5. Ground-truth BoQ additions [code]

- **Joinery & Aluminum** sections: `lib/boq/joinery-aluminum.ts` — joinery
  priced as `supply_and_install` composites (heuristic qty × Atrium rates);
  aluminum & glass as **site-assessment allowances** ("Requires site
  measurement — allowance only") because the plan graph has no openings (§ spot
  checks). Unit-tested (`__tests__/joinery-aluminum.test.ts`).
- **Furniture (optional)** section (P7 staging): built at **read time** by
  `lib/staging/furniture-boq.ts` + `collect.ts` and passed to `BoqView` as a
  **separate prop — never written into `boqs.sections`**. All furniture rates
  are `rate_status: "indicative"`. Every contractor-facing surface that reads
  the stored jsonb excludes it by construction.

## 6. Canonical demo project [DB]

- **Name:** `Mudon pilot villa` · **id:** `6b5fda9d-e40f-4e16-940c-7a17d27ec5dc`.
  4-bed first-floor refit, 13 rooms, gross **178.5 m²**. Hard-coded in
  `scripts/record-boq-outcome.ts:22`, `scripts/verify-graph-integrity.ts:30`,
  test fixtures. Use this id for any Sprint-1 work that needs a real project.

## 7. Migrations — all applied through 023 [DB]

Files `scripts/migrations/001…023`. **No migration runner** — DDL is applied by
hand in the Supabase SQL editor (service-role JWT cannot run DDL). Beyond the
old P0 baseline of 021, migrations **022** (`rate_book_actuals`) and **023**
(`boq_outcomes`) exist and **are applied** [DB]. Live row counts confirming
application: `takeoff_items` 184 · `rate_book` 61 · `boq_outcomes` 1 ·
`whatif_scenarios` 54 · `permit_checks` 153 · `furniture_opt_ins` 1 ·
`plan_fixtures` 151 · `plan_snapshots` 6 · `drawing_sets` 1.
**Note:** `PILOT_SEVEN_STATUS.md` still lists 020/021 as "NOT YET APPLIED" —
that is stale; both, plus 022/023, are live. New Sprint-1 tables need a new
numbered SQL file applied manually + a `notify pgrst, 'reload schema';`.

## 8. Feature flags — current states [DB/.env.local]

All Pilot-Seven flags are **ON** in `.env.local`: `KG_ENABLED=true`,
`DRAWINGS_ENABLED=true`, `OVERLAYS_ENABLED=true`, `VIEWER_3D_ENABLED=true`
(also gates P4 inspect), `WHATIF_ENABLED=true`, `PERMIT_CHECK_ENABLED=true`,
`STAGING_ENABLED=true`. `BOQ_ENGINE` is **unset** → deterministic `lib/boq`
engine. `RENDER_MODEL` unset → default `google/nano-banana`. All flags default
**off** in code; `.env.local.example` documents them off. KG grounding only
activates with `KG_ENABLED="true"` **and** Neo4j reachable, else silent
fallback.

## 9. Render lineage columns [code]

`renders` table (003 + 012 + 016): `id, project_id, room_id, prompt,
image_url, parent_render_id (threads tweaks/iterations), created_at`; async/QA
additions `prediction_id, status ('pending'|'succeeded'|'failed', default
'succeeded'), qa (jsonb vision verdict)`; `kind ('still'|'pano', default
'still')`; plus `kg_bundle_id` (008) and `staging_set` (021). Tracing fields
`source_image_url, model, mode` record photo/offplan/tweak provenance for A/B.

## 10. KG env vars + resolver live IDs [code]

- Env read at runtime: `NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD`
  (`kg/retrieval/agent.ts:95-97`, dev default password `rennovaite_dev`);
  `KG_ENABLED` (`lib/kg/context.ts:47`). Grounding entry point
  `getKgContext` never throws — returns `{context:"", bundleId:null}` on
  disabled/unknown-style/timeout(10s)/error.
- App-side resolver `lib/kg/brief.ts` targets fixed Mudon slugs regardless of
  the project record (`void project`): `community:mudon-al-naseem`,
  `property:villa-mudon-4br-first-floor`, budget tiers `["mid","premium",
  "luxury"]`, and a 6-style key→slug map (`contemporary-majlis`,
  `modern-hijazi`, `coastal-emirati`, `scandi-arabic`, `andalusian-heritage`,
  `luxe-minimal`→`style:minimalist`).
- **Caveat:** the KG seed/loader/docker live in a **separate standalone module**
  (`../RennovAIte/kg`); this repo only vendors `kg/retrieval/agent.ts`. The
  Mudon KG nodes those slugs resolve against are **not** version-controlled
  here — they must be seeded in the external module's Neo4j. The in-repo Mudon
  facts are the pricing actuals in `lib/ground-truth/`, a separate concern.
- `kg_bundle_id` is generated in the agent and persisted on `renders` /
  `boqs` / `feedback_events` only when grounding actually ran.

## 11. Test runner + fixtures [code]

- Runner: **vitest** (`npm test` → `vitest run`). No other runner. **`tsx` is
  not available**; `.ts` scripts run via `node` directly per their headers.
- 13 test files under `lib/**/__tests__/` (87 tests): boq (joinery-aluminum,
  quantify, scope), compliance (triggers), drawings (dimension-closure,
  render-smoke), overlays (seed), plan (geometry, plan-interaction), viewer
  (scene), whatif (engine), and `lib/__tests__/smoke.test.ts`.
- Fixtures: `lib/boq/fixtures/mudon-first-floor.ts` and
  `lib/plan/__tests__/mudon.fixture.ts` (canonical Mudon geometry).

## 12. Sprint-relevant spot checks

- **(S1) Image-upload routes + body limits.** Only **two** routes read an
  uploaded file, both `multipart/form-data` via `request.formData()`, field
  name `file`: `app/api/upload/route.ts` (PDF/PNG/JPEG, 20 MB manual cap
  `MAX_SIZE_BYTES`, bucket `plan-uploads` at `<projectId>/<uuid>.<ext>`) and
  `app/api/room-photo/route.ts` (PNG/JPEG only, 20 MB cap, same bucket at
  `<projectId>/rooms/<roomId>/<uuid>.<ext>`, DB row in `room_photos`). Both:
  `runtime="nodejs"`, `dynamic="force-dynamic"`, no `maxDuration`. **There is
  no framework-level body-size limit** — `next.config.ts` has no `bodyParser`/
  `serverActions.bodySizeLimit` override, and App Router route handlers have no
  built-in cap. New upload routes must enforce their own `file.size` check
  (copy the 20 MB pattern). Render/parse-plan routes take JSON (base64/URL),
  not uploads.
- **(S2) Existing asset/photo tables.** `room_photos` (migration 010) already
  stores per-room uploaded photos (columns incl. `public_url`; render pipeline
  reads `room_photos.public_url`). Plan uploads live in the Storage bucket
  `plan-uploads`. **S2 should extend `room_photos` / the `plan-uploads` bucket
  rather than create a parallel table** unless a genuinely new asset class is
  needed.
- **(S4-BUY) Openings.** **No openings schema exists anywhere** — no table, no
  persisted wall/opening rows. The geometry contract explicitly returns
  `openings: []` with `openings_empty: true` and "we never invent doors"
  (`lib/plan/geometry.ts`). Walls are **derived** from shared polygon edges.
  Any S4-BUY branch that needs openings starts from zero schema.
- **(SV) Status doc.** `PILOT_SEVEN_STATUS.md` is at the **repo root**
  (`C:\dev\rennovaite\PILOT_SEVEN_STATUS.md`). SV renames it. Its
  migration-application table (020/021 "not yet applied") is stale — see §7.

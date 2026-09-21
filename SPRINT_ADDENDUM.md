# Sprint-3 Addendum — confirmed facts (pre-flight)

_Prepend this block to every Sprint-3 prompt. It **supersedes** the Sprint-2
addendum (itself superseding Sprint-1 and the Pilot-Seven P0 addendum; all are
in git history). Every fact below was re-verified against the code and the
database during the Sprint-3 pre-flight on **2026-09-21**. Facts read from the
running database are marked **[DB]**; facts read from source are marked
**[code]**. Nothing here was carried over unverified._

> **Which database "[DB]" means changed during the garden series.** As of I8,
> `.env.local` **and** the Supabase CLI link (`supabase/.temp/project-ref`)
> both point at the **dev** project `askzyqgcnjmbqegfifxq`, not production
> (`efrcgktrlsjnzkzzuhof`, `PRODUCTION_REF` in `scripts/_target-guard.mjs`).
> Every [DB] fact below is **dev**. Production was **not** probed in this
> pre-flight — no production credentials are in `.env.local`, by design.

---

## 00. Standing rules — verification hygiene

Two rules that hold for every sprint, every phase, and every agent working in
this repo. Both were written after being broken, which is why they are here
rather than assumed.

### Verification never writes to production data

**Mudon pilot villa (`6b5fda9d`) is calibration ground truth, not a test
fixture**, and so are the garden ground truth (`8d460645`, Villa 94) and the
live client garden (`ec4497c7`, Arabella). Their rows are evidence.

So: **do not write to production data to make a test pass.** If a check needs
state that does not exist — a different locked style, an overlapping plan, a
project with no BoQ — create it on a **scratch project** or a **local seed**,
not on a ground-truth or client project. The garden series has a purpose-built
stand-in for this: `12904f6d` "Client garden stand-in (isolation fixture)",
seeded from the same records by `scripts/lib/garden-seed.ts`.

This was broken during F1: a `style_choices` row was inserted against Mudon to
demonstrate that changing the StyleBoard updates the walkthrough. It was
deleted afterwards, but "I put it back" is not the same as "I did not touch
it" — a crash between the write and the delete leaves the pilot villa in a
state nobody chose. Read production; fabricate elsewhere.

Where a write is genuinely unavoidable, the pre-destructive-operation ritual in
`POST_DEMO_FOLLOWUPS.md` applies in full: count the blast radius before, state
it, and re-count after. Scripts that can write refuse production unless
`ALLOW_PROD_WRITE=1` (`scripts/_target-guard.mjs`).

### Never edit `.env.local`

It holds live secrets, it is the one file whose loss cannot be recovered from
git, and it is shared with whatever else is running on the machine. **Do not
add flags to it, even briefly, even with a backup.**

To run with a flag on, pass it inline — the process gets the variable and the
file is never touched:

```bash
TEXTURED_WALKTHROUGH=true npm run dev
```

```bash
GARDEN_PILOT_ENABLED=true DRAWINGS_ENABLED=true npm run dev
```

On this Windows machine the preview config `.claude/launch.json` has a
`garden` entry that does exactly this (`set GARDEN_PILOT_ENABLED=true&& …`,
port 3098) — that file carries an **uncommitted** local modification; leave it
out of commits unless asked.

---

## 0. Repo state at pre-flight

- Base is **`master` @ `64b07ff`** (merge of PR #58
  `fix/garden-front-border-unmapped` — the "G5e" follow-up to G5d; no commit is
  literally labelled G5e). The whole garden pilot G1 → G5d landed as PR #57
  (`26061ff`). Working tree: `.claude/launch.json` modified (local preview
  config) and an untracked `QS Package/`; nothing else.
- Baseline is **GREEN** (re-run 2026-09-21):
  - `tsc --noEmit` **0 errors**
  - `eslint` **0 errors**, 1 pre-existing warning (custom fonts,
    `app/layout.tsx:71`)
  - `vitest run` **694 tests / 61 files, all passing** (was 152 / 18 at
    Sprint-2)
  - `next build` **exit 0** — 25 `page.tsx` routes, 41 API `route.ts` files
  - `npm run db:check` — "history intact — no migration has been edited or
    removed"
- Next.js **16.2.4**, React **19.2.4**, TypeScript 5, Tailwind v4, zod 4,
  three 0.185 / r3f 9 / drei 10. App Router. **Read
  `node_modules/next/dist/docs/` before writing Next code — this is not the
  Next.js in your training data** (per `AGENTS.md`).
- **The status-file rename (SV) still has not landed** — `PILOT_SEVEN_STATUS.md`
  is at the root and its migration table is stale. Use §1 below, not that file.

## 1. Migrations — high-water mark **040**, ALL APPLIED on dev [DB]

**This moved.** Sprint-2 ended at 030. The garden series added **031–040**, and
they exist **only** in `supabase/migrations/`
(`20260101003100_…` → `20260101004000_session_capture.sql`, 40 files total).
`scripts/migrations/` is **frozen at 030** — it is the historical record, must
not be edited, and must not gain new files. Apply with `npm run db:manifest` +
`npm run db:push` (the wrapper refuses when the CLI link and `.env.local`
disagree); see `docs/MIGRATIONS.md`.

Probed one artefact per migration against dev, 2026-09-21 — all present:

| # | Name | Artefact probed |
|---|---|---|
| 031 | authored plans + outdoor zones | `plans.source, plot_width_m`, `rooms.unroofed`, `plan_elements` |
| 032 | rate_book internal_ref | `rate_book.internal_ref` |
| 033 | plan element variant | `plan_elements.variant` |
| 034 | landscape fixtures | (CHECK change on `plan_fixtures` — not column-probeable; 035+ depend on it) |
| 035 | garden documents | `rooms.area_derived_m2`, `renders.view`, `boq_outcomes.delta_lines` |
| 036 | garden scene | `rooms.level_mm, spec`, `plan_context`, `renders.camera` |
| 037 | client garden draft | `plans.dims_derived`, `rooms.disposition`, `boq_corrections`, `pilot_events` |
| 038 | project display name | `projects.display_name` |
| 039 | garden gates | `plan_openings.context_id, spec` |
| 040 | session capture | `boq_corrections.attributed_to, confidence, session_ref`, `plan_context.spec` |

Probe a column the migration actually **creates** — a missing column and a
missing table look identical through PostgREST.

Live dev counts [DB]: `projects` 4 · `plans` 4 · `rooms` 36 · `takeoff_items`
113 · `boqs` 58 · `rate_book` **35** (15 `seed` + 20 `actual_transaction`
`garden.%`) · `boq_outcomes` 1 · `boq_corrections` 3 · `pilot_events` 279 ·
`plan_elements` 16 · `plan_context` 33 · `plan_fixtures` 109 ·
`plan_openings` 1 · `renders` 394 · `pricing_skus` 600 · `labour_rates` 52.

**Dev is not a copy of production.** The 46 Mudon interior
`actual_transaction` rate rows and Mudon's `boq_outcomes` entry #1 are **not**
in dev; dev's single `boq_outcomes` row is garden entry #2 (below). Anything
that needs Mudon actuals from the DB must be verified against production
read-only, or run from the ground-truth modules (which is what the engine does
anyway — §3.3).

## 2. Feature flags — current states [.env.local + code]

All flags are `process.env.X === "true"`, **read at server start — flipping one
requires a dev-server restart.** Every flag defaults **off**; off == pre-flag
behaviour.

| Flag | `.env.local` | Gates |
|---|---|---|
| `KG_ENABLED` | **true** | KG grounding (also needs Neo4j reachable) |
| `DRAWINGS_ENABLED` | **true** | `/project/[id]/drawings`, drawing/render-pack/BoQ-PDF/parity routes |
| `OVERLAYS_ENABLED` | **true** | electrical/plumbing overlays + their BoQ sections |
| `VIEWER_3D_ENABLED` | **true** | `/project/[id]/viewer` (also gates P4 inspect) |
| `WHATIF_ENABLED` | **true** | grade toggles / budget dial over the BoQ |
| `PERMIT_CHECK_ENABLED` | **true** | Dubai permit-trigger checklist |
| `STAGING_ENABLED` | **true** | furniture staging prompt block + optional BoQ section |
| `PROPERTY_OS_LANDING` | **true** | `/` = Property OS intro; homepage at `/rennovaite` |
| `TASTE_SEED_ENABLED` | **false** | B3 — the project moodboard conditions renders |
| `TEXTURED_WALKTHROUGH` | **true** | F1 — 3D walkthrough reads StyleBoard finishes |
| `GARDEN_PILOT_ENABLED` | **unset** (new) | G1+: authored plans, outdoor zones, elements layer, photo pairs. Run inline / via the `garden` launch config |
| `BOQ_ENGINE` | **unset** | unset = deterministic `lib/boq` engine; `"llm"` = legacy Claude path |
| `RENDER_MODEL` | **unset** | default `google/nano-banana` |
| `PARSE_PROVIDER` | **unset** | defaults to `"inhouse"`; anything else throws |

**Changed since Sprint-2:** `GARDEN_PILOT_ENABLED` is new (13 `process.env`
reads) and deliberately **not** in `.env.local` — the garden series always ran
it inline. Non-flag env added by I8: `ALLOW_PROD_WRITE`, `DEV_/PROD_SUPABASE_URL`,
`DEV_/PROD_SERVICE_ROLE_KEY` (script target guard only; not in `.env.local`).
No other flag value changed.

## 3. BoQ · takeoff · rate_book · boq_outcomes shapes

### 3.1 BoQ storage [code + DB]

- One **jsonb** column, `boqs.sections`, holding the whole document:
  `{ sections: BoqSection[], subtotal_aed, contingency_pct, contingency_aed,
  vat_pct, vat_aed, grand_total_aed, engine{…}, programme?, garden? }` — the
  array lives at `boqs.sections.sections`. `programme` (G5d,
  `lib/boq/programme.ts`) is an indicative delivery programme, **never a line**.
- `BoqSection = { work_section, lines, section_total_aed }`. `work_section` is
  a **POMI** enum (`lib/boq/schema.ts`). Garden additions: `External Works`,
  `Landscape Structures`, `Irrigation`, `External Lighting` (G2) and the G3
  garden grouping (Preliminaries · Demolition · Hardscape & Structures · Soft
  Landscaping · Irrigation · Electrical & Lighting), merged into existing
  sections when a project has both.
- `BoqLine` optional fields now: `element_refs`, **`rate_status` ∈
  `indicative | site_assessment | needs_qs | needs_selection`** (was two
  values), and **`qty_derived`** (a quantity scaled or measured off derived
  geometry — distinct from `rate_status`, which is about the price).
- Validate with `BoqSchema` / `BoqSectionSchema` / `BoqLineSchema` at the
  boundary. **Never** hand raw model output into a render or a DB write.

### 3.2 takeoff_items (017) [code + DB]

Unchanged shape. One row per `(project × work_item)` or
`(element × work_item)`; aggregated POMI line quantity = Σ of its take-off
items, `element_refs` = their element ids. The garden take-off
(`lib/boq/garden-takeoff.ts`) writes per-zone/per-run rows too (lumps write
none). 113 rows on dev.

### 3.3 rate_book (018 + 022 + 032) [code + DB]

Columns as before plus 032's **`internal_ref`** (contractor identity — rendered
nowhere; `source` carries the public label). **Important correction to the
mental model: `rate_book` is not on either BoQ pricing path** — see spot-check
(a). Its only runtime reader is the what-if engine (`lib/whatif/rate-book.ts`).
Interior pricing resolves from `labour_rates` + `pricing_skus` +
`RATE_RULES`; garden pricing resolves from constants in
`lib/ground-truth/villa94-garden.ts`. The seeders copy those constants into
`rate_book` as a record, not as the source the engine reads.

### 3.4 boq_outcomes (023 + 035) + delta log [DB]

035 added `delta_lines` (per-line class + reason). Dev holds **entry #2 only**:
Villa 94 garden `8d460645` — platform **147,679.18** vs actual **152,059.44**
→ **−2.88 %** (10/14 quantity lines within ±10 %), recorded 2026-09-12. Entry
#1 (Mudon, +1.6 %) lives in production.

### 3.5 boq_corrections (037 + 040) [code + DB]

`correction_type` ∈ rate | quantity | scope | design | **confirm**;
`provenance` is always `market_fair`; 040 adds `attributed_to` (free text —
the firm), `confidence` ∈ firm | estimate, `session_ref`. **3 rows on dev**,
all `attributed_to: "Newspace"`, `session_ref: "three-firms #1 — Arabella
design session, Sep 2026"` (1 confirm, 1 scope, 1 design). Captured, counted
by `computePilotMetrics`, **never applied to any price**.

### 3.6 Read-time-only sections [code]

- **Joinery & Aluminum** (`lib/boq/joinery-aluminum.ts`) — composites +
  site-assessment allowances.
- **Furniture (optional)** (P7) — separate prop to `BoqView`, never in
  `boqs.sections`.

## 4. Openings [code + DB]

`plan_openings` (026) as documented in Sprint-2, plus **039**: `kind` now
includes **`gate`**, `context_id` (the `plan_context` wall it sits in — never
re-snapped), `spec`, and the site-reference columns (`site_reference`,
`disposition`, `dims_derived`, `derived_note`). **1 row on dev** (the Arabella
separator gate). Interior opening drawing UI (R2) is still unbuilt; the
door/window schedule is still the missing A5 consumer.

## 5. Parse provider config [code]

Unchanged: `getParseProvider()` reads `PARSE_PROVIDER ?? "inhouse"`; any other
value throws. `lib/parse/sheet/pdf.ts` (mupdf) extracts text + vectors from
plan sheets. The CubiCasa adapter is still `TODO(S4b)`.

## 6. Project asset library [code]

Unchanged shape (024). `kind` ∈ floorplan / drawing_mep / drawing_electrical /
drawing_hvac / photo / reference_image / other — **there is no `quotation`
kind** (relevant to spot-check b). `AssetPicker` is also used by the B2
moodboard.

## 7. Render lineage [code + DB]

`renders` gained `view` (day | evening, 035) and `camera` (036) alongside the
Sprint-2 columns; `mode` now also takes `photo_pair`, and scene renders carry
the gate verdict + `reused_from` (G5d per-view reuse). Scene cache keys start
with the project id. **394 rows on dev.** Garden pipeline version `g5d-2`.

## 8. KG env + resolver IDs [code]

Unchanged from Sprint-2. `docker start rennovaite-neo4j`; the seed/loader/
compose live in the separate OneDrive KG module. Resolver still targets fixed
Mudon slugs regardless of project.

## 9. Projects on dev [DB]

| id | name | role |
|---|---|---|
| `6b5fda9d` | Demo villa (dev) | the Mudon demo, dev copy |
| `8d460645` | Villa 94 garden (ground truth) — display "Contemporary Villa Garden — Completed Renovation" | garden ground truth, delta-log #2 |
| `ec4497c7` | Arabella Garden — Draft for Review | live client garden (G5 → G5e) |
| `12904f6d` | Client garden stand-in (isolation fixture) | scratch — the one to write to |

## 10. Test runner + fixtures [code]

- Runner: **vitest** (`npm test`). **`tsx` is not available** — `.ts`
  scripts run via `node --import ./scripts/_alias-hook.mjs <script>`.
- **61 files, 694 tests**, all passing. Still pure-module tests (plus scene /
  sheet SVG assertions); **no component or route tests exist**.
- Fixtures: `lib/boq/fixtures/mudon-first-floor.ts`,
  `lib/plan/__tests__/{mudon,synthetic}.fixture(s).ts`,
  `lib/ground-truth/villa94-garden-geometry.ts`,
  `lib/client-garden/arabella-reference.ts`.

---

## 11. Sprint-3 spot checks (report only — nothing changed)

### (a) Rate resolution order; where a per-firm overlay slots in; where firm-attributed `market_fair` corrections live

**Interior** (`app/api/generate-boq/route.ts` → `lib/boq/engine.ts`): the route
loads `labour_rates` (route.ts:580) and `pricing_skus` (:586), then
`generateDeterministicBoq` (:759) builds a `RateResolver` (engine.ts:32) and
resolves per take-off item (rates.ts:139–238):

1. no `RATE_RULES[item_key]` → **throws**;
2. material rule → `pricing_skus` filtered by category/subcategory, SKU picked
   at the tier percentile;
3. material rule with an empty pool → `rule.allowance_aed`, else throws;
4. labour rule → exact `(work_section, description)` match in `labour_rates`,
   band by tier; missing → throws;
5. allowance-only rule → `rule.allowance_aed`;
6. **then** the accessory selection is laid over the result (`applyAccessory`,
   rates.ts:76–117, from `loadAccessoryOverrides`, route.ts:787).

After the engine, sections with their own rates are appended: overlays
(`FIXTURE_META.unitRateAed` or 0/`needs_qs`), joinery/aluminium (constants in
`mudon-actuals.ts`), garden (below).

**Garden** (`appendGardenSections` → `priceGardenTakeoff`,
garden-takeoff.ts:616): `UNPRICED_GARDEN_ITEMS` → 0 / `needs_qs` under
`UNPRICED_SOURCE_LABEL`; otherwise `rate()` (:248) → `getGardenRate`
(villa94-garden.ts:211), module constants, missing → throws; then
`rate_factor` (irrigation band).

**Neither path reads `rate_book`.** Only what-if does (`loadRateBook`: newest
`valid_from`, then provenance, per `(item_key, grade)` — note it does **not**
key on `scope`, despite 022's comment). Furniture: `furniture_prices` over
`FURNITURE_PRICES`.

**Where a per-firm overlay slots in** — the same seam as accessories, twice:
- interior: an optional `firmRates` argument to `RateResolver`, applied after
  `resolveFromRules` and before/alongside `applyAccessory` (rates.ts:139),
  threaded through `EngineInput` from route.ts:759;
- garden: `rate()` at garden-takeoff.ts:248 is the single choke point —
  `priceGardenTakeoff` takes an optional firm map, `appendGardenSections`
  loads it.
- storage: there is **no firms entity** (no `firms`/`contractors` table;
  `vendor_selections` is per-SKU, `pricing_skus.vendor` is free text). A firm
  overlay needs either a firm-keyed rate table or `rate_book.firm_ref`, and
  **both pricing paths would need new code to read the DB at all.**
- identity constraint: migration 040's own comment says firm identity lives on
  its own corrections "and nowhere else (never on a rate book row, never on a
  client document)". A firm overlay must therefore keep identity in an
  internal-only column (the `internal_ref` pattern) and put a neutral label in
  `source` / `vendor_or_source` — or that rule is consciously revised.

**Where `market_fair` corrections with firm identity live today:**
`boq_corrections` (037, extended by 040). Written by `POST /api/boq-corrections`
(always `provenance: "market_fair"`, also writes a `correction` pilot event)
from `ReviewCorrections` (mounted at `boq/page.tsx:314`) and from
`scripts/arabella-session-apply.ts` with `attributed_to: SESSION_FIRM`
(`"Newspace"`, `lib/client-garden/arabella-session.ts:46`). Read by
`GET /api/boq-corrections` and `computePilotMetrics` (counts only). Nothing in
`lib/boq`, `lib/whatif` or `generate-boq` references the table.

**Found in passing (not fixed — flag for the owner):** the identity rule is
held on the garden path but **not** on the Mudon interior seed —
`scripts/seed-rate-book-actuals.ts:58–93` writes supplier/contractor names and
cart references into `rate_book.source`. What-if copies `source` into
`perChange[].source` (`lib/whatif/engine.ts:137`); no BoQ component renders it
today, so it is latent, not a visible leak. Production-only (those rows are not
on dev).

### (b) The S6 / P8 document-ingestion path

**What they are.** **S6** is "S6-pre" — pre-review *scope components*
(`docs/S6_PRE_SCOPE_COMPONENTS.md`): Newspace's column-G annotations on the
Mudon delta log became four flagged rules R-45…R-48 (AED 13,445,
`lib/boq/scope-components.ts`). It is not an ingestion mechanism. **P8** is the
ground-truth ingestion: one workbook → one hand-structured TypeScript module
(`lib/ground-truth/mudon-actuals.ts`, `villa94-garden.ts`), "unzip + sheet
XML, never retyped", then seed scripts write `rate_book`
(`provenance: actual_transaction`) and `boq_outcomes`
(`scripts/record-*-outcome.ts`).

**Input / output.** Input is a specific, known xlsx (sheet names and cells
known in advance). Output is module constants, `rate_book` rows and a
`boq_outcomes` row. The only xlsx reader in the repo is `readWorkbook()` inside
`scripts/arabella-session-apply.ts:83–102` (`fflate` unzip + regex over
`sharedStrings`/sheet XML → cell→string map; no types, dates, formulas or
merged cells; `fflate` is only a **transitive** dependency). Validation is
`check()` assertions against expected constants — no zod. **Script-only**, run
with the service-role key; no route, no UI.

**What a "quotation" would need that it lacks:**
1. **Generic tabular extraction** — header detection, qty/unit/rate/amount
   columns, number/unit/date parsing. Today every reader is bespoke.
2. **PDF quote extraction** — mupdf exists but only for plan sheets; no table
   reconstruction, OCR or LLM extraction (which would need a zod schema).
3. **Line → `item_key` / POMI mapping** with confidence and a review queue;
   inclusion/absorption rules (`INCLUSIVE_SCOPE`, `ABSORBED_SCOPE`) are
   hand-coded per project.
4. **A quote entity** — counterparty, reference, date, validity/expiry,
   subtotal/discount/VAT, payment terms, source-file link. `rate_book` has
   `valid_from` only; `boq_outcomes` is totals.
5. **Net vs list policy as data** — discounts are handled per module (0.6
   tiles, 0.88 garden, labour discount undistributed); nothing records whether
   a discount is relationship pricing or repeatable market price.
6. **Identity handling enforced, not per-script** — a counterparty table with
   internal-only identity (see (a)'s Mudon finding).
7. **Provenance vocabulary** — CHECK allows only `seed | indicative |
   actual_transaction`; a quote is neither transacted nor seed, and expiry /
   supersession has no value.
8. **Additive persistence** — both seeders delete-then-insert
   (`actual_transaction` wholesale, or `garden.%`), so a second quote would
   erase the first.
9. **Upload + review surface** — no `quotation` asset kind, no staging table
   for parsed lines, nothing ever flips `qs_validated`.
10. **Structured inclusions/exclusions/variations** — bespoke constants today.

### (c) Where BoQ figures render — one component or scattered (I4 sizing)

**Scattered.** ~10 UI surfaces + the BoQ PDF, ~30 render sites, **11+ local AED
formatters** that disagree on rounding, the `AED` prefix, sign style and k/M
shortening. The only shared helper is `derivedTotal()`
(`lib/documents/boq-derived.ts`), used by the BoQ page headline and the PDF.

| Surface | Figures | Number source |
|---|---|---|
| `boq/_components/boq-view.tsx` (~15 sites) | headline/footer total (:472, :678), budget/headroom (:480–495), section bar (:518), sensitivity (:774–808), section totals (:1070), line rate/total (:1003–1006, :1201–1204, bare `toLocaleString`), room rollup (:885–900), furniture (:952), programme (:1322) | stored jsonb + client recompute (sensitivity, what-if, furniture) |
| `boq/_components/whatif-sidebar.tsx` | Δ, baseline → scenario, per-option Δ, budget target | recomputed (`lib/whatif/engine.ts`) |
| `app/project/[id]/page.tsx:695–720` (hub) | spent of budget, materials/labour split | stored `boqs.total_aed` + recompute |
| `app/dashboard/page.tsx:288, 362` | activity "BoQ priced at…", BoQ value stat | stored, summed |
| `dashboard/_components/portfolio-browser.tsx` | budget, BoQ total, over/under | stored |
| `vendors/_components/vendor-picker.tsx` | live grand total, Δ, SKU prices | recomputed client-side (subtotal+contingency+VAT) |
| `render/_components/render-interactive.tsx:534` | room BoQ chip | recomputed room rollup |
| `accessories/_components/accessory-picker.tsx` | effective rate, rate×qty, Δ | recomputed |
| `components/viewer/InspectPanel.tsx:100` (viewer, drawings, plan layers) | per-element line totals | stored |
| `style/_components/style-grid.tsx` | style Δ vs a static 850k baseline | static |
| `lib/documents/boq-pdf.ts` | line, section, subtotal, contingency, VAT, grand total | stored + `derivedTotal` |

Notes: the **web UI never shows subtotal / contingency / VAT** (only the PDF
does; the vendor picker computes them silently). There is no separate garden
BoQ page — gardens render through `boq-view`. The render pack carries **no**
AED by design (test-enforced). **Sizing for I4: L** (a low L if scoped to BoQ
page + PDF + hub + dashboard). The first step is one shared `lib/format/aed`
with range/derived variants; the hard part is that the recomputed figures
(what-if, sensitivity, vendor, rollups) would diverge from stored ones unless
they carry the same markers.

### (d) Pack generation — UI-reachable vs script-only

| Piece | Route | UI entry | Gate |
|---|---|---|---|
| Drawing set, per sheet | `GET /api/projects/[id]/drawings?format=pdf&sheet=<n>` | `drawings/page.tsx:219` | `DRAWINGS_ENABLED` |
| Drawing set, whole (`sheet=all`) | same | `drawings/page.tsx:144` | `DRAWINGS_ENABLED` |
| Render pack PDF (incl. design-assumptions page) | `GET /api/projects/[id]/render-pack` | `drawings/page.tsx:153` (plain link) | `DRAWINGS_ENABLED`; 409 on not-ready / parity fail |
| Render pack `?format=json/pages` | same | **none** | — |
| BoQ PDF | `GET /api/projects/[id]/boq-pdf` | `boq-view.tsx:545` (garden BoQs only) | route needs `DRAWINGS_ENABLED`, **button is not gated** → can 404 |
| "Generate all" batch | `POST /api/render/batch` → `/render/scene`, `/render/evening` | `render-interactive.tsx:421` → `generate-all.tsx` | none |
| Parity gate | `GET /api/projects/[id]/parity` | **none** (surfaces only as the render-pack 409 JSON) | `DRAWINGS_ENABLED` |
| Pack readiness | inside render-pack + boq-pdf | none of its own | — |
| Photo pairs | `POST/GET /api/render/photo-pair` | **none** | `GARDEN_PILOT_ENABLED` |
| Consistency gate | `POST /api/render/consistency` (and inside `renderGardenCamera` when an anchor is passed) | **none** — the UI batch client never sends an anchor (`lib/render-batch/client.ts:130`) | none |
| `display_name` | `PATCH /api/projects/[id]` | **none** | — |

**Script-only today:**
1. **Consistency gate + anchor strategy** — anchor-first ordering, retry
   against the anchor (`scripts/lib/garden-render-run.ts:95–120`). Renders
   produced from the UI are never cross-checked for "one garden, not three".
2. **Photo pairs** — one per zone with second-photo fallback
   (`garden-draft-pack.ts:125–146`); no UI at all.
3. **Parity / readiness visibility** — a failure is a raw 409 JSON body behind
   a link.
4. **Printed-content assertions** — draft watermark, derived total,
   contractor-identity / "ground truth" / house-number / metadata leak checks
   (`garden-draft-pack.ts`, `garden-reference-pack.ts`).
5. **`display_name`** — set only by script or direct PATCH.
6. **Bundled output** — PDFs + gate table + metrics + Step-5 baseline written
   together; the UI downloads each PDF separately.
7. Everything else in `scripts/garden-*`, `arabella-*`, `record-*-outcome`
   (dry-runs, change report, isolation check, session apply, seeding) is
   script-only by design.

---

## 12. Pre-flight verdict — **GO**

Baseline is green on every gate (tsc, eslint, 694/694, build, migration
history), migrations 031–040 are applied on the database the app targets, and
nothing in the spot-checks blocks starting Sprint 3. Carry these into scoping:

- **Firm overlay (a)** is new plumbing, not configuration: neither pricing path
  reads `rate_book`, and no firms entity exists. It must be designed around the
  040 identity rule.
- **Quotation ingest (b)** is near-greenfield; the P8 pattern does not
  generalise and its seeders are destructive on re-run.
- **I4 (c)** is **L**; decide up front whether recomputed client-side figures
  are in scope.
- **Pack (d)**: the consistency gate and photo pairs are script-only — a
  UI-generated garden pack is *not* equivalent to a script-generated one.
- Production was not probed; confirm 031–040 on production before any deploy.
- Mudon interior seed leaks supplier names into `rate_book.source` (latent).

# Sprint-2 Addendum — confirmed facts (R2 · Design Journey)

_Prepend this block to every Sprint-2 prompt. It **supersedes** the Sprint-1
addendum, which superseded the Pilot-Seven P0 addendum. Every fact below was
re-verified against the code and the live database during the Sprint-2
pre-flight on **2026-09-01**. Facts read from the running database are marked
**[DB]**; facts read from source are marked **[code]**. Nothing here was
carried over unverified._

---

## 0. Repo state at pre-flight

- Base is **`master` @ `da0394d`** (merge of `feat/property-os-landing`).
  Working tree clean except `.claude/settings.local.json`. The full Sprint-1
  series is merged: `8039daf` 413/compression fix · `790cc24` project asset
  library (A3/A4/C2) · `e0f70ba`/`a658a76`/`9f1598f`/`fedbc88`/`25d4ec1`/
  `f38d7e8`/`ac448e4` parse overhaul + provider interface · `4ba9195` openings
  plumbing (A5) · `0418829` dashboard+my-projects merge (G1) · `13ce4dc`
  Property OS landing.
- **The status-file rename (SV) did NOT land.** `PILOT_SEVEN_STATUS.md` is
  still at the repo root and has not been touched since `e33005b`. Its
  migration-application table is **stale** (see §1). Treat SV as outstanding.
- Baseline is **GREEN**: `tsc --noEmit` **0 errors** · `eslint` **0 errors**
  (1 pre-existing warning — custom fonts, `app/layout.tsx:71`) · `vitest run`
  **152 tests / 18 files, all passing** · `next build` **exit 0**, 19 page
  routes + 27 API routes.
- Next.js **16.2.4**, React **19.2.4**, TypeScript 5, Tailwind v4, zod 4,
  three 0.185 / r3f 9 / drei 10. App Router. **Read
  `node_modules/next/dist/docs/` before writing Next code — this is not the
  Next.js in your training data** (per `AGENTS.md`).

## 1. Migrations — high-water mark **026**, all applied [DB]

Files `scripts/migrations/001…026`. **There is no migration runner** — DDL is
pasted into the Supabase SQL editor by hand (the service-role JWT cannot run
DDL). Every migration through **026 is live**, including the three Sprint-1
ones:

| # | Table / change | Live? | Rows [DB] |
|---|---|---|---|
| 024 | `project_assets` | yes | 3 |
| 025 | `rooms.confidence` + `parse_metrics` | yes | column present (all `null`); `parse_metrics` 0 |
| 026 | `plan_openings` | yes | **0** |

Other live counts [DB]: `projects` 7 · `plans` 7 · `rooms` 93 · `renders` 48 ·
`boqs` 14 · `style_choices` 19 · `room_photos` 4 · `plan_fixtures` 151 ·
`plan_snapshots` 6 · `drawing_sets` 1 · `takeoff_items` 184 · `rate_book` 61 ·
`boq_outcomes` 1 · `whatif_scenarios` 56 · `permit_checks` 320 ·
`furniture_opt_ins` 1 · `furniture_prices` **0** (module fallback in use;
PK is `(item_key, tier)` — **no `id` column**) · `pricing_skus` 600 ·
`labour_rates` 52 · `vendor_selections` 3 · `approved_designs` 7 ·
`feedback_events` 23.

**A new Sprint-2 table = a new numbered SQL file (`027_…`), applied manually,
ending in `notify pgrst, 'reload schema';`, with the code degrading gracefully
until it is applied.** RLS is disabled on every table.

## 2. Feature flags — current states [.env.local + code]

All flags are `process.env.X === "true"`, **read at server start — flipping one
requires a dev-server restart.** Every flag defaults **off**; off == pre-flag
behaviour.

| Flag | `.env.local` | Gates |
|---|---|---|
| `KG_ENABLED` | **true** | KG grounding (also needs Neo4j reachable) |
| `DRAWINGS_ENABLED` | **true** | `/project/[id]/drawings` |
| `OVERLAYS_ENABLED` | **true** | electrical/plumbing overlays + their BoQ sections |
| `VIEWER_3D_ENABLED` | **true** | `/project/[id]/viewer` (also gates P4 inspect) |
| `WHATIF_ENABLED` | **true** | grade toggles / budget dial over the BoQ |
| `PERMIT_CHECK_ENABLED` | **true** | Dubai permit-trigger checklist |
| `STAGING_ENABLED` | **true** | furniture staging prompt block + optional BoQ section |
| `PROPERTY_OS_LANDING` | **true** | `/` = Property OS intro; homepage at `/rennovaite` |
| `BOQ_ENGINE` | **unset** | unset = deterministic `lib/boq` engine; `"llm"` = legacy Claude path |
| `RENDER_MODEL` | **unset** | default `google/nano-banana` |
| `PARSE_PROVIDER` | **unset** | defaults to `"inhouse"` — see §5 |

**`PARSE_PROVIDER` is undocumented**: it appears in neither
`.env.local.example` nor the CLAUDE.md env table. Sprint-2 should add it.

## 3. BoQ · takeoff · rate_book · boq_outcomes shapes

**No Sprint-1 change altered any of these four shapes.** The only Sprint-1
touch was `fedbc88` (true polygon perimeter for non-rectangular rooms), which
changes computed *values*, not the schema.

### 3.1 BoQ storage [code + DB]

- One **jsonb** column, `boqs.sections`, holding the whole document:
  `{ sections: BoqSection[], subtotal_aed, contingency_pct, contingency_aed,
  vat_pct, vat_aed, grand_total_aed, engine{…} }` — the array lives at
  `boqs.sections.sections`. Full `boqs` columns [DB]: `id, project_id,
  total_aed, sections, locked_at, created_at, kg_bundle_id`.
- `BoqSection = { work_section, lines, section_total_aed }`. `work_section` is
  a **POMI** enum — never a room, trade, or free-form name
  (`lib/boq/schema.ts`). Includes the P2 overlay sections
  `"Electrical Installations"` and `"Plumbing & Sanitary"`.
- `BoqLine` required: `description, quantity, unit, rate_aed, total_aed,
  vendor_or_source, notes, rule_id, kind, rate_band, wastage_pct`. Additive
  **optional** fields (pre-P2 lines still validate):
  - `element_refs: string[] | null` — the element/fixture ids the quantity was
    counted from (P2/P4/P5 build on this).
  - `rate_status: "priced" | "needs_qs"` — `needs_qs` (rate 0) renders a
    terracotta dot. Staging furniture uses a third value `"indicative"`, but
    that section is never written into `boqs.sections` (§3.5).
- Validate with `BoqSchema` / `BoqSectionSchema` / `BoqLineSchema` at the
  boundary. **Never** hand raw model output into a render or a DB write.

### 3.2 takeoff_items (017) [code + DB]

One row per `(project × work_item)` or `(element × work_item)`, computed
deterministically from the `PlanGraph` **before** POMI aggregation. Columns:
`project_id, plan_snapshot_id, work_item_key, room_id, element_id, qty, unit,
wet_area, computed_at`. **184 rows** for Mudon.

**Aggregation-at-assembly rule** (the element↔line contract): an aggregated
POMI line's `quantity` is the **SUM** over its take-off items and its
`element_refs` are those items' element ids. Per-room detail lives **only** in
`takeoff_items` + views — the stored POMI document never gains extra per-room
lines. `lib/boq/quantify.ts` is pure geometry (no LLM, no DB, no aggregation)
and unit-tested for "per-room sums == each aggregated line quantity".

Pipeline: `computeTakeoff` (F-xx formulas, `rules.ts`) → `rates.ts` (R-xx
resolution) → priced BoQ (`lib/boq/engine.ts`).

### 3.3 rate_book (018 + 022) [code + DB]

Columns: `city (default 'Dubai'), work_section, item_key, grade ∈
{economy,standard,premium}, unit, rate_aed (NET), source, qs_validated,
valid_from`, plus 022's `list_rate_aed`, `scope`
(`null | supply_only | install_only | supply_and_install`, CHECK), and
`provenance` (`seed | indicative | actual_transaction`, CHECK, default `seed`).

Resolution reads the **newest `valid_from`** per `(city, item_key, grade,
scope)` — the actuals reseed **supersedes** seed rows rather than deleting
them. **Live [DB]: 61 rows** — provenance `seed` 15 / `actual_transaction` 46;
scope `null` 15 / `supply_only` 22 / `install_only` 2 / `supply_and_install`
22. `indicative` is still unused in `rate_book` (it is the furniture marker
elsewhere). Unchanged since Sprint-1.

**Scope enforcement** (`lib/boq/scope.ts`, unit-tested): a
`supply_and_install` composite (joinery, aluminum) must never receive an added
install line; a `supply_only` line (tiles, sanitary) must be paired with its
`install_only` labour line or is flagged `install_missing`.

### 3.4 boq_outcomes (023) + delta log [DB]

Columns: `project_id, platform_boq_total, platform_by_section (jsonb),
actual_total, actual_by_section (jsonb), delta_pct, capture_gap_notes,
recorded_at`. **Entry #1 (Mudon) is still the only row and is unchanged**:
platform **460,470** vs actual **453,228.5036** → **delta +1.6 %**, recorded
2026-08-04. Written replace-in-place by `scripts/record-boq-outcome.ts`.

Ground truth: `lib/ground-truth/mudon-actuals.ts` (Villa 94, first floor,
`MUDON_M2 = 178.5`), transcribed from
`data/ground-truth/Mudon_Villa94_Ground_Truth_and_Delta_Log.xlsx`. Trade
totals: labour net 200,000 / tiles 39,263.94 / joinery 70,090.56 / aluminum
92,449 / sanitary 14,925. Known capture gaps: staircase renovation, office
build-out, terrace balcony, master-bath built-in, tile-supply split, openings
deductions.

### 3.5 Read-time-only sections [code]

- **Joinery & Aluminum** (`lib/boq/joinery-aluminum.ts`) — joinery as
  `supply_and_install` composites; aluminum & glass as **site-assessment
  allowances**, because the plan graph still has no real openings (§4.3).
- **Furniture (optional)** (P7) — built at read time by
  `lib/staging/furniture-boq.ts` + `collect.ts`, passed to `BoqView` as a
  **separate prop, never written into `boqs.sections`**, all lines
  `rate_status: "indicative"`. Every contractor-facing surface that reads the
  stored jsonb excludes it by construction.

## 4. Openings — the schema as actually built (A5) [code + DB]

### 4.1 Table `plan_openings` (migration 026, applied, **0 rows**)

Openings are first-class children of **walls**, not rooms.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `plan_id` | uuid NOT NULL → `plans` | cascade delete |
| `room_id` | uuid → `rooms` | nullable, `on delete set null` |
| `wall_ref` | text | a **hint only** — derived wall ids are volatile |
| `kind` | text NOT NULL | CHECK: door / window / archway |
| `width_mm`, `height_mm`, `sill_mm` | numeric | |
| `position` | jsonb | normalised `[x, y]` midpoint (same space as `rooms.polygon`) |
| `along_offset` | numeric | 0..1 along the wall |
| `source` | text NOT NULL, default `user_drawn` | CHECK: parsed / user_drawn |
| `derived` | boolean NOT NULL, default false | **true when dimensions were DEFAULTED** — a defaulted opening must never read as measured |
| `created_at` | timestamptz | |

Indexes on `plan_id` and `room_id`; RLS disabled.

### 4.2 Provider-contract support [code]

`lib/parse/providers/types.ts` defines `RawProvidedOpening`
(`wall_ref?, room_id?, type, width_mm?, height_mm?, sill_mm?, position,
along_offset?, derived?`) and an optional `RawParseResult.openings?`.
**The in-house Claude provider does not emit openings** — the field is
forward-looking for a hosted / vector-extraction provider. `RawParseResult`
also has an optional `walls?: unknown[]` that is **declared but not yet
consumed** (`buildPlanGraph` still derives walls from shared polygon edges).

### 4.3 Graph + BoQ consumption [code]

`buildPlanGraph` ingests openings and **snaps each to its nearest derived
wall** (because derived wall ids are volatile). `lib/boq/quantify.ts` already
deducts opening area from `wall_plaster` / `wall_paint` net.
`derivePlanGraph(projectId)` (`lib/plan/derive.ts`) reads `plan_openings`
best-effort. `DEFAULT_OPENING_DIMS` lives in `lib/plan/geometry.ts`.
Unit-tested in `lib/plan/__tests__/openings.test.ts`.

**Because the table is empty, every opening-dependent quantity is currently
running the zero-openings path** — joinery/aluminum are still allowances and
wall nets are still gross.

### 4.4 Editor entry points [code] — **route exists, UI does not**

`app/api/plan-openings/route.ts` implements `POST` (zod-validated; missing
dimensions are defaulted server-side from `DEFAULT_OPENING_DIMS` and flagged
`derived: true`; always writes `source: "user_drawn"`) and `DELETE` (by `id`).
**Nothing in `app/`, `components/`, or `lib/` calls this route** — grep for
`plan-openings` outside the route itself returns zero hits. The R2 2D
opening-drawing UI is **unbuilt**; the API contract is ready for it.

## 5. Parse provider config [code]

- `lib/parse/` = `constants.ts`, `repair.ts` (overlap repair, unit-tested),
  `providers/{index,inhouse,types}.ts`.
- `getParseProvider()` reads `process.env.PARSE_PROVIDER ?? "inhouse"`.
  **`"inhouse"` is the only accepted value today** — any other value **throws**
  (deliberately, so a typo cannot silently mis-parse). The hosted raster→vector
  adapter (CubiCasa) is tagged `TODO(S4b)` and needs a key + a confirmed
  image-ingest path + an upload-consent line.
- `ParseProvider = { readonly name: string; parse(asset: ParseAsset) }`;
  `ParseAsset` is `{kind:"pdf", data}` or `{kind:"image", data, mediaType}`.
  `RawParsedRoom` carries an **N-vertex normalised polygon following real walls
  (not a bounding box)** plus a 0..1 `confidence`. Everything downstream of the
  provider (repair → `buildPlanGraph`) is provider-agnostic.
- `parse_metrics` (025) records one row per parse and per correction-save:
  `kind ('parse'|'corrections'), provider, room_count, mean_confidence,
  low_confidence_count, corrections jsonb {move,resize,vertex,relabel,delete},
  correction_total, needed_split_count, needed_merge_count, detail, recorded_at`.
  Surfaced by `app/api/parse-metrics/route.ts`. **0 rows** — no parse has run
  since 025 was applied, and every `rooms.confidence` is still `null`.
- Strategy doc: `PARSE_STRATEGY.md` (build-vs-buy spike, A1b).

## 6. Project asset library [code + DB]

- **Table `project_assets`** (024): `id, project_id, kind, room_id,
  storage_path, filename, mime, bytes, uploaded_at, source`. CHECKs:
  `kind` ∈ floorplan / drawing_mep / drawing_electrical / drawing_hvac / photo
  / reference_image / other; `source` ∈ intake / render / moodboard, or null.
- **Storage**: the existing **public `plan-uploads`** bucket at
  `<projectId>/assets/<uuid>.<ext>` (the floorplan keeps
  `<projectId>/<uuid>.<ext>`; room photos keep
  `<projectId>/rooms/<roomId>/<uuid>.<ext>`). Public URLs are derived at read
  time — **no url column**.
- **Pure vocabulary/validation**: `lib/assets/types.ts` (`ASSET_KINDS`,
  `ASSET_SOURCES`, `DRAWING_KINDS`, `KIND_LABEL`, `KIND_ICON`,
  `DRAWING_DISCIPLINES`, `HUB_GROUPS`, `groupAssetsForHub`, `validateAssetFile`,
  `assetExtension`, `MAX_ASSET_BYTES = 25 MB`) — unit-tested. Server reads:
  `lib/assets/load.ts` (`ASSET_BUCKET`, `assetStoragePath`, `publicUrlForPath`,
  `toAssetLite`, `loadProjectAssets`, `loadProjectPhotoAssets`,
  `loadProjectAssetsOfKind`) — all degrade to `[]` if the table is absent.
- **Route** `app/api/project-asset/route.ts`: `POST` (multipart `file` +
  `project_id` + `kind` + `source?` + `room_id?`, per-kind validation, 25 MB
  structured 413, storage rollback on DB failure); `PATCH` assigns an existing
  photo asset to a room.
- **The reusable picker is `AssetPicker` at
  [`components/assets/AssetPicker.tsx`](components/assets/AssetPicker.tsx)**
  (exports `AssetPickerProps` + `AssetPicker`). Its **only** consumer today is
  `app/project/[id]/render/_components/render-interactive.tsx:1048`. Assigning
  a photo mirrors a `room_photos` row so the render pipeline is unchanged.
  The hub panel is
  [`components/assets/ProjectFilesPanel.tsx`](components/assets/ProjectFilesPanel.tsx).
- **Client compression** before every image upload: `lib/image/compress.ts`
  (EXIF-baked decode, long edge ≤ 2048 px, JPEG q0.85; ≤1 MB in-dimension
  originals pass through byte-identical; HEIC converted where decodable).
  Unit-tested in `lib/image/__tests__`. `next.config.ts` sets
  `experimental.proxyClientMaxBodySize: "25mb"`.
- **Live data [DB]**: 3 rows — two `floorplan`/`intake`, and one Mudon
  `photo`/`source:render` (`living-before.jpg`) already assigned to a room.

## 7. Render lineage [code + DB]

`renders` columns, verified live: `id, project_id, room_id, prompt, image_url,
parent_render_id, created_at, kg_bundle_id, source_image_url, model, mode,
prediction_id, status, qa, kind, staging_set`.

- `parent_render_id` threads tweak/iterate lineage.
- `mode` ∈ photo / offplan / tweak, with `source_image_url` and `model` as the
  provenance/A-B triple. `status` ∈ pending / succeeded / failed (default
  `succeeded`), `qa` = jsonb vision verdict, `kind` ∈ still / pano (default
  `still`), `staging_set` = jsonb (P7).
- **Prompt assembly order in `app/api/render/route.ts`**:
  `buildEditPrompt` → `Materials:` clause (`vendor_selections` → `pricing_skus`)
  → KG context → **STAGING block last** (so real KG fixtures keep precedence).
  The cache key is the prompt + `mode` + `source_image_url`, so flag-off and
  flag-on are simply two cache entries.
- **Image inputs**: `[sourceImageUrl, moodboardDataUri]` — the style moodboard
  is read from `public/moodboards/<key>-<room>.png` and passed as a **base64
  data URI** (Replicate fetches inputs from its own servers, so a localhost URL
  is unreachable).
- Prompt builders `lib/render-prompts.ts`; Replicate helpers
  `lib/render-image.ts`; grounding `lib/render-grounding.ts`.
- **48 render rows** live; older rows have `model`/`mode`/`source_image_url`
  `null` (pre-tracing).

## 8. KG env + resolver IDs [code]

- Env: `NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD` (`kg/retrieval/agent.ts`,
  dev default password `rennovaite_dev`) and `KG_ENABLED` (`lib/kg/context.ts`).
  `getKgContext` **never throws** — returns `{context:"", bundleId:null}` on
  disabled / unknown-style / 10 s timeout / error.
- Resolver `lib/kg/brief.ts` targets **fixed Mudon slugs regardless of the
  project record** (`void project`): community `community:mudon-al-naseem`,
  property `property:villa-mudon-4br-first-floor`, budget tiers
  `["mid","premium","luxury"]`, and the style map — `contemporary-majlis`,
  `modern-hijazi`, `coastal-emirati`, `scandi-arabic`, `andalusian-heritage`
  each to their own `style:<key>` node, and **`luxe-minimal` → `style:minimalist`**.
- **Caveat unchanged:** the KG seed/loader/docker live in a **separate
  standalone module** (`../RennovAIte/kg`); this repo only vendors
  `kg/retrieval/agent.ts`. The nodes those slugs resolve against are not
  version-controlled here.
- `kg_bundle_id` is persisted on `renders` / `boqs` / `feedback_events` only
  when grounding actually ran.

## 9. Canonical demo project [DB]

**`Mudon pilot villa` · `6b5fda9d-e40f-4e16-940c-7a17d27ec5dc`** — 4-bed
first-floor refit, 13 rooms, gross **178.5 m²**, created 2026-04-26.
Hard-coded in `scripts/record-boq-outcome.ts`, `scripts/verify-graph-integrity.ts`,
and the test fixtures. The other 6 projects in the DB are `Untitled` scratch
rows. **Its current locked style is `luxe-minimal`** (`style_choices`, newest
row 2026-09-01; project-wide, `room_id: null`).

## 10. Test runner + fixtures [code]

- Runner: **vitest** (`npm test` → `vitest run`). No other runner. **`tsx` is
  not available** — `.ts` scripts run via `node` directly per their headers.
- **18 test files, 152 tests**, all under `lib/**/__tests__/`:
  `lib/__tests__/smoke` · `assets/types` · `boq/{downstream-nonrectilinear,
  joinery-aluminum, quantify, scope}` · `compliance/triggers` ·
  `drawings/{dimension-closure, render-smoke}` · `image/compress` ·
  `overlays/seed` · `parse/repair` · `plan/{geometry, openings,
  plan-interaction}` · `staging/staging` · `viewer/scene` · `whatif/engine`.
- Fixtures: `lib/boq/fixtures/mudon-first-floor.ts`,
  `lib/plan/__tests__/mudon.fixture.ts`, `lib/plan/__tests__/synthetic.fixtures.ts`.
- **No component or route tests exist.** Every test is a pure-module test.

---

## 11. Sprint-2 spot checks

### (a) B1 / B2 / B3 — what actually exists

**B1 ideation questionnaire — nothing exists.** Zero hits for questionnaire /
ideation / design-brief anywhere in `app`, `lib`, or `components`. The only
intake capture is `app/project/new/_components/villa-intake.tsx`, whose entire
state is `plan, photos, drawings, discipline, projectName, city (default
"Dubai"), budget (default 850,000)`. There is no table, no route, and no
component for taste/lifestyle capture. **T2 builds this from zero.**

**B2 moodboard — partial, static only.** What exists: 24 PNGs in
`public/moodboards/` (**6 styles × 4 rooms**: `bedroom`, `secondary-bedroom`,
`bathroom`, `living`), surfaced as `Style.reference_images` in `lib/styles.ts`
(a static 6-entry `STYLES` array with `key, name_en, name_ar, one_line,
cost_delta_aed, palette[4], reference_images[4], what_changes[3]`). Displayed
by `app/project/[id]/style/_components/style-grid.tsx:180`; consumed by the
render pipeline via `loadMoodboardDataUri`. `AssetPicker` and
`lib/assets/types.ts` already carry a `source: "moodboard"` value. What does
not exist: no `moodboards` table, no generation route, no per-project or
per-user moodboard. `MOODBOARD_ROOM` in `lib/render-grounding.ts` maps only
those 4 room buckets — any new room type falls through to `null` (ungrounded).
**T2 extends the static art into a per-project artifact; the asset-library
`source:"moodboard"` slot is the intended landing place.**

**B3 reference-image → render-prompt — partial, taxonomy only.** What exists:
`reference_image` is a valid `AssetKind` (`lib/assets/types.ts`), validated
(PNG/JPG), labelled "Reference image", iconed `wallpaper`, and grouped in the
hub under "References & moodboards". Users can upload one today via
`/api/project-asset`. What does not exist: **nothing reads it.** The render
route's only image inputs are `[sourceImageUrl, moodboardDataUri]`; grep for
`reference_image` under `app/api/render*` returns nothing. `style.reference_images`
in the render UI (`render-interactive.tsx:885`) is the **static style art**,
not a user upload. **T2 wires the existing upload path into the existing
two-image input — the plumbing on both ends exists, the middle does not.**

### (b) StyleBoard finishes — where they live, and texture assets

- **There is no per-surface finish selection.** The only persisted design
  choice is `style_choices.style_key` (columns: `id, project_id, style_key,
  room_id` + `created_at` from migration 005). `room_id` is nullable and is
  **null in practice** — choices are project-wide. 19 rows live.
- Finishes are **derived from that one key by two pure lookup tables**:
  - `lib/viewer/finishes.ts` → `styleFloorColor(styleKey)` (one muted hex per
    style, falls back to `FLOOR_BONE`) and `styleFinishes(styleKey)` (human
    `{floor, wall, ceiling}` **label strings**, e.g. "Honed travertine, large
    format").
  - `lib/styles.ts` → `palette[4]` hexes + `what_changes[3]` editorial lines.
- Consumers: `app/project/[id]/viewer/page.tsx:111` (3D floor tint + inspector)
  and `app/project/[id]/drawings/page.tsx:87` → `buildFinishRows` →
  `renderFinishSchedule` (the A3 finish-schedule sheet: Room / Surface /
  Material spec / Area m² / Notes).
- **Texture assets usable by the 3D viewer: none.** `lib/viewer/scene.ts` is a
  deliberately non-photoreal **clay model** — flat hex per surface, no UVs, no
  maps. The candidate image sources and why each falls short for T5:
  - `public/moodboards/` (24 PNGs) — composed scene art, **not tileable**.
  - `public/materials/` (16 files) — the swatch set behind `lib/materials.ts`
    `MATERIALS`. **Mixed and mostly unusable**: 5 are `.svg` flat tone chips
    (`metal-brass`, `metal-brushed-bronze`, `metal-matte-black`,
    `walnut-american`, `walnut-quarter-sawn`), 11 are `.jpg` photos. Untiled,
    unnormalised, no scale metadata. `MATERIALS` is hardcoded, **client-state
    only, no persistence** (`render-interactive.tsx:227-231` — 4 visible slots,
    the swap modal writes to `useState` and nothing else); this is stub #3 in
    `MIGRATION_TODO.md`. `SURFACE_SPECS` beside it is 4 decorative fixed strings
    (Reflectivity 0.42, Roughness 0.08, …), not real PBR values.
  - `pricing_skus.Photo_url` — **135 of 600 populated (22.5 %)**; product
    shots, not textures.
  - **T5 needs a new texture layer.** The cheapest honest extension is to give
    `styleFinishes()` a per-surface texture/PBR field alongside its label and
    to persist real per-surface choices; it cannot be sourced from existing
    assets.

### (c) Accessory / fixture catalogue beyond the P8 spec-class map

Yes — **three independent catalogues exist**, none of them merged:

1. **`pricing_skus` — 600 rows [DB]**, seeded from `assets/pricing_skus.csv`
   (columns `ID, SKU, Brand, Category, Subcategory, Description_en,
   Description_ar, Unit, Price_aed, Vendor, Source_url, Photo_url,
   Lead_time_days, in_stock, Last_verified`). **21 categories**: Tiles 85 ·
   Furniture 65 · Sanitaryware 60 · Drywall & Ceilings 40 · Kitchen 35 ·
   Faucets & Mixers 35 · Stone & Slabs 30 · Soft Furnishings 30 · HVAC 30 ·
   Tools 25 · Storage 25 · Paint & Supplies 25 · Hardware 25 · Lighting 20 ·
   Building Materials 15 · Bathware 14 · Bathroom Furniture 12 ·
   Security & CCTV 10 · Electrical 10 · Decor 5 · **Bathroom Accessories 4**.
   This is the real accessory catalogue and it is **only** reachable today via
   `/project/[id]/vendors` → `vendor_selections` (3 rows) → the render
   `Materials:` clause. **T3's likely source of truth.**
2. **`lib/staging/sets.ts` — 34 `FurnitureKey` values** (`sofa-3seat`,
   `majlis-floor-seating`, `king-bed`, `pendant-feature`, `wall-art`,
   `mirror-feature`, …) with per-style × per-room-type sets and per-style
   labels; priced by `lib/staging/prices.ts` at three tiers
   (IKEA / Home Centre / Danube Home), always `rate_status: "indicative"`.
   `furniture_prices` (the DB override) is **empty**, so the module is live.
3. **`lib/overlays/types.ts` — 15 point-fixture types**: 8 electrical
   (`socket_13a, socket_kitchen, switch_1g, switch_2way, light_point, ac_point,
   dp_isolator, data_point`) + 7 plumbing (`wc_point, basin_point, shower_mixer,
   sink_point, washing_machine_point, water_heater, floor_drain`). 151 live
   `plan_fixtures` rows. Counts feed the two overlay BoQ sections.

The P8 spec-class map itself is **`lib/whatif/grades.ts`** — `GRADE_SPECS` over
5 `GradeableItem`s (`floor_finish, wet_tiling, ceiling_finish, wall_paint,
wall_plaster`) × 3 grades, each a concrete spec + AED rate + source +
`qs_validated`, plus a **separate** sanitary spec-class reference map (added by
the ground-truth work) modelling exposed-vs-concealed as *distinct spec
classes, not one item at two prices*.

### (d) Mudon phase / timeline data — **none exists**

- No `milestones`, `phases`, or `schedule` table; no such column on `projects`.
  No dates in `data/ground-truth/` beyond the delta-log workbook, and none in
  `assets/`.
- The only timeline in the product is **hardcoded**: `const TIMELINE` at
  `app/project/[id]/page.tsx:883`, rendered by `TimelineCard()` at line 890
  (comment: *"hardcoded dates per spec"*) — stub #2 in `MIGRATION_TODO.md`,
  whose close condition is exactly "a real schedule / milestones source exists".
  A second, unrelated hardcoded set of relative due strings ("Due in 3 days",
  "Due in 5 days", "Due in 1 week") drives the next-steps queue on the same page.
- **T4 starts from zero on both schema and data. Abdallah must supply the
  Mudon dates.**

### (e) Door/window schedule — **no document view consumes openings**

- `lib/drawings/` contains `sheet, plan-sheet, demo-sheet, finish-schedule,
  electrical-sheet, plumbing-sheet, overlay-sheet, dimensions, export, persist`.
  **There is no door schedule, window schedule, or opening schedule sheet**, and
  no sheet module references doors or windows.
- `generateDrawingSet` (`lib/drawings/export.ts:195`) emits exactly:
  **A-101 As-Built Plan**, the demolition sheet, the electrical services sheet,
  the plumbing services sheet, and **A-201 Finish Schedule**. None reads
  `plan_openings`.
- Openings reach only three consumers today, all non-document:
  `lib/boq/quantify.ts` (net wall deduction), `lib/plan/geometry.ts` +
  `derive.ts` (graph assembly/snapping), and `lib/viewer/scene.ts` (cut into
  the 3D walls, **centred** — the contract carries `along_offset` but the scene
  builder does not yet use it). `lib/drawings/plan-sheet.ts` matches the grep
  only via its `PlanGraph` type import.
- **The door/window schedule is unbuilt and is the remaining A5 consumer, as
  CLAUDE.md states.** With `plan_openings` at 0 rows it would render empty
  until R2's editor (or a hosted provider) populates it.

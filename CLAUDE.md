@AGENTS.md

# RennovAIte

AI-powered villa renovation platform for Dubai. Takes a homeowner from floorplan
and photos to a fully-specified renovation (moodboards, room-by-room concept
renders, material selections, and a priced Bill of Quantities) in days rather
than months.

## Canonical demo villa (pilot)

- **Location:** Mudon Al Naseem, Dubai
- **Unit:** 4-bedroom villa, first-floor refit
- **Rooms:** 1 master bedroom, 2 secondary bedrooms, 2 bathrooms, 1 central
  living area
- **Assets live in** `/assets` (before photos, labour rates CSV, first-floor
  plan PDF, moodboards). These are the inputs the pilot flow operates on —
  treat them as canonical when building or testing.

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS
- shadcn/ui components (base color: **neutral**), lucide-react icons
- Anthropic SDK (`@anthropic-ai/sdk`) for reasoning / design generation
- Replicate SDK (`replicate`) for image generation (render rooms, moodboards)
- Supabase (`@supabase/supabase-js`) for storage + persistence
- zod for schema validation at boundaries (LLM output, API inputs, env)
- PostHog for product analytics (env var wired, client not yet added)

## Brand — Atelier Precise (current direction)

The visual system is **Atelier Precise**: an editorial, paper-on-paper aesthetic
for the luxury Dubai market. Calm, exclusive, meticulous — a private
architectural atelier, never a construction tool. Replaces the old Dark Silk
(dark + neomorphic) system entirely. The reference materials live in
`design-refs/stitch_rennovaite_design_system/` (gitignored, local-only); the
spec is `atelier_precise/DESIGN.md` and the canonical shell wiring is
`landing_page/code.html` / `project_dashboard/code.html`.

**Default to light mode. There is no dark toggle in the PoC.**

### Where tokens live

- **`tailwind.config.ts`** holds every Atelier design token (colors, fonts,
  fontSize scale, spacing, borderRadius, boxShadow). It is loaded by
  `app/globals.css` via `@config "../tailwind.config.ts";` — Tailwind v4's
  legacy-config bridge. **Add/adjust design tokens there, not in `@theme`.**
- **`app/globals.css`** holds only: the `@config` line, the shadcn CSS
  variables (`:root`) mapped to Atelier tokens, the four utility classes, the
  base layer, and the Material Symbols class. No `@theme` blocks, no
  neomorphic utilities (they were deleted with Dark Silk).

### Color tokens

Editorial (semantic) aliases — reach for these first:

| Token       | Hex       | Use                                  |
| ----------- | --------- | ------------------------------------ |
| `canvas`    | `#F7F3EC` | app base background (`bg-canvas`)    |
| `paper`     | `#FFFFFF` | cards, panels, interactive surfaces  |
| `bone`      | `#EDE6D8` | matte borders, dividers              |
| `ink-900`   | `#0F1B2D` | primary headlines / text             |
| `ink-700`   | `#334155` | long-form body text                  |
| `ink-500`   | `#64748b` | captions, table headings             |
| `ink-100`   | `#e2e8f0` | hairline border color                |
| `brass-600` | `#A4793A` | primary actions + active states      |

The full Material Design 3 set also exists (`surface`, `surface-container*`,
`on-surface`, `on-surface-variant`, `primary`, `secondary`, `tertiary`,
`outline`, `outline-variant`, `error`, the `*-fixed*` ramp, etc.) — Stitch
shipped both; both are valid. The standard Tailwind `slate` scale is also
available.

### Typography rules

- **Always use EB Garamond for display, Inter for UI, JetBrains Mono for
  numerics — never hard-code other families.** Use `font-display`/`font-serif`
  (EB Garamond), `font-sans`/`font-body` (Inter), `font-mono`/`font-data`
  (JetBrains Mono). All three are loaded via `next/font/google` in
  `app/layout.tsx` and exposed as CSS variables; Arabic fallbacks
  (IBM Plex Sans Arabic for body, Rubik for display) are appended to each
  stack so RTL works without rework.
- Use the type scale tokens, not raw sizes: `text-display-hero` (64/72),
  `text-headline-lg` (40/48), `text-headline-lg-mobile` (32/40),
  `text-headline-md` (24/32), `text-body-lg` (18/28), `text-body-md` (16/24),
  `text-body-sm` (14/20), `text-data-mono` (14/20), `text-label-caps`
  (12/16, +0.05em).
- **Numeric cells in tables always use `font-mono tabular-nums`** (AED
  amounts, m², measurements) so figures align.

### Iconography

- **Always use Material Symbols Outlined via the global font** — render
  `<span className="material-symbols-outlined">icon_name</span>`. Loaded once
  via a `<link>` in `app/layout.tsx`. **No inline SVG icon imports** and no
  lucide-react in new code. (DESIGN.md mentions Phosphor — ignore that; Stitch
  shipped Material Symbols and we match what Stitch shipped.)

### Imagery, elevation, shape

- **Always wrap photographic images in the `matte-image` utility** (8px Bone
  padding, `rounded-lg`) — mimics framed architectural blueprints.
- **Hairlines over shadows.** Use the `hairline` utility or
  `border border-ink-100`; never reach for Tailwind's heavy `shadow-lg`. The
  sanctioned depth tokens are `shadow-hairline`, `shadow-level-1` (hover
  lift), `shadow-level-2` (modals / render focus).
- Radius scale: inputs `rounded` (4px), buttons `rounded-lg` (8px), cards
  `rounded-md` (12px) / `rounded-xl` for large panels. Focus uses the
  `focus-ring` utility (2px brass outline, 2px offset).

### Shell

Every in-app page is wrapped in `<AppShell pageName="…">` from
`components/app/AppShell.tsx`, which composes:

- `<Sidebar />` (`components/app/Sidebar.tsx`) — fixed 240px (`w-60`) left
  rail, `#FBF7EE` bg. Wordmark + "Pro Plan" caption, primary nav (Dashboard,
  AI Designer, My Projects, Marketplace, Community), secondary nav (Settings,
  Support). Active item: 4px `brass-600` leading bar + `ink-900` weight-600.
  Client component (`usePathname`).
- `<TopBar pageName />` (`components/app/TopBar.tsx`) — fixed 64px (`h-16`)
  bar: wordmark · bone divider · page name on the left; search pill,
  notifications, avatar on the right.
- Main column offset `ml-60 pt-16`, `bg-canvas`, `p-12`, scrolls
  independently.

Marketing surfaces use `components/marketing/TopNav.tsx` (transparent over
hero → paper bg + hairline on scroll past 80px) and
`components/marketing/Footer.tsx` (4-col, `ink-900` bg).

### Floorplan SVG

`editable-plan-viewer.tsx` was repainted to Atelier in the parsed-plan
rebuild (B4): rooms fill bone (`#EDE6D8`) at 50%, walls stroke `ink-900`
1.5 px, EN label Inter 13/500, AR label Rubik 13/500, area in JetBrains
Mono 11. Hover swaps the polygon to `primary-fixed` and lifts the label
2 px.

(The legacy `plan-canvas.tsx` thumbnail with the sand + terracotta
palette was deleted in B11 once `/my-projects` was rebuilt. There is
now no sanctioned non-Atelier palette anywhere in the app.)

### Don't

- Don't introduce a dark theme or a dark toggle without product signoff.
- Don't put design tokens in `@theme` — they live in `tailwind.config.ts`.
- Don't hard-code font families, use heavy `shadow-lg`, or import SVG icon
  components — use the tokens/utilities above.
- Don't reach for the deleted Dark Silk / neomorphic utilities (`neo-raised`,
  `glow-indigo`, etc.) — they no longer exist.

## Conventions

- **BoQ output must use POMI work-section names.** When Claude or any agent
  emits a Bill of Quantities, group line items by POMI (Principles of
  Measurement International) work sections — not by room, not by trade, not by
  free-form headings. Downstream pricing and QS review depend on this.
- Keep secrets in `.env.local` (already gitignored). The six expected env vars
  are listed in that file — add new ones there AND document them here.
- Prefer server components and server actions; only drop to `"use client"`
  when a component genuinely needs interactivity.
- Validate every LLM or external-API payload with a zod schema before trusting
  it. Never pass raw model output into a render or a DB write.

## Render pipeline

(G1b extends this to EXTERIOR zones — two garden directions, a ground-plane
off-plan shell, and no bare 400 for an unrenderable type. See "Exterior
rendering" below.)

Room renders are **photo-first, image-edit based** — the old synthetic
control-image path (`flux-canny-pro` / `flux-depth-pro` + `lib/control-image.ts`)
was deleted. `app/api/render/route.ts` restyles an image with an edit model
(`RENDER_MODEL`, default `google/nano-banana`) rather than generating from
scratch:

- **Photo path** (`mode="photo"`): if the room has an uploaded `room_photos`
  row, its photo is the edit source — the render reads as the owner's real room.
- **Off-plan path** (`mode="offplan"`): no photo → `flux-1.1-pro` first
  synthesises an empty-room shell from the parsed-plan dimensions
  (`lib/room-geometry.ts` + `buildOffplanBasePrompt`), then the same edit pass
  restyles it.
- **Tweak path** (`mode="tweak"`, `app/api/render-iterate/route.ts`): Claude
  rewrites the tweak into a concrete prompt, then the edit model edits the
  **parent render's image** so changes stay localized.

**Material grounding**: the chosen style's moodboard
(`public/moodboards/<style-key>-<room>.png`, sent as a base64 data URI) is
passed as a second image input to nano-banana, and the user's selected vendor
SKUs (`vendor_selections` → `pricing_skus`) are appended as a `Materials:`
clause. Prompt builders live in `lib/render-prompts.ts`; shared Replicate
helpers (model selection, input shaping per model family, timeout) in
`lib/render-image.ts`; grounding helpers in `lib/render-grounding.ts`.
`renders` rows record `source_image_url`, `model`, and `mode` for A/B and
tracing.

### Room-photo uploads (client compression)

The photo path's source image is uploaded from the render page's
`RoomPhotoPanel` to `POST /api/room-photo` (multipart `file` + `room_id`, bucket
`plan-uploads`). Raw phone photos (8–15 MB / 12 MP) used to hit an upstream
body-cap and fail with a raw **HTTP 413** before ever reaching the route. So the
client **compresses first** (`lib/image/compress.ts`): decode with EXIF
orientation baked in, downscale to long edge ≤ **2048 px**, re-encode JPEG
**q0.85** — a typical upload lands at ~0.5–2 MB. Small in-dimension JPEG/PNG
originals (≤ 1 MB) pass through **byte-identical**. HEIC is converted where the
browser can decode it, otherwise the user gets a friendly "use JPG/PNG" message
(never a raw 413). The pure decision logic (`fitWithin`, `planImageProcessing`,
`isHeic`) is unit-tested in `lib/image/__tests__`.

Server limits (backstops — the client keeps uploads far under them):
`app/api/room-photo` rejects `> 20 MB` with a **structured 413** (`{ error, code:
"payload_too_large" }`) rendered as an Atelier error state; `next.config.ts`
sets `experimental.proxyClientMaxBodySize: "25mb"` (above the route cap) so a
future proxy/middleware can't silently truncate an upload below it.

## Project asset library (A3/A4/C2)

One catalogue for every document a project accumulates, so a photo uploaded at
intake is **reusable at the render step** instead of being re-uploaded per room
(intake photos used to be preview-only and discarded).

- **Table** `project_assets` (migration `024`): `kind` (`floorplan |
  drawing_mep | drawing_electrical | drawing_hvac | photo | reference_image |
  other`), nullable `room_id`, `storage_path`, `filename`, `mime`, `bytes`,
  `source` (`intake | render | moodboard`). RLS disabled like every table.
- **Storage**: reuses the existing public `plan-uploads` bucket at
  `<projectId>/assets/<uuid>.<ext>` (the floorplan keeps its
  `<projectId>/<uuid>.<ext>` path); public URLs are derived at read time, so no
  url column. Vocabulary + validation are pure in `lib/assets/types.ts`
  (unit-tested); server reads/paths in `lib/assets/load.ts` (degrade to `[]`
  when the table is absent).
- **Route** `POST /api/project-asset` (multipart `file` + `project_id` + `kind`
  + `source?` + `room_id?`) validates per-kind (images = PNG/JPG; drawings =
  PDF/DWG/DXF/images), enforces a 25 MB structured 413, stores + inserts, and
  rolls back storage on failure. `PATCH` assigns an existing photo asset to a
  room. Images are compressed client-side (the S1 pipeline) before upload.
- **Intake** (`/project/new`): the floorplan (recorded from `/api/upload`) and
  site photos both land in the library; an optional **"Existing drawings
  (MEP · Electrical · HVAC)"** card files uploads under the selected discipline.
  Assets dropped before the plan exists are **queued** and flushed once the
  project is created. Drawings are **stored/listed only — not parsed** (later
  scope; no viewers).
- **Render** (`RoomPhotoPanel`): the per-room dead-end uploader is replaced by
  the reusable **`components/assets/AssetPicker`** — a thumbnail grid of the
  project's photo assets (assign to the current room) plus an "upload new" path
  into the library. Assigning a photo mirrors a `room_photos` row so the
  **render pipeline is unchanged** (it still reads the latest `room_photos` per
  room). The same picker is the pattern for the future moodboard step (B2).
- **Hub** (`/project/[id]`): a **"Project files"** panel
  (`components/assets/ProjectFilesPanel`) lists all assets grouped by kind with
  download links; it renders nothing when the library is empty.
- **DB step**: `supabase db push` (see `docs/MIGRATIONS.md`). Everything
  degrades gracefully until the migration runs —
  intake still works, the render picker shows the upload path, and the hub panel
  is hidden.

## Drawings — geometry contract + 2D drawing engine (P1)

Auto-generated, **deterministic** (no LLM) A3 drawing set: dimensioned as-built
plan, proposed/demolition plan, and finish schedule. Gated by `DRAWINGS_ENABLED`
— when unset/false the `/project/[id]/drawings` route 404s and the plan page is
unchanged.

- **Geometry contract** lives in `lib/plan/geometry.ts` — `PlanGraph` (rooms /
  walls / openings / meta) is the single source of truth for the drawings, the
  future 3D viewer, and permit checks. `buildPlanGraph` is pure/unit-tested;
  `derivePlanGraph(projectId)` (`lib/plan/derive.ts`) reads it from the DB.
  Today we persist **room polygons only** (normalised `[0,1]`), so walls are
  **derived** from shared polygon edges (default 200 mm, `is_structural: null`),
  metres are derived from `total_area_m2`, ceilings default to 2.9 m. Every
  derived value is flagged (`derived: true` / `derived_fields`) and surfaced in
  the UI + `derivedNotes`.
- **Openings (doors/windows/archways — A5 plumbing)**: `plan_openings`
  (migration `026`) persists openings as first-class children of **walls**
  (`kind` door|window|archway, `source` parsed|user_drawn, `position` normalised,
  `along_offset`, dims in mm, `derived: true` when dimensions are DEFAULTED —
  a defaulted opening never silently reads as measured). `buildPlanGraph`
  ingests them and **snaps each to its nearest derived wall** (derived wall ids
  are volatile), so `quantify.ts` already deducts opening area from
  `wall_plaster`/`wall_paint` net. `derivePlanGraph` reads the table best-effort
  (empty before 026). Providers may supply openings via `RawParseResult.openings`
  (the in-house Claude provider does not — forward-looking for a hosted / vector
  provider); the R2 2D editor writes via `POST/DELETE /api/plan-openings`
  (`source: user_drawn`). The door/window schedule view is the remaining A5
  consumer (R2).
- **Snapshots**: `plan_snapshots` (migration `013`) stores as-built (at
  parse-confirm) and proposed (at design lock) graphs; diffing them drives the
  demolition sheet (and later P2/P6). Writing is best-effort in
  `lib/plan/snapshots.ts` and never touches the parse flow / `EditablePlanViewer`.
- **Drawing engine** in `lib/drawings/`: `sheet.ts` (A3 template, title block,
  north arrow, scale bar; Inter / JetBrains Mono / EB Garamond), `plan-sheet.ts`
  (double-line walls, room labels, dimension chains — offset 600 mm, values in
  mm, closure unit-tested), `demo-sheet.ts` (as-built▵proposed demolition
  marking), `finish-schedule.ts` (table), `export.ts`
  (`generateDrawingSet(projectId)` + PDF). Sheets are authored at true A3 size so
  they print **1:100**.
- **PDF export uses `@resvg/resvg-js` → PNG → `pdf-lib`** placed on a true-size
  A3 page (chosen over `svg2pdf`, which needs a DOM server-side). DXF is deferred
  (`TODO(P-later): DXF via dxf-writer`).
- **Persistence** (`drawing_sets`, migration `014`) is best-effort in
  `lib/drawings/persist.ts`, regenerated on design lock (`approve-design`). It
  uploads to a **private** Storage bucket named **`drawings`** and stores
  long-lived **signed** URLs in `sheet_urls` (the bucket is private, so public
  URLs would not resolve).
- **DB steps** (`supabase db push` — see `docs/MIGRATIONS.md`) : apply
  `scripts/migrations/013…` and `014…`, and create a **private** Storage bucket
  named `drawings`. Live generation + PDF download work without them.

## Overlays — electrical + plumbing (P2)

Point-based electrical + plumbing layers on the 2D plan whose **counts** feed
two new BoQ sections deterministically. Gated by `OVERLAYS_ENABLED`.

- **Fixtures** live in `plan_fixtures` (migration `015`): `layer`
  (electrical|plumbing), `type`, `room_id`, `position` ([x,y] in **normalised**
  plan space, like `rooms.polygon`), `source` (rule|user). Types are listed in
  `lib/overlays/types.ts`.
- **Rule seeding** (`lib/overlays/seed.ts` + `rules.ts`): `seedOverlays(planGraph)`
  places DEFAULTS per room type (a plain data table with a rationale per rule —
  these are defaults, **not** code-compliance rules; P6 owns code checks). Pure
  + unit-tested. Seeded fixtures are `source: 'rule'`; the server seeds on first
  `GET /api/plan-fixtures`.
- **2D editing** is the only editing surface: the plan page's `PlanLayers`
  toggle (Plan / Electrical / Plumbing) swaps `EditablePlanViewer` for
  `OverlayEditor` (drag / palette-add / delete → `POST`/`DELETE`
  `/api/plan-fixtures`, always `source: 'user'`). Flag off → no toggle, plan
  unchanged.
- **BoQ feed** (`lib/overlays/boq.ts` + `boq-feed.ts`): `appendOverlaySections`
  adds **"Electrical Installations"** + **"Plumbing & Sanitary"** POMI sections
  to the generated BoQ (both engine + LLM paths) with quantities = fixture
  counts (never the LLM). Each line records `element_refs` (fixture ids) and
  `rate_status`; where the catalog has no default point rate the line is
  `rate_status: 'needs_qs'` (rate 0) and renders with a terracotta dot in the
  BoQ table. `element_refs`/`rate_status` are additive optional fields on the
  jsonb BoQ line (P4/P5 build on `element_refs`). Existing sections / zod / KG
  are untouched.
- **Drawings**: `lib/drawings/electrical-sheet.ts` + `plumbing-sheet.ts` add
  services sheets (symbols + legend + count table) to the drawing set when
  fixtures exist (needs `DRAWINGS_ENABLED` too).
- **DB step**: `supabase db push` (see `docs/MIGRATIONS.md`). The unit tests +
  flag-off behaviour work without it; seeding/editing/BoQ-feed activate once it
  has run.

## 3D viewer — walkthrough from the plan graph (P3)

A **view-only** 3D walkthrough built from the P1 `PlanGraph`. Hard constraint
(Way Forward): orbit / walk / measure / inspect only — **no** transform gizmos,
drag handles, or geometry mutation anywhere. Edits live in the 2D plan.
Gated by `VIEWER_3D_ENABLED`.

- **Deps** (added in P3): `three` 0.185, `@react-three/fiber` 9 (React 19),
  `@react-three/drei` 10, `@types/three` (dev).
- **Scene builder** `lib/viewer/scene.ts`: pure `buildScene(planGraph, finishes?)`
  → plain geometry data (wall boxes extruded to `ceiling_h_m` at true
  `thickness_mm`, floor slabs per room, world-centred bounds, wall centre-lines
  for collision). Imports no three.js → SSR-safe + unit-tested (wall count,
  metric dimensions). Openings are cut where the graph has them (centred, since
  the P1 contract has no along-wall offset yet — Mudon has none). Walls flagged
  `derived: true` render at 60% opacity with a hairline edge. Floors tint from
  the locked style via `lib/viewer/finishes.ts`.
- **Component** `components/viewer/Villa3D.tsx` (client, react-three-fiber) on
  route `app/project/[id]/viewer` (AppShell, `pageName="3D Viewer"`), loaded via
  `Villa3DLoader` (`next/dynamic` `ssr:false` — three must not run in SSR).
  Orbit (`OrbitControls`, clamped above the floor) / Walk (`PointerLockControls`,
  1.6 m eye height, WASD+arrows, axis-separated wall collision). Measure tool
  (click two points → Mono metre label), toggleable room-area labels, and brass
  render anchors at room centroids that open the room's latest render in a
  `matte-image` overlay. Empty state (EB Garamond italic) when the plan has no
  walls.
- **Panorama (stretch)**: `renders.kind` (migration `016`, default `'still'`)
  lets the viewer branch to an inverted-sphere 360° view for `'pano'` renders.
  Pano *generation* is NOT built — `// TODO(P-later): pano generation via render
  pipeline` marks where it would branch.
- **Entry**: "Walk your villa in 3D" (`view_in_ar`) on the plan page + project
  hub, shown only when the flag is on and a confirmed plan exists.
- **DB step**: `supabase db push` (see `docs/MIGRATIONS.md`). The viewer works
  without it (defaults `kind` to `'still'`).

## Furniture staging — style-consistent renders + optional priced section (P7)

Two compounding pieces off one staging vocabulary, gated by `STAGING_ENABLED`.

- **Vocabulary** `lib/staging/sets.ts`: per style key × `StagingRoomType`
  (living / majlis / master-bed / kids-bed / dining / kitchen-adjacent) a
  style-consistent set of 4–6 GCC-appropriate pieces (traditional directions get
  majlis floor seating; contemporary ones get raised majlis sofas). Each item's
  `key` is a generic priceable `FurnitureKey`; its `label` carries the per-style
  flavour. `stagingRoomTypeFromDb` maps DB room types (wet rooms / circulation →
  null). Pure + unit-tested.
- **Render enrichment** `lib/staging/prompt.ts` → `buildStagingBlock`: in
  `app/api/render/route.ts` the STAGING block is appended **after** the KG
  context (so real KG fixtures keep precedence for fixed elements) — staging only
  dresses movable furniture and pins the architecture. It only appends to the
  prompt (the cache key), so caching + the tweak/iterate flow are untouched: flag
  off vs on are just two distinct prompts → two cache entries. The set used is
  persisted best-effort to `renders.staging_set`.
- **Prices** `lib/staging/prices.ts`: indicative Dubai retail per `FurnitureKey`
  at three tiers (IKEA / Home Centre / Danube Home); each style maps to a tier.
  The module is the source of truth; `loadFurniturePrices` prefers the optional
  `furniture_prices` DB table and falls back to the module (works before the
  migration). **All furniture rates are `rate_status: 'indicative'`.**
- **Opt-in** — after a render is locked, a ghost "Add furniture to your budget?"
  (`components/staging/FurnitureOptIn.tsx`, once per room) POSTs to
  `/api/furniture-opt-in` → `furniture_opt_ins`.
- **Optional BoQ section** `lib/staging/furniture-boq.ts` +
  `collect.ts`: at BoQ read-time `collectFurnitureSection` builds ONE
  **"Furniture (optional)"** section from opted-in rooms' staging sets. It is
  passed to `BoqView` as a **separate prop — never written into `boqs.sections`**,
  so every contractor-facing surface that reads the stored jsonb excludes it by
  construction. Rendered visually apart with an `OPTIONAL — NOT IN CONTRACTOR
  SCOPE` eyebrow; toggling it off (what-if panel or the section header) subtracts
  its total exactly, restoring the prior figure.
- **DB step** (`supabase db push` — see `docs/MIGRATIONS.md`): apply `scripts/migrations/021_staging.sql` (Supabase SQL
  editor) — adds `renders.staging_set`, `furniture_opt_ins`, and the optional
  `furniture_prices` table. Unit tests + flag-off/degraded behaviour work without
  it; opt-in persistence + the live BoQ section + `staging_set` tracing activate
  once it's applied. Optional: `node scripts/seed-furniture-prices.ts` to seed
  DB-editable price overrides.

## Authored plans + outdoor zones (garden pilot G1)

A project can start with **no drawing to parse**, and the plan model carries
**outdoor zones** alongside interior rooms. Gated by `GARDEN_PILOT_ENABLED` —
off = a project still needs an uploaded floorplan and the room vocabulary is
exactly the parser's.

- **Authored plans** (`plans.source = 'user_drawn'`, migration `031`).
  `POST /api/draw-plan` creates a project with no upload; `PATCH` takes over an
  existing plan whose parse found nothing. Until G1 `/api/upload` was the only
  code path that inserted a project.
  **The plot is the scale**: `plans.plot_width_m` / `plot_depth_m` are measured,
  and normalised space runs x ∈ [0,1] across the plot width, so
  `unit_to_m === plot_width_m`. `buildPlanGraph` uses it verbatim and sets
  `derived.metric_scale: false` — a typed dimension is a measurement. This is
  not cosmetic: the area-derived scale assumes rooms **tile** the plan, which
  interior floors do and a garden does not, so inferring it would inflate every
  zone to fill the plot.
- **No spinner is reachable.** `parsedComplete` used to gate the whole editor on
  `parsed_json !== null`, so a plan without rooms rendered `ParseLoading`
  forever — and an authored plan can never satisfy it. The gate is now
  `authored || (parsed_json && rooms > 0)`, and the else branch is
  `PlanNotAnalysed`: an actionable card (re-run the analysis / take the plan
  over by hand) instead of a spinner.
- **Zone vocabulary** `lib/plan/zones.ts` (pure, unit-tested). Interior tokens
  mirror the parser prompt exactly; outdoor tokens are `paving`,
  `artificial_grass`, `planting_bed`, `deck`, `path`, `structure`, `pool`
  (`pool` is stored but not priced). `balcony`/`terrace` stay **interior** —
  reclassifying them would change every villa already parsed. The editor's
  hard-coded `room_type: "other"` is gone: there is a type picker, and the
  type's default drives `unroofed`.
- **Enclosure model.** `rooms.unroofed` (default false). An unroofed zone has
  `ceiling_h_m: 0`, and **a wall interval whose every covering room is unroofed
  is not emitted** — a lawn meeting a paved area is a change of surface, not a
  wall. A wall on a garden edge exists only where a `boundary_wall` element was
  drawn (those append to `walls[]` as `source: 'drawn'`, `derived: false`).
  A shared edge between an unroofed zone and a roofed room still emits its wall.
- **Linear elements** `lib/plan/elements.ts` + `plan_elements` (031) +
  `/api/plan-elements`: `boundary_wall | bench_run | planter_run | counter_run`,
  polylines in normalised space, length derived in metres at graph-build time
  (never stored, so it cannot drift). Defaulted cross-sections are flagged
  `derived`, same rule as openings. Editing surface is the **Elements** layer in
  `PlanLayers`. Lighting and drainage **points** needed no schema: they are two
  new `plan_fixtures` types (`garden_light`, `drainage_point`) in a new
  `garden` overlay rule category, kept separate from `outdoor` so Mudon's
  terraces seed exactly what they always did.
- **Consumers.** `quantify.ts` emits no `ceiling_finish` for an unroofed zone;
  the finish schedule drops its Wall/Ceiling rows and keeps a surface row;
  dimension chains anchor on zone edges and drawn walls (`gridLines` reads both,
  so the chain still closes); the 3D scene renders open zones as ground slabs
  and gives a `structure` zone an explicit canopy height. `lib/boq/rules.ts`
  gains `LANDSCAPE_TYPES`, excluded from **both** the interior and the
  terrace/external buckets — folding a lawn into `EXTERNAL_TYPES` would have
  priced it as waterproofed porcelain. Landscape quantities are G2's; until then
  a drawn garden reports its area (`takeoff.summary.landscapeAreaM2`) and prices
  nothing, which is a visible gap rather than a silent wrong number.
- **DB step**: `supabase db push` (see `docs/MIGRATIONS.md`) for `031`.
  Everything degrades gracefully until it runs — `derivePlanGraph` falls back to
  the pre-031 selects, the plan page still renders, and `/api/update-plan`
  retries the room upsert without `unroofed`.

## Exterior rendering — garden styles (garden pilot G1b)

Zones render. Before G1b `roomTypeFromDb` mapped eight interior tokens onto four
prompt types and everything else was a **bare 400** — every terrace, every
balcony and every garden zone was simply unrenderable.

- **Two exterior prompt types**: `garden-zone` (paving, artificial grass,
  planting bed, deck, path, pool — and `terrace` / `balcony`, which were the
  clearest casualties of the old hard stop) and `outdoor-structure`
  (`structure`). `isExteriorRoomType` is the branch every builder keys off.
- **No bare 400.** A type that genuinely has nothing to photograph (stairs,
  closets, circulation) returns a structured **422** — `{ error, code:
  "room_type_unsupported", room_type, supported }` — naming the type and
  listing what is renderable, instead of a sentence about the first-floor scope.
- **Two exterior directions** in `lib/garden-styles.ts`: **Desert Modern**
  (`desert-modern`) and **Courtyard Majlis** (`courtyard-majlis`). Deliberately
  a separate module from `lib/styles.ts` — `STYLES` is not just a list, it is
  what `lib/ideation/questionnaire` scores and what the moodboard and style
  pages render, so two more entries there would have changed the ideation
  recommendation for every interior villa. `GardenStyle extends Style`, so any
  surface that shows "the project's direction" takes either (`resolveAnyStyle`).
- **Moodboard art**: four 1024×1024 PNGs at the same path and naming as the
  interior 24 (`public/moodboards/<style-key>-<garden|structure>.png`), so
  `loadMoodboardDataUri` needs no special case. Generated once by
  `scripts/generate-garden-moodboards.mjs` (flux-1.1-pro, idempotent, not wired
  into any build — regenerating on deploy would quietly change what every
  garden render is grounded against).
- **Style pairing, never silent.** A project locks ONE direction. An exterior
  zone renders in that direction's companion exterior style (`gardenStyleFor`)
  and an interior room on a garden-led project in the companion interior one
  (`interiorStyleFor`); the render response carries `style_key` and, when it
  substituted, `style_substituted_from`. Garden keys are lockable via
  `/api/style-choice` too.
- **Photo mode is the pilot path.** A client photo of a zone edits exactly like
  a room photo — same `room_photos` row, same edit model, same cache rules.
- **Off-plan shells are ground, not rooms.** `buildOffplanBasePrompt` branches
  for exterior: flat level ground inside a ~1.8 m blockwork boundary under open
  sky (a bare base slab for a structure), never a ceiling and primed walls. The
  edit prompt likewise asks the model to keep the **site's shape, boundary wall
  positions and levels** rather than wall, window and door positions.
- **Staging stays interior.** `lib/staging` now keys on `InteriorStyleKey`, and
  the render route skips the staging block for exterior zones — there is no
  movable furniture in a lawn to dress.
- **Interiors are untouched**: all 24 edit prompts, all 24 text-to-image
  prompts, all 8 off-plan prompts and all 12 interior classifications are
  byte-identical to the pre-G1b commit. The prompt is the render cache key, so
  that is what stops every cached interior render being invalidated.

## Landscape rate book + garden takeoff (garden pilot G2)

Ground-truth project **#2**: a real Dubai garden renovation, ingested from
`data/garden pilot/Garden_Ground_Truth_Villa94.xlsx`. Not flag-gated — a rate
book and a set of pure rules change nothing until something calls them.

- **Identity is a hard rule, not a preference.** The contractor is an
  independent firm with no relationship to the client this pilot serves, and
  these are their negotiated prices. Their name appears in exactly one place:
  `INTERNAL_REF` in `lib/ground-truth/villa94-garden.ts`, written to
  `rate_book.internal_ref` (migration `032`) and rendered nowhere.
  `rate_book.source` — which reaches the what-if engine, the BoQ line and
  therefore the client — carries `PUBLIC_SOURCE_LABEL`
  (*"market reference — Dubai garden 2026"*) instead. A test asserts the name is
  absent from every rendered string.
- **`lib/ground-truth/villa94-garden.ts`** is the transcription (read by
  unzipping the workbook and parsing sheet XML, never retyped): 20 contract
  lines, the 20-item rate calibration, totals, the timeline, and the
  invariants. **Three rates arrive ALREADY NET** — client-purchased tile, the
  boundary-light variation, the client-supplied grill — and re-applying the 12%
  to them would understate every future garden on exactly the lines a client
  pays directly. `ratesAreConsistent()` is the guard; the seeder refuses to run
  if it trips.
- **`scripts/seed-rate-book-garden.ts`** upserts the 20 rows as
  `provenance: 'actual_transaction'`, `qs_validated: false`, net in `rate_aed`
  and pre-discount in `list_rate_aed` (null where the rate was already net, so
  it cannot read as discounted). Idempotent and narrow: it deletes only
  `item_key LIKE 'garden.%'`, so a re-run cannot reach the Mudon interior
  actuals.
- **`lib/boq/garden-takeoff.ts`** is a SEPARATE take-off from
  `lib/boq/takeoff.ts`, and its rates come from a `GardenRateBook` rather
  than `lib/boq/rates.ts`. **Since T1.0 that book is read from `rate_book`**
  (`loadGardenRateBook`, `lib/boq/garden-rates.ts`) and a missing landscape
  book is a hard error, never a fallback to the constants; the ground-truth
  module keeps only the vocabulary (labels, units, inclusion rules) and the
  transcription the seeder writes (`transcriptionGardenRows`), which the pure
  dry-run and unit tests price from (`transcriptionGardenBook`). Pricing paths
  select `rate_book` through `REFERENCE_COLUMNS` (`lib/rates/reference.ts`),
  which never includes `source` or `internal_ref`. The interior `RateResolver` is driven by `RATE_RULES`
  over `labour_rates` + `pricing_skus` and throws on an unknown key, so routing
  garden keys through it would have meant inventing labour rows or editing
  interior rules. Rules **GL-01…GL-19** cover project lumps, hardscape
  (PCC + install + tile supply), softscape, runs per lm, discrete units,
  pergola by plan area, irrigation, lighting and boundary lights.
- **Two kinds of inclusion, and the distinction is load-bearing.**
  `INCLUSIVE_SCOPE` suppresses a LINE (a BBQ counter's sockets: there is no such
  thing as "the sockets the counter doesn't cover"). `QUANTITY_INCLUSIONS`
  reduces a QUANTITY (a pergola carries eight downlights, not every light in the
  garden). The first version listed the lighting keys as line-level, which would
  have zeroed a garden's entire lighting the moment somebody drew a pergola —
  the test caught it. `findDoubleCounts()` enforces the line-level rule plus
  `ABSORBED_SCOPE` (manhole covers, drainage points, sweet soil, edging,
  fertilizer were quoted at zero and absorbed; a line for any of them invents a
  cost).
- **Honesty flags.** Tile supply carries `rate_status: 'site_assessment'`
  because the rate is per m² PURCHASED and the reference order covered all
  paving *and* cladding from 66.24 m² against 87 m² of quoted paving. The
  irrigation lump carries the new `ScopeItem.qty_derived` — its rate is a
  transacted actual but its quantity is scaled from one reference project, and
  the scale is clamped to 0.5–2.0 because a lump stretched five times over is
  not a lump.
- **Sections**: `External Works`, `Landscape Structures`, `Irrigation`,
  `External Lighting` are added to `POMI_SECTIONS` and `SECTION_ORDER`. Purely
  additive — the engine emits a section only when a take-off item lands in it.
- **`scripts/record-garden-outcome.ts`** writes delta-log entry **#2** against a
  `Villa 94 garden (ground truth)` project: `actual_total` 152,059.44
  (contractor 138,146.44 + client-supplied 13,913), per-section net, and the
  90-day duration anchor. The platform side is left **null** — that BoQ does not
  exist until the G3 dry-run, and a fabricated figure would be worse than none.
  Unlike Mudon's flat AED 36,500, this 12% was applied uniformly to the quoted
  subtotal, so distributing it per section is exact; the script asserts the
  split reconciles to the project total before writing.
- **DB step**: `supabase db push` for `032`, then
  `node --import ./scripts/_alias-hook.mjs scripts/seed-rate-book-garden.ts` and
  the same for `scripts/record-garden-outcome.ts`.

## Garden BoQ + the calibration dry-run (garden pilot G3)

G1's drawn zones wired to G2's rules, and the result checked line by line
against the project that produced those rates.

- **Sections** (POMI-style): Preliminaries · Demolition · Hardscape &
  Structures · Soft Landscaping · Irrigation · Electrical & Lighting. Garden
  work reuses the first two rather than duplicating them;
  `appendGardenSections` merges into an existing section when a project has
  both.
- **`lib/boq/garden-boq-feed.ts`** reads the drawn garden — zones from `rooms`,
  runs from `plan_elements`, discrete items and points from `plan_fixtures` —
  runs the take-off, prices it, appends the sections and recomputes the
  contingency/VAT chain. Called from BOTH BoQ paths, exactly like the P2
  overlay feed. A project with no outdoor zones gets its BoQ back unchanged.
- **`takeoff_items` per zone × work item**: every area- and length-driven rule
  records a per-element row, so an aggregated line is the Σ of the zones that
  produced it and `element_refs` traces it back to the drawing. Lumps emit no
  element rows — a lump has nothing to attribute.
- **Counter variant picker** (migration `033`): one control in the elements
  editor, `bar | bbq`. `null` is the unanswered state, priced at the cheaper bar
  rate and flagged **`needs_selection`** — a new `rate_status` with the
  terracotta dot, because a real rate that is the default of an unmade choice is
  not the same thing as a rate nobody has. It matters twice over: AED 968/lm,
  and the BBQ rate is what carries the MEP inclusion that stops its sockets
  being counted again.
- **Irrigation is an allowance, not a formula.** One comparable project cannot
  support a per-metre driver, and dressing it as one would make the line look
  measured. It is a lump at three coarse size bands, carrying `site_assessment`
  (confirm the rate against this garden) **and** `qty_derived` (the band is
  inferred). It earns a real driver at n ≥ 3.
- **Discrete landscape items** (migration `034`) are `plan_fixtures` on a new
  `landscape` layer: a planter box, a wall feature and a BBQ grill are not
  surfaces and not linear metres, and a fourth shape would have been one too
  many.

### What the dry-run found

Villa 94's garden traced from the setting-out drawing at 1:50 (PDF → SVG path
extraction, not eyeballed), priced, compared against the actuals:
**AED 148,202.60 against 152,059.44 — −2.5%**, with 10 of 14 quantity-driven
lines inside ±10% and every delta classified. `scripts/garden-dry-run.ts` prints
the table; `scripts/garden-dry-run-live.ts` runs the same garden through the
real routes and records the platform side of delta-log entry #2.

**The pre-registered expectation was falsified, in the more useful direction.**
It said PCC measured off geometry would land ~12 m² ABOVE the contracted 75 m²,
on the premise that the drawing supports the contract's own 87 m² of paving. It
does not: the drawn paved surface is **64.27 m²**. The corroboration is the tile
actually bought — **66.24 m², within 3% of what we measure and 31% below what
was quoted**. The contract over-measured both lines, and the contract's own
quantities (87 m² paving + 71 m² grass = 158 m²) exceed the drawn open garden
(~136 m²). No rate was touched to close any of it.

Three rule bugs the dry-run caught, all fixed in the rules rather than tuned
away:

1. **A structure does not remove the paving beneath it.** Hardscape was
   measured as "paved zones minus structures", which under-measured PCC, paving
   install and tile supply by the pergola footprint. The paved *surface*
   includes it; only the superstructure is in the pergola's all-in rate.
2. **Interior preliminaries on a garden-only project.** `computeTakeoff` emitted
   project-level prelims — the scaffold and floor protection of an interior
   fit-out — with zero interior rooms, charging site establishment twice. It now
   returns nothing when there are no costable interior rooms.
3. **Interior floor finishes and the aluminum allowance on outdoor zones.**
   `quantifyPlan` now skips outdoor zones entirely (their surface is priced as
   PCC + paving + tile, or as grass), and `buildAluminumSection` returns null
   when every room is a landscape zone. `terrace` and `balcony` are untouched —
   they are interior rooms and stay that way.

Mudon's quantities, take-off and priced BoQ across three styles are
byte-identical to the pre-G3 commit. What-if works and deliberately does not
regrade landscape lines: the landscape rate book has one grade, so garden lines
count toward the scenario total but cannot be swapped.

## Garden documents — drawings, overlays, batch render, render pack (garden pilot G4)

Four deliverables, every one assembled from the same `PlanGraph`, built first
against Villa 94 (the client garden follows once its measurements land).

- **Villa 94 at its true geometry.** `lib/ground-truth/villa94-garden-geometry.ts`
  holds the traced polygons (the lawn residual via `polygon-clipping`, the bench
  court's curved edge as an elliptical quarter), runs, units and lighting points.
  G3's zones were areas laid out as squares; since G4 every zone area is computed
  from its polygon, so the BoQ, the dry-run and the drawings cannot disagree. That
  refinement moved the platform total by **+AED 2.41** (148,202.60 → 148,205.01,
  still −2.5%, still 10/14), and the curved cut came out at **1.8 m²** where G3's
  arithmetic said 1.9.
- **Derived area on the zone** (migration `035`): `rooms.area_derived_m2` +
  `derived_note`. The lawn carries its 1.8 m² approximation as a flag, so every
  document that prints the area prints the `*` and the reason. `buildPlanGraph`
  adds `area_m2` to `derived_fields` when it is set.
- **Dimension drawings** `lib/drawings/garden-sheets.ts`: L-100 site plan (zone
  schedule, runs, plot extents, levels legend — "no levels are carried by this
  plan" rather than an invented FFL), one L-1xx sheet per zone (every straight
  edge dimensioned in mm between real vertices, overall extents, facts panel; a
  curved edge is marked rather than dimensioned by its chords). A 26 m garden
  does not fit A3 at 1:100, so each sheet picks the largest standard scale that
  fits (`fitScale`) and prints it, with a true scale bar — the interior engine
  and its fixed 1:100 are untouched. Every dimension carries `data-dim`/`data-mm`
  so tests (and the live dry-run) check printed figures against the graph to
  the millimetre.
- **Overlays**: L-401 lighting & electrical (fitting codes, schedule, an
  indicative cable route as the minimum spanning tree — labelled *derived, not
  designed*) and L-402 irrigation & drainage (drip zones, planter runs, an
  indicative line, drainage points or an explicit statement that none are
  placed). **No HVAC.** Lighting is **as designed, never as surveyed**: point
  positions come from the design session, `plan_fixtures.spec.source =
  'as_designed'`, and the sheet states `LIGHTING_SOURCE_STATEMENT`.
- **Set PDF**: a garden-only plan gets the garden set instead of the interior
  sheets (mixed plans get both); `?format=pdf&sheet=all` returns the whole set as
  one multi-page PDF; a sheet is addressable by its number.
- **Batch render** ("Generate all", Newspace ask #2). `lib/render-batch/plan.ts`
  is a pure planner: a day view per renderable zone, plus an **evening** view for
  exterior zones with lighting on the plan (or a structure, whose downlights are
  part of it). `POST /api/render/batch` plans and prepares; it holds no queue.
  The client runner (`lib/render-batch/client.ts`) runs jobs through the existing
  single-render routes, so the cache, the per-project in-flight cap of 3, the QA
  gate and rehosting all apply; done jobs are skipped, so pressing twice costs
  nothing. `POST /api/render/evening` is an **edit of the zone's current day
  render** with a deterministic prompt naming only the designed fittings
  (`renders.view = 'evening'`, migration 035); it is kept out of the iteration
  chain and goes stale when the day view is tweaked.
- **Exterior style preset.** With `TASTE_SEED_ENABLED`, the batch seeds a garden
  project's EMPTY moodboard with its direction's garden + structure art
  (`gardenPresetItems`, new `EXTERIOR_STYLE_ROOMS`, deterministic descriptors), so
  every zone is conditioned on the same references. Never onto a board the user
  built, never onto a project with interior rooms (the seed is project-wide).
  The interior style-library catalogue is unchanged.
- **Render pack** (E1-lite) `lib/documents/render-pack.ts` (pure pages) +
  `render-pack-pdf.ts` + `GET /api/projects/[id]/render-pack` (gated with
  `DRAWINGS_ENABLED`; `?format=json` for a manifest): cover (direction, palette,
  hero render), plan overview (the L-100 sheet itself), a page per zone (day +
  evening where lighting exists, a stated placeholder where a view is missing),
  materials & finishes (zone schedule with the derived flag, built features with
  counter variants, lighting as designed). Chrome is rasterised like a drawing
  sheet; photographs are embedded at their own resolution. No price, rate, rate
  source or contractor appears in it.
- **Delta-log reasoning survives.** `lib/ground-truth/villa94-garden-dryrun.ts`
  is the one comparison both the printed report and the stored record use;
  `boq_outcomes.delta_lines` (035) stores every line's class and reason, and the
  four over-measured lines (PCC, paving install, grass supply + install) carry the
  client tile-purchase corroboration (`direct` for paving, `indirect` for grass).
- **A save-route bug the live run caught.** `/api/update-plan` ran overlap repair
  over every room, and clipping snaps vertices to 1 mm and inserts a vertex wherever
  a neighbour's corner touches an edge — so an abutting garden was reshaped on
  every save and the drawings dimensioned the extra vertices. `repairForSave`
  (`lib/plan/save-repair.ts`) now reshapes only rooms that actually overlap.

Interior output is unchanged: Mudon's graph (bar the additive null fields), as-built
and demolition sheet SVGs, quantities and priced BoQ across styles are
byte-identical to the pre-G4 commit.

**DB step**: `supabase db push` for `035`, then
`node --import ./scripts/_alias-hook.mjs scripts/garden-dry-run-live.ts [port]`
against a dev server started with `GARDEN_PILOT_ENABLED=true DRAWINGS_ENABLED=true`.

## Plan-faithful renders, elevations + levels, project isolation (garden pilot G4b)

G4 was not client-ready: text-prompted off-plan renders invented layouts (a
pergola render with no pergola in it) and the drawings had no eye-level
information. Both are fixed at the root.

- **Levels, heights and context on the graph** (migration `036`):
  `rooms.level_mm` (finished level vs ±000 FFL; null = not stated, never read
  as ±000), `rooms.height_mm` + `rooms.spec` (a structure's top and member
  sizes), `plan_elements.spec` (a run's build-up and `band_mm` — where its width
  sits across the traced reference line), `plan_fixtures.spec` (unit sizes),
  and **`plan_context`** — existing villa, garage, pergola, steps and boundary
  walls: never a zone, never priced. `PlanGraph.context` carries them. Every
  value records its source; assumed or scaled ones are `derived` and say so.
- **Villa 94 heights and levels are read from the KAME sections** (A-A-001,
  B-A-001/002, C-A-001, GL-PS-001): pergola TRL +2800 (150 mm members, posts at
  1000/3350), BBQ counter +900 × 900, bar +1000 × 450, bench +350 with a +600
  kerb, wall feature 2500 × 300 × 1800 with its arch, planter box +450, courtyard
  +300, front approach +150/±000, steps +150/+300. The boundary wall (~2000,
  scaled) and the villa/garage heights are not dimensioned and are flagged.
  Tracing the villa outline exposed three G4 zone-trace errors, corrected
  (courtyard L +1.26 m², front approach −2.76 m² and split into two levels,
  courtyard-mouth step −0.72 m² of lawn): the dry-run is now **AED 147,679.18,
  −2.9%, still 10/14**.
- **Sectional elevations** `lib/drawings/garden-elevations.ts`: L-301…L-307, one
  per structure (pergola, BBQ counter, bar counter, bench, planter run, wall
  feature, planter box), each view at a fitted KAME scale (main views 1:20) with
  heights, build-up and FFL/TRL/CTL/TOS/TOC level tags; L-501 whole-garden
  boundary elevation strips. **Level tags** on the site plan and zone sheets
  wherever the plan's levels differ, plus structure tops; existing context is
  drawn on the plans. Every dimension and level carries `data-src` — an
  expression over graph fields — and a test resolves it independently against
  the traced records. The live dry-run compares every printed figure (h, v and
  level) on the live set against the pure sheets. Elevation sheet numbers are
  ordered by content, never by database id.
- **The 3D scene** `lib/scene/*`: `buildGardenScene` turns the graph into
  triangles (zones at their levels, structures at their heights, context);
  `renderScene` is a deterministic software rasteriser (z-buffer, id buffer,
  outlines, evening glows at the designed light points); `chooseCameras` picks
  one camera per zone and up to three whole-garden views by scoring id-buffer
  probes; `buildManifest` lists what each camera actually sees.
- **The pipeline** `lib/scene-render/pipeline.ts` (+ `POST/GET
  /api/render/scene`): scene image → `google/nano-banana-pro` restyle (the style
  only paints) → **faithfulness gate** (`lib/scene-render/gate.ts`,
  `claude-opus-5` observes both images against the manifest; the pass rule is
  deterministic code) → one tightened retry (the gate's findings, surface
  regions, exact framing) → otherwise the **raw 3D design view** ships, labelled
  as such. The gate fails closed. Evening views relight a passed day render and
  are gated again; without one, the 3D night view ships. Calibration: the raw
  view passes, G4's pergola render fails with exact reasons; `nano-banana`
  reframed, `flux-depth-pro` invented buildings, `flux-canny-pro` paved lawns.
  **Text-prompted off-plan generation is retired for gardens**: `/api/render`
  delegates an exterior zone with no photo to the scene pipeline. An evening
  is also checked against the **night design model**: a lit fitting or wall
  where no light was designed fails it (lighting is as designed). A run whose
  every attempt died before producing an image (no credit, an outage) is an
  infrastructure fault — never saved or cached as a substitution. "Generate
  all" shows each garden view as *Checked* or *3D view* (render withheld).
- **The pack uses gated scene renders only**: `assertPackable` refuses an
  ungated render; every image is captioned "render · faithfulness check passed"
  or "3D design view"; whole-garden pages follow the plan overview; the JSON
  summary carries the gate table. "Generate all" plans a garden by camera
  (`planSceneBatch`).
- **Project isolation**: the scene cache key starts with the project id
  (`sceneCacheKey`, regression-tested with two projects seeded from identical
  records); render rows, camera manifests, storage paths
  (`projects/<id>/scene/…`), garden drawing sheets (`data-project-id`) and BoQ
  `element_refs` all resolve to their own project.
  `scripts/garden-isolation-check.ts` regenerates each project's full pack and
  asserts the other's rows, assets and cached images are untouched, both
  directions, against a stand-in seeded from the same records
  (`scripts/lib/garden-seed.ts`).

**DB step**: `supabase db push` for `036`; the `renders` public bucket must exist.

## Client garden on derived dimensions (garden pilot G5, draft stage)

The first real client garden ("Arabella Garden — Draft for Review", corner plot)
is drafted before anyone has measured it. The derived/measured distinction is the
mechanism, not a workaround.

- **Derived vs measured, per dimension** (migration `037`): `plans.dims_derived` +
  `dims_note`, and `dims_derived` on `rooms`, `plan_elements` (+ `derived_note`),
  `plan_fixtures` (+ `derived_note`) and `plan_context` (whose existing `derived`
  still means "height assumed"). `graphDraftStatus` (`lib/plan/geometry.ts`, over
  `lib/plan/site-reference.ts`) makes a plan a DRAFT while any boundary-critical
  dimension — plot, zone outline, run, context footprint — is derived. Every
  garden sheet then carries a terracotta stamp above the title block
  (`SheetMeta.draft`, `data-draft-statement`), the set gains an **L-000 cover**,
  the render-pack cover and header carry it, and the BoQ page header and every BoQ
  PDF page carry `DRAFT_STATEMENT` verbatim. Interior sheets are unchanged.
- **Site reference** (037): existing features photographed on site are placed as
  what they are (a `structure` zone with `spec.form: "gazebo"`, `counter_run`,
  `planter_run`, new run kinds `stepping_path` and `string_light_run`, landscape
  fixture `tree`, context boundary walls) and tagged `site_reference` with a
  `disposition` ∈ keep | remove | replace (null = undecided). One vocabulary
  decides everything: keep → excluded from demolition AND new work; remove →
  demolition only; replace → both; undecided → neither, and the pack refuses to
  export. The take-off writes `garden.removal` take-off rows and the demolition
  lump's `element_refs`; the 3D scene and drawings use `designGraph` (removed
  items out; kept ones drawn as existing, dashed, never detailed in an elevation).
- **Unpriced work is visible**: a deck, pool, stepping path, string lights or new
  tree has no reference rate — it is a `needs_qs` line at rate 0 under
  `UNPRICED_SOURCE_LABEL`, never silently dropped and never under the
  market-reference label. Quantities off derived geometry carry `qty_derived` +
  `DERIVED_QTY_NOTE`; the BoQ total prints `≈ AED 46,800*` with a footnote
  (`lib/documents/boq-derived.ts`, shared by page, PDF and pack).
- **Readiness gate** (`lib/documents/pack-readiness.ts`): `render-pack` and the new
  `GET /api/projects/[id]/boq-pdf` return 409 `pack_not_ready` while a NEW-work
  counter is untyped, an existing item is undecided, or the latest BoQ still has a
  `needs_selection` line (`?format=json` stays available with the verdict).
- **Editor (Step 2 support)**: the plan page's `GardenSitePanel` (draft banner,
  keep/remove/replace for every existing item, levels/heights via
  `PATCH /api/plan-zones`, pack readiness, friction log); context footprints drawn
  under every layer (`POST/PATCH/DELETE /api/plan-context`); a **Landscape** layer
  (planter box, wall feature, grill, tree — `/api/plan-fixtures` now accepts
  them, and an authored garden is never rule-seeded with lights); every canvas
  fits the PLOT, snaps to 5 cm; numeric X/Y/W/D, add/remove vertex; run and
  fixture inspectors (cross-section, size, light fitting).
- **Before/after photo pairs** (`lib/scene-render/photo-pair.ts` +
  `photo-pair-run.ts`, `POST/GET /api/render/photo-pair`): a client photo
  restyled with the design's decisions on the existing items in view, checked by
  a pair gate (kept items stay, removed go, replaced stay in place, house and
  viewpoint unchanged, nothing major invented; deterministic judge). Fails twice →
  WITHHELD (no substitute). `renders.mode = "photo_pair"`, project-first cache key.
- **Narrow-plot cameras** (`lib/scene/cameras.ts`, pipeline `g5-1`): a
  standpoint with under `NARROW_M` (6 m) of clear width to a building, wall or
  plot edge is cramped and gets no eye-level camera; zones in a corridor are seen
  from ELEVATED three-quarter views (4.2/5.6 m up, FOV 70, aimed at eye height,
  looking along the corridor axis — allowed up to 3 m beyond the plot line, kept
  2.2 m off buildings), and a narrow garden's whole-garden views look along two
  DIFFERENT corridors from 6.5 m. Every camera gets a clean-view verdict (zone ≥
  10% of frame, no solid mass within 2.2 m of the lens, a horizon, walls ≤ 45%,
  no structure > 40%); an unclean camera never spends a render attempt
  (`shouldAttemptRender`) — the labelled 3D design view ships with
  `design_view_reason: "no_clean_camera"` ("3D view · by choice" in Generate
  all). Cameras are memoised per scene hash in `loadGardenSceneContext`.
- **Pack backbone**: cover → plan → before/after pairs → whole-garden views →
  zones → materials. 3D design views fill every slot no render passed (by-choice
  views captioned as such); a passed day render carries its design view as an
  inset; the cover and `summary.mix` state the mix (pairs, design views by choice
  / after the gate, styled renders).
- **Metrics** (037): `pilot_events` (plan_started, plan_saved, design_edit,
  boq_generated with `full`, pack_exported, friction) written best-effort by the
  routes for authored plans; `computePilotMetrics` (`GET /api/pilot-events`) —
  time to draw (design session only; `stage: reference_layout|verification`
  events excluded), active minutes, time to first FULL BoQ, gate pass rate,
  friction list, corrections by type. `boq_corrections` (typed rate | quantity |
  scope | design, `market_fair` provenance, never applied to the rate book) via
  `ReviewCorrections` on the garden BoQ page.
- **Scripts**: `scripts/arabella-draft-plan.ts` (Step 1 through the authored
  routes; refuses to re-run; `--name` for a scratch rehearsal),
  `scripts/garden-draft-pack.ts <project>` (Step 3/4: readiness, BoQ, renders,
  photo pairs, three PDFs into `data/garden pilot/g5-draft-pack/` — gitignored,
  they contain client photos — and assertions on what is printed: watermark,
  derived total, needs_selection, elevations, overlays, zero contractor-identity
  leakage; gate table; metrics; Step-5 baseline),
  `scripts/garden-change-report.ts <project>` (Step 5 receipt: every quantity
  that moved, BoQ delta, whether the watermark drops),
  `scripts/garden-isolation-check.ts --client <id>` (now also snapshots photo
  assets, room photos, plan-uploads storage, pilot events, corrections).
- **Reference layout**: `lib/client-garden/arabella-reference.ts` — plot 26.7 ×
  10.5, garage/drive 6.3 + house 14.8 + side garden 5.6 (deck 2.1 + lawn 3.5),
  rear strip 4.3, the 0.1 m depth residual stated; existing features from the 14
  client photos; `PHOTO_COVERAGE` maps photos to zones and visible items. No client
  personal name anywhere.
- **Replaced by a different element** (`spec.replaced_by`, G5 design seed):
  replace used to mean like-for-like. When the replacement is ANOTHER design
  element (stepping path → porcelain paving zones, sink counter → a BBQ counter
  under the pergola, string lights → designed lighting) the old item counts toward
  demolition only, is out of the design (`isInDesign`), and the replacing element
  carries the new work — never both priced. `replaced_in_place` tells a photo pair
  whether the replacement stands where the old item did (otherwise it is simply
  gone from that camera). API only (no editor control yet).
- **Design assumptions page** (`lib/documents/design-assumptions.ts`): after the
  plan overview, a draft pack lists every existing item's proposal (REPLACE →
  what it becomes, REMOVE, KEEP), built from the same dispositions the take-off
  priced, plus layout assumptions (`spec.assumption`, context notes) and "Design
  direction … proposed, to confirm with the client". Absent when nothing is
  proposed (a completed garden).
- **Document names** (migration `038`): `projects.display_name`, set via
  `PATCH /api/projects/[id]`; every client-facing document (drawing set, render
  pack, BoQ PDF) reads the project through `loadDocumentProject`, so a working
  name like "…(ground truth)" never reaches a cover.
- **The gate checks what the client was promised, not just "a structure"**: a
  louvred pergola is named `louvred pergola` in the scene manifest and the gate is
  told shade sails / fabric / timber rafters are a different structure (a
  shade-sail render had passed as "a pergola" and become the cover); an existing
  tree the design KEEPS is `existing tree (kept)`, on the gate's list once ≥ 1% of
  the frame and in the render prompt's keep line (a render that dropped all six
  kept trees had passed). Both apply only where such items exist — other prompts
  are byte-identical.
- **Pair gate robustness**: the reply schema takes whatever the model names the
  extra-structure text field and treats an unsure `null` as "no" (a reply with
  `"what"` instead of `"description"` had made the gate "unavailable"); a withheld
  pair with no verdict (`isVerdictless`: every attempt a render error or an
  unavailable gate) is neither cached nor trusted from cache. The draft-pack
  script tries a zone's second photo when its first pair is withheld.
- **Seeding and reference packs are not the pilot**:
  `scripts/arabella-design-seed.ts` applies a design proposal through the authored
  routes and tags its events `stage: design_seed` (excluded from design-session
  minutes); `scripts/garden-reference-pack.ts` sets the reference project's
  display name, renders every camera, exports the render pack + drawing set (no
  BoQ — negotiated prices) and asserts no "ground truth", no house number, no
  contractor identity, no price and no draft watermark; its events are
  `stage: reference_pack` (excluded from metrics like `verification`).

**DB step**: `supabase db push` for `037` and `038`.

## Pack defects found in review, fixed at the root (garden pilot G5c)

The G5 draft pack went to review and came back with defects in three places: the
geometry was mirrored, the BoQ was incomplete, and the renders were not
client-viable. Each is fixed where it was wrong, not papered over.

- **Handedness** (`HANDEDNESS`/`toSite` in `lib/client-garden/arabella-reference.ts`,
  `scripts/garden-mirror-plan.ts`). The developer type plan depicts the unit's
  HANDED TWIN: on site the garden entrance and path are on the RIGHT facing the
  villa, then the rear strip, the pergola corner, the side garden on the LEFT.
  Established from the photos, not assumed — walking in from the front passage
  (WA0084–0086) the villa is on the LEFT and the rear wall's trees on the RIGHT
  (WA0077, WA0082), which the type-plan frame reverses. The fix is ONE reflection
  x → W − x applied to zones, runs, fixtures, context and openings through the
  editing routes, with polygons and polylines reversed so winding (and a run's
  band side) keeps its orientation. A reflection preserves area and length, so
  the script asserts the BoQ and every take-off row are byte-identical across it
  (they were: AED 116,942.01, 15 lines, 28 rows) and refuses to run twice.
- **The separator wall and its gate** (migration `039`): a garden's walls are
  `plan_context` footprints, not walls derived from room edges, so an opening
  could never attach to one. `plan_openings` gains `kind = 'gate'`, `context_id`
  (the wall it is in, never re-snapped), `spec` and the 037 site-reference
  columns. Gates are drawn on the site plan and zone sheets (clear opening,
  jambs, leaf and swing, `GT` tag), built in the 3D scene (posts + leaf), decided
  in `GardenSitePanel` like every other existing item, and listed on the cover
  and in the Design assumptions. The existing shed is a `landscape` fixture type
  with a footprint on the plans and a volume in the scene.
- **Scene = graph, proven.** The pergola was reported as "in the corner on the
  drawings, mid-pathway in the 3D". The scene builder was reading the same
  coordinates all along (x 23.2–26.7 in both); what misled was an oblique
  eye-level camera down a 4 m strip, where the far rear wall itself projects to
  the middle of the frame. `lib/scene/__tests__/scene-graph-parity.test.ts`
  pins it: every structure's scene bounds equal its plan bounds, and the id
  buffer at each structure's projected centre is that structure.
- **BoQ completeness**: planting beds carry a soil-preparation and planting line
  (GL-25, QS-to-price — they were measured for irrigation but never priced);
  outdoor taps are a placeable `water_tap` fixture on the irrigation/drainage
  overlay with a line under Plumbing (GL-26); the irrigation allowance is ONE
  lump at quantity 1 priced at the band factor (`ScopeItem.rate_factor`), so the
  BoQ reads "1 lump, AED 17,600" with the band explained, not "1.6 lump".
- **Textured conditioning image** (`lib/scene/textures.ts`, `renderScene({ textured })`):
  the walkthrough's procedural finish recipes (tile with grout, wood boards,
  stone veining, plaster mottle, at their true repeat lengths) ported to the
  server rasteriser as pure functions of world metres, plus garden families
  (grass blades, mulch, foliage, louvre blades), world-planar UVs and a sun
  shadow map. Paving tiles at 1200 × 600 — the size the BoQ prices. The flat line
  model still decides the manifest (identical ids and depth, asserted) and is
  demoted to a small inset beside a passed render; a substitution ships the
  TEXTURED model, never the flat one.
- **Cameras**: every zone attempts a render (`shouldAttemptRender` no longer
  refuses an unclean camera — a pack of design views is not client-viable);
  standpoints stay INSIDE the plot (G5's over-the-wall views looked across empty
  neighbouring land); a structure is photographed from 1.5–2.1 × its extent back;
  tree canopies are camera obstacles; thin strips (< 1.5 m) get a lower
  frame-share threshold; and `aerialCamera` adds a plan-aligned bird's-eye of the
  whole garden. The scene also carries the NEIGHBOURHOOD — a pale two-storey
  volume beyond every plot edge that has a boundary wall — because a model
  looking over a wall at nothing invents gardens there.
- **One garden, not three** (`lib/scene-render/design-spec.ts`,
  `consistency.ts`): every view shares one deterministic design specification
  (pergola design, paving size and colour, planting palette, counter with grill
  and sink, wall finish, kept trees), which also replaces the style's own feature
  list — Desert Modern's "linear corten planters" and "sandstone paving" argued
  with the design and appeared in view after view. After the renders, a
  consistency gate compares each passed view against the ANCHOR view (the first
  of pergola → aerial → whole-garden → biggest clean zone to pass its own gate);
  a view that differs on pergola design, paving, planting or wall finish does not
  enter the pack as a render. **Conditioning on the anchor IMAGE was tried and
  rejected on measurement**: it moved the client garden from 10/13 to 4/13 passes
  (a second image pulls composition, exactly as the G4b style-image calibration
  found), so the shared reference is the text and the gate enforces the rest.
- **Photo pairs**: the gate adds `house_side_matches` (a mirrored garden is not a
  render of this one) and `visible_change` 0–3 (an "after" that changes almost
  nothing is not a before/after; below 2 is withheld), the prompt carries the
  design specification, and the pack takes ONE pair per zone.
- **Parity gate** (`lib/documents/parity.ts` + `parity-load.ts`, on every pack
  export and `GET /api/projects/[id]/parity`): every BoQ line maps to an element
  visible on ≥ 1 drawing sheet AND in ≥ 1 render/scene view; every drawn element
  with a cost impact maps to a line. Lines with nothing to point at
  (preliminaries) and elements the rate book absorbs (drainage points) are
  EXEMPT with the reason. It caught the L-bench (priced, drawn, in no view) and
  the 6 boundary wall lights, whose fittings sat inside the wall geometry where
  no camera could see them (they are now mounted on the garden-facing face).
  Runs, fixtures, gates and removed zones carry their ids on the sheets so the
  check can see them; light fittings and taps are `fixture`-category scene
  objects, listed in a manifest but never on the faithfulness gate's list.

**DB step**: `supabase db push` for `039`.

## The design session, applied (garden pilot G5d)

The first working session with a landscape firm (Newspace) came back as a filled
workbook, `data/garden pilot/Arabella_Session_Capture.xlsx`, and a list of pack
comments. `scripts/arabella-session-apply.ts` applies it through the authored
routes — the workbook is unzipped and parsed, never retyped, and every value it
applies is asserted against it.

- **Measurements, honestly** (`lib/client-garden/arabella-session.ts`). Five
  point measures (path from the garden gate 12.2 m, entrance area 5.85 m,
  separator → end-of-pathway wall 6.0 m, front border 5.3 m, door landing
  1.20 × 1.30 m) and two AGGREGATES (grass ≈ 50 m², tiled ≈ 69.4 m²). The refit
  rule: every cross-section the draft designed stays as designed; the measured
  runs set lengths; the aggregates are met by sizing the only surfaces the draft
  never designed — the new entrance area's paved depth and the front lawn patch —
  whose sizes are derived and noted "sized to measured aggregate". Only zones with
  a measured boundary-critical dimension flip to measured (the path, the landing);
  a zone with one measured and one aggregate-sized extent stays derived. The
  2.35 m of the (derived) 26.7 m plot the measured runs do not reach is left
  UNALLOCATED at the garage end and stated — never spread across zones. The plot
  is unmeasured, so the DRAFT watermark stays. The door landing is a typed paving
  zone (priced as paving). `reconciliation()` prints every zone draft → point
  measures → aggregate refit with its driver(s).
- **Staged, so every movement has one cause.** The script regenerates the BoQ
  after each stage — fix → design decision → dimension update → aggregate refit →
  correction — and attributes each stage's diff to that cause
  (`screenshots/garden-pilot/g5d-session.json`). Result: grass 76.9 → 50.0 m²,
  tiled 62.95 → 69.41 m², AED 116,942 → 116,217.
- **Session data** (migration `040`): `boq_corrections` gains `confirm` ("the BoQ
  looks right" is a milestone), `attributed_to` (the firm — on its own
  corrections, nowhere else), `confidence` and `session_ref`; every correction
  also writes a `correction` pilot event, and a Sheet B/C answer applied is a
  `session_decision` event, both tagged `stage: design_session` with the
  instrumentation record ("three-firms #1"). `computePilotMetrics` reports
  corrections by type (confirms included) and per session record. A rate
  correction is captured, never applied to the `actual_transaction` rate book.
- **Built-feature placement gate** (pipeline `g5d-2`). Three passed renders had
  shown three arrangements of the same pergola, counter and bench. The gate now
  asks the vision model WHERE each built feature is (a box) and how many copies
  there are; `judgePlacement` (pure) fails a feature that is not located, moved
  (centre off by more than max(12% of the frame, 60% of its extent)), duplicated,
  or on the wrong side left/right of another feature or a landmark wall (a wall
  seen end-on — the separator). The restyle prompt states the arrangement left
  to right, each exactly once. `assertPackable` refuses a passed render whose
  placement was never checked, so two passed renders cannot disagree
  (`lib/scene-render/__tests__/placement.test.ts`, on the real client scene).
  The model answers in PIXELS about one reply in eight despite being asked for
  percent; `normalisePlacements` converts with the candidate's real size
  (`imageSize`, from the header) before judging — g5d-1 had failed correct renders
  as "moved" on exactly that.
- **A measure that cannot be mapped is held, not applied.** The front / street
  border measured 5.3 m; mapped onto the front garden it left the drive ~1.0 m
  wide, so the measurement and the type plan disagree about which edge "the front
  border" is. It is recorded in `UNMAPPED_MEASURES` with the reason, printed on the
  pack's Design assumptions page, and logged as pilot friction ("a measured figure
  that cannot be mapped"); the front garden keeps its type-plan derived footprint
  (2.2 × 4.0 m, drive 4.1 m) and the other six measures stand. The grass aggregate
  is then met over the zones it can cover — rear + side = 47.82 m² against ≈ 50 —
  and the front garden's 6.40 m² is stated as outside it rather than quietly
  resized to make the arithmetic close (AED 116,217 → 116,679).
- **A render is stale only when its own view changed** (`lib/scene/view-hash.ts`).
  The cache key carries the whole scene's hash, so a change at one end of the plot
  invalidated all 30 renders of it and made a small amendment expensive enough to
  discourage making it. A render is now carried forward when the camera's manifest
  is IDENTICAL to the one it was gated against and every object whose geometry
  changed is at least 12 m from the lens (so it cannot have cast a shadow into a
  frame it is not in). It fails closed — no fingerprint, no exact manifest match,
  no reuse — and the carried-forward row records `reused_from` with the reasons,
  so no pack shows an image nobody can trace. Reverting the front border re-rendered
  the views that see the front garden or the garage's notch and reused the rest.
- **Photo pairs** (`g5d-1`): a structure replaced in place carries what the plan
  builds inside it — the BBQ counter under the pergola is an `add` item that must
  show, or the gate reports it out of crop and the caption says so.
- **Surroundings from the graph** (`plan_context.spec.beyond` = neighbour |
  street | open). The G5c neighbourhood volume stood behind every walled edge,
  and the aerial painted a neighbouring villa over the client's own entrance.
  Where the plan declares what is beyond a wall, the scene follows it (only a
  wall that RUNS along an edge speaks for it); undeclared gardens are unchanged.
  The design specification names the surroundings and the gate; the aerial
  camera prefers a view that shows the garden entrance.
- **BoQ**: drainage points on L-402 are a QS-to-price line (GL-28, rate 0 — the
  reference contract absorbed them at no charge, so a visible line invents no
  cost; the double-count guard ignores rate-0 lines). The parity gate now counts
  overlay SYMBOLS (lights, boundary lights, taps, drainage) against their line's
  quantity. An **indicative delivery programme** (`lib/boq/programme.ts`) is
  stored on the BoQ — the reference 90 days scaled by value, clamped 0.5–1.5×,
  phases split by the value of their work, labelled indicative / derived — and
  shown on the BoQ page and PDF. It is never a line.
- **Pack fixes**: body/caption sizes raised (render pack ≥ 3.1 mm, BoQ PDF ≥ 2.6
  mm; paragraphs re-wrap); the facts band sits below the tallest caption; a view
  that is not a passed render carries ONE neutral line ("Visualisation pending —
  …, see L-100 / L-401") — the gate's findings stay in the run report; an evening
  that did not pass is DROPPED (the day view says "lighting as designed, see
  L-401"); a zone whose own camera failed shows the passed view that shows it best
  (a structure ≥ 12% of the frame), captioned with where it is from. L-201 prints
  "Ground (external works)"; the pergola elevation falls back to the scene's
  corner posts, and the client pergola now carries its four posts.
- **Pricing question for the firm's written review** (not changed): the reference
  pergola line (E1.1, "3.5 × 3.5 × 2.8 m, alum 150 × 150 structure, 8 downlights,
  coating") names no slab, and the G3 dry-run showed the paving under it was
  bought separately (66.24 m² of tile against 64.27 m² drawn INCLUDING the
  footprint) — so the rate excludes its base and the 12.25 m² stays in the paving
  lines. Were it included, the deduction would be 12.25 × (105.6 + 70.4 + 128.1) =
  AED 3,725 before contingency and VAT.

**DB step**: `supabase db push` for `040`.

## The journey — nine steps, one definition (B1/B2/B3)

`lib/journey.ts` is the single source of truth for the Phase-1 Target Workflow.
Every page derives its own "Step N of M" from it via
`components/app/JourneyChrome` (`JourneyProgress` for pages that own their
heading, `JourneyChrome` for the full header) — **never hard-code a step
number**. A step that is flag-disabled or not yet built **drops out of the
numbering**, so the denominator always matches what is actually navigable and
there are no dead ends.

1 Intake · 2 Layout · 3 **Ideation** · 4 **Moodboard** · 5 Renders ·
6 Costing & BoQ · 7 Scope & timeline *(T4 — unbuilt, currently absent)* ·
8 Downloads *(`DRAWINGS_ENABLED`)* · 9 Vendors → **8 steps today**.

**Style selection folds into step 3** — the questionnaire recommends a
direction; `/project/[id]/style` is a second surface on that same step, not a
step of its own. The **3D viewer is deliberately off the numbered path** (a
view-only side surface reached from the layout and render steps).

- **B1 questionnaire** (`lib/ideation/questionnaire.ts`, `project_briefs`):
  six weighted questions scored by a plain weighted sum. **No LLM** — a
  recommendation must be reproducible, or "re-run" is a dice roll. The route
  recomputes `recommended_style_key` from `answers` on every write, while a
  manual pick lives in a **separate `override_style_key` that a re-run never
  reads or writes**. That separation is what makes the flow safe to redo.
- **B2 moodboard** (`lib/moodboard/*`, `moodboard_items`): ordered references,
  each exactly one of a built-in style image, a render, or a user upload via
  the reusable `components/assets/AssetPicker` (`reference_image` kind, so
  uploads land in the asset library and stay reusable).
- **B3 taste seed** (`loadTasteSeed` in `lib/render-grounding.ts`, flagged
  `TASTE_SEED_ENABLED`): the board's first 3 references become extra image
  inputs and their descriptors a `References:` clause. **Style descriptions
  only — never quantities, never dimensions, never plan geometry**, plus an
  explicit "do not copy their layout": the edit model takes architecture from
  the source image and a moodboard must not argue with it. Style descriptors
  are derived deterministically from `lib/styles`; only an upload's descriptor
  is LLM-writable. Like every prompt block it only appends, so flag-off and
  flag-on are two cache entries. `renders.reference_refs` records the lineage —
  `null` = seeding did not run, `[]` = ran against an empty board.
- **DB step** (`supabase db push` — see `docs/MIGRATIONS.md`): apply `scripts/migrations/027_ideation.sql`. Everything
  degrades gracefully until then (the questionnaire runs locally and says so).

## Env vars

| Name                              | Where used              |
| --------------------------------- | ----------------------- |
| `ANTHROPIC_API_KEY`               | server (Claude calls)   |
| `REPLICATE_API_TOKEN`             | server (image gen)      |
| `RENDER_MODEL`                    | server — optional; edit model id for renders (default `google/nano-banana`) |
| `NEXT_PUBLIC_SUPABASE_URL`        | client + server         |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | client                  |
| `SUPABASE_SERVICE_ROLE_KEY`       | server only — never expose |
| `NEXT_PUBLIC_POSTHOG_KEY`         | client — analytics on/off switch; unset = no-op |
| `NEXT_PUBLIC_POSTHOG_HOST`        | client — PostHog ingest host (EU: `https://eu.i.posthog.com`) |
| `NEO4J_URI`                       | server (KG retrieval)   |
| `NEO4J_USER`                      | server (KG retrieval)   |
| `NEO4J_PASSWORD`                  | server (KG retrieval)   |
| `KG_ENABLED`                      | server — `"true"` turns on KG grounding |
| `BOQ_ENGINE`                      | server — optional; unset = deterministic `lib/boq` engine, `"llm"` = legacy Claude-priced path |
| `PERMIT_CHECK_ENABLED`            | server — `"true"` turns on the P6 Dubai permit-trigger checklist |
| `STAGING_ENABLED`                | server — `"true"` turns on P7 furniture staging (render prompt + optional BoQ section) |
| `PROPERTY_OS_LANDING`             | server — `"true"` makes `/` the Property OS intro page (visitors) and moves the RennovAIte homepage to `/rennovaite`; unset/false = `/` is the homepage (as before) |
| `TASTE_SEED_ENABLED`              | server — `"true"` lets a project's moodboard condition its renders (B3). Off = renders behave exactly as before |
| `TEXTURED_WALKTHROUGH`            | server — `"true"` lets the 3D walkthrough read StyleBoard finishes onto floors and walls (F1). Off = the clay model, unchanged |
| `PARSE_PROVIDER`                  | server — optional; which floorplan parser to use. Only `"inhouse"` (the default) is configured; any other value throws rather than silently mis-parsing |
| `GARDEN_PILOT_ENABLED`            | server — `"true"` turns on G1: drawing a plan from scratch, outdoor zone types, the unroofed/open-edge enclosure model, and the linear-element layer |

### Feature flags — read at server start (flip → restart)

**All server feature flags in this app are read from `process.env` at server
start** (`process.env.X === "true"`), so changing one in `.env.local` requires a
**dev-server restart** to take effect — there is no runtime toggle. This covers
the Pilot-Seven flags below and `PROPERTY_OS_LANDING`. Every flag defaults off,
and off = pre-flag behaviour.

**`PROPERTY_OS_LANDING` (G1 / landing)** — off: `/` renders the RennovAIte
marketing homepage exactly as before. On: `/` renders the four-pillar Property
OS intro (`app/_components/property-os-landing.tsx`) for visitors; a signed-in
visitor is redirected to their portal (`/project`, the auth-callback default);
both the nav "Open RennovAIte" and the card "Enter RennovAIte" CTAs link to
`/rennovaite`, which always hosts the homepage (`components/marketing/home-landing.tsx`).
The three non-RennovAIte pillars are inert roadmap tiles (badges + copy, no
links). The root becomes dynamic (`force-dynamic` behaviour) because of the
auth-aware redirect.

### Pilot Seven feature flags (reserved)

Placeholders for the seven-feature pilot, added to `.env.local.example` by the
pre-flight (`PILOT_SEVEN_PREFLIGHT.md`). As wired: `DRAWINGS_ENABLED` (P1),
`OVERLAYS_ENABLED` (P2), `VIEWER_3D_ENABLED` (P3, also gates P4 inspect),
`WHATIF_ENABLED` (P5), `PERMIT_CHECK_ENABLED` (P6, renamed from the reserved
`COMPLIANCE_ENABLED`), `STAGING_ENABLED` (P7). All default off.

KG grounding (render + BoQ prompts) only activates when `KG_ENABLED="true"`
**and** Neo4j is running. If Neo4j is down or `KG_ENABLED` is anything else,
the app falls back to its pre-KG behaviour with no error — but note the
fallback costs a **10 s timeout per call**, so turn `KG_ENABLED` off rather
than leaving it on against a stopped database.

**Starting Neo4j:** `docker start rennovaite-neo4j` (allow ~40 s to reach
`healthy`). The container and its named volumes `kg_neo4j_data` /
`kg_neo4j_logs` already exist and persist the seed, so this needs no compose
file and works from any directory. **`cd kg && docker compose up -d` does NOT
work from this repo** — `kg/` here holds only the vendored consumer copy
`kg/retrieval/agent.ts`; the seed, loader, and `docker-compose.yml` live in the
separate KG module (its own git repo) at
`C:\Users\alsha\OneDrive\Desktop\RennovAIte\RennovAIte\kg`. Use compose only
from that directory.

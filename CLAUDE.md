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
- **Manual DB step**: apply `scripts/migrations/024_project_assets.sql` in the
  Supabase SQL editor (no runner). Everything degrades gracefully until then —
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
  metres are derived from `total_area_m2`, ceilings default to 2.9 m, and
  **openings are empty** (we never invent doors). Every derived value is flagged
  (`derived: true` / `derived_fields`) and surfaced in the UI + `derivedNotes`.
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
- **Manual DB steps** (no migration runner — DDL can't be run with the
  service-role JWT; apply in the Supabase SQL editor, same as 001–012): apply
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
- **Manual DB step**: apply `scripts/migrations/015_plan_fixtures.sql` in the
  Supabase SQL editor (no runner; service-role JWT can't run DDL). The unit
  tests + flag-off behaviour work without it; seeding/editing/BoQ-feed activate
  once it's applied.

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
- **Manual DB step**: apply `scripts/migrations/016_renders_kind.sql` (Supabase
  SQL editor). The viewer works without it (defaults `kind` to `'still'`).

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
- **Manual DB step**: apply `scripts/migrations/021_staging.sql` (Supabase SQL
  editor) — adds `renders.staging_set`, `furniture_opt_ins`, and the optional
  `furniture_prices` table. Unit tests + flag-off/degraded behaviour work without
  it; opt-in persistence + the live BoQ section + `staging_set` tracing activate
  once it's applied. Optional: `node scripts/seed-furniture-prices.ts` to seed
  DB-editable price overrides.

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

### Pilot Seven feature flags (reserved)

Placeholders for the seven-feature pilot, added to `.env.local.example` by the
pre-flight (`PILOT_SEVEN_PREFLIGHT.md`). As wired: `DRAWINGS_ENABLED` (P1),
`OVERLAYS_ENABLED` (P2), `VIEWER_3D_ENABLED` (P3, also gates P4 inspect),
`WHATIF_ENABLED` (P5), `PERMIT_CHECK_ENABLED` (P6, renamed from the reserved
`COMPLIANCE_ENABLED`), `STAGING_ENABLED` (P7). All default off.

KG grounding (render + BoQ prompts) only activates when `KG_ENABLED="true"`
**and** Neo4j is running — start it from the KG module with
`cd kg && docker compose up -d`. If Neo4j is down or `KG_ENABLED` is anything
else, the app falls back to its pre-KG behaviour with no error.

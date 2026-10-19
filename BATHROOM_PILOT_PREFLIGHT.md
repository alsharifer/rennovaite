# Bathroom pilot — pre-flight (18 Oct 2026)

Report only — nothing in the app changed. Checked on `master` @ `9885cea`.

## Verdict: GO, with one sequencing condition

> **Update, 18 Oct:** #112 merged to master (`483ffe0`) after this check, so
> the condition below is met. B1 can branch from master.

The baseline is green. Every K item is merged. Nothing found blocks the pilot.

**Sequencing:** PR #112 (plan editor guardrails, OPEN) touches five files that
B1/B2 will edit: `editable-plan-viewer.tsx`, `overlay-editor.tsx`,
`api/update-plan/route.ts`, `lib/plan/derive.ts` and `lib/plan/geometry.ts`.
Either merge #112 before B1 starts, or cut B1 from `feat/plan-guardrails`.
The next free migration is **061**; #112 adds none.

The work is bigger than "reuse what we have". The interior 3D scene is entirely
new, and so is any constraint on where fixtures go (see (b) and (c)). The
style-from-references path is close to free (see (d′)).

**What B1–B4 means here.** The brief does not define them. They are read from
its questions:

| | Scope |
|---|---|
| B1 | Dimensions: one room from typed L × W, plus a ceiling height |
| B2 | Fixtures massed in the room, and a restyle that keeps them where they are |
| B3 | Style taken from the client's reference photos |
| B4 | The renders page |

(These are not the ideation journey's B1–B3 in CLAUDE.md.)

## Baseline

| Check | Result |
|---|---|
| K1–K12 | All merged: K1/K2 #93–#94, K3 #96, K4–K7 #97, K8 #100, K9 #102, K10 #103, K11 #104, K12 #105 |
| Since K12 | R10a #108, Q-11 #107, R10b #109, R10b follow-up #110 merged; #112 open |
| `vitest run` | 148 files, **1,647 passed + 2 expected `it.fails`** (Mudon alignment acceptance) |
| `tsc --noEmit` | exit 0 |
| eslint | 0 errors, 1 known warning (`lib/assets/__tests__/types.test.ts` unused `DRAWING_KINDS`) |
| `next build` | not run. The worktree's node_modules is a junction, which Turbopack refuses (CLAUDE.md KV note). |

## (a) Dimensions path, and photo coverage

**Can the restyle keep fixture placement, G5d-style? Not today.**

- The interior photo path (`app/api/render/route.ts`, mode `photo`) takes:
  - the latest room photo;
  - a prompt (style fragment, palette, "keep architecture… exactly the same", Materials clause, KG, staging);
  - images `[photo, style moodboard art, ≤3 taste-seed images]` (route.ts:392-396).
- The only check is `lib/render-qa.ts`: structure preserved / artifacts / photorealistic. It fails open, and its single retry drops the reference images.
- Nothing in that path holds a fixture list, a manifest or a placement check.
- G5d's `judgePlacement` (`lib/scene-render/gate.ts:236-272`) is generic code, but it needs a camera manifest with expected boxes. Those come only from the 3D scene, and the scene is garden-only (see (b)).
- The garden photo-pair gate (`lib/scene-render/photo-pair*.ts`) checks presence and `roughly_in_place` only, with no boxes. It is hard-wired to `loadGardenSceneContext` and `GARDEN_PILOT_ENABLED`.

**→ B2 is mostly new work.** What can be lifted:

- the pair-gate pattern: the manifest shape, the deterministic `judge*` pass rule, the retry-then-withhold loop and `isVerdictless`;
- the `judgePlacement` arithmetic.

What does not exist yet:

- an interior item source (the room's fixtures and openings);
- interior prompt and gate text;
- for box-level placement, an interior scene to project expected boxes from.

The cheaper first step is a pair-style present / in-place gate against the BEFORE photo.

### (a′) Typed L × W, `ceiling_h_m`, and the take-off

**Typed L × W — only on an authored plan, and authored plans need `GARDEN_PILOT_ENABLED`.**

- `POST /api/draw-plan` returns 404 when the flag is off (`app/api/draw-plan/route.ts:100-105`). It requires `plot_width_m` × `plot_depth_m`, which become the plan's measured scale. It inserts no rooms.
- In the editor, "Add room" drops a fixed-size rectangle. The user then types W × D in `ZoneGeometryBar` (`editable-plan-viewer.tsx:1748-1817`: X/Y/W/D, 5 cm snap).
- That bar shows only when the plan has a `plot`, i.e. an authored plan, and only on a 4-vertex rectangle.
- It works for interior types too. But on a plot a new room defaults to `paving` / "New zone", so the type must be changed.
- No route creates a room straight from L × W. On a parsed plan, rooms are drag-only.

**`ceiling_h_m` — not persisted, not editable, always defaulted.**

- No migration adds a ceiling column.
- `buildPlanGraph` sets `ceiling_h_m: unroofed ? 0 : DEFAULT_CEILING_H_M` (2.9) and flags it derived (`lib/plan/geometry.ts:38, 674`).
- `rooms.height_mm` (036) does exist, but only structure zones use it: the garden site panel, elevations and scene. It is never turned into `ceiling_h_m`.
- Neither `/api/update-plan` nor `/api/plan-zones` accepts a ceiling height.

**The take-off — two paths, both effectively 2.9 m.**

- **Element take-off** (`lib/boq/quantify.ts`) runs on every BoQ and replaces the six mapped sections. It READS the graph's `ceiling_h_m` (`:109`, `|| 2.9`):
  - `wet_tiling` = perimeter × h, full height, net of openings (`:186-202`);
  - `wall_plaster` / `wall_paint` = length × max adjacent h (`:207-225`).
  - So persisting a real ceiling height flows through with no take-off change.
- **Engine take-off** (`lib/boq/takeoff.ts`) uses constants from `lib/boq/rules.ts`: `WALL_HEIGHT_M` 2.9 and `BATH_TILE_HEIGHT_M` 2.9 (was 2.4).
- **Skirting** (R-10, `floor.skirting`) is perimeter minus doors, with no height.
- **Side finding — skirting is dropped.** R-10 lives in Floor Finishes, which is a MAPPED section, and `quantify.ts` has no skirting item. `applyElementMapping` keeps only Q-11b / Q-11 (`element-map.ts:57-67`). So every BoQ with an element take-off drops its skirting line, the same way Q-11 was dropped before #107. This does not matter for a tiled bathroom, but it does for dry rooms. It is out of scope here and noted for K_BACKLOG.
- There is no tiling height (1.2 / 2.4 m splash vs full) anywhere in active code. If the pilot needs one, it is a new rule.

## (b) Reusing the scene for an interior

**Nothing in `lib/scene/*` or `lib/scene-render/*` builds an interior.**

**Scene builder.**

- `gardenZones()` = `rooms.filter(r => r.unroofed)` is the root of every scene and camera loop. A roofed bathroom never enters the scene; the route answers 404 `unknown_camera`.
- `buildGardenScene` builds:
  - a ground box and neighbour volumes;
  - garden surfaces only;
  - landscape, light and tap fixtures only;
  - gate openings only;
  - context walls only.
- It never reads `graph.walls`. It builds no ceiling, door, window or sanitaryware.
- Materials and textures are a closed garden set. "Tile" exists only at paving scale.

**Raster** (`lib/scene/raster.ts`).

- It fills the sky first; id 0 means sky.
- It has one directional sun with a shadow map, and a ceiling would shade the whole room down to ambient.
- It has no interior light model.
- The geometry itself is fine for an enclosed box: two-sided shading, 0.05 m near clip.

**Cameras** (`lib/scene/cameras.ts`).

| Assumption | Value |
|---|---|
| Eye-level FOV | 58 |
| Zone eye heights | 1.65 / 2.6 m |
| `NARROW_M` (room skipped as cramped below this) | 6 m |
| Elevated views | 4.2 / 5.6 m high, 3.5–16 m back, FOV 70 |
| Whole-garden views | 6.5 m / 3.6 m |
| Aerial | yes |

- A 2.5 × 3 m bathroom is "cramped" everywhere, and every elevated view sits above its ceiling.
- `cleanCheck` would fail every frame on three counts:
  - no horizon (sky < 3%);
  - solid mass within 2.2 m;
  - walls > 45%.

**Prompts, design spec, consistency and style.** All are garden vocabulary:

- "3D design model of a real garden", "horizon";
- `DIRECTION` covers only the two garden styles;
- `loadGardenSceneContext` forces a `GardenStyle`.

**R10c `lib/render/cameras.ts`** is the right starting point, but it is 2D only: plan-unit position and target, no height, no FOV. It provides arms, ≥ 0.4 m wall clearance and 1–3 views per room. It is **not wired in** — only its test imports it.

**`roomTypeFromDb`** (`lib/render-prompts.ts:145-174`).

- Bathroom IS renderable on the interior path: `bathroom`, `ensuite` and `powder` all map to `bathroom`.
- `InteriorRoomType` = master-bedroom · secondary-bedroom · bathroom · living · dining · majlis · kitchen.
- Anything unmapped is still a hard **422 `room_type_unsupported`** at `/api/render` (route.ts:144-155): closet, maid, laundry, foyer, stairs, storage, other. Batch, studio and lock-progress filter those out silently.

**Faithfulness gate** (`gate.ts`). It checks **built features, not openings**:

- every `structure`-category manifest object for present / in place;
- G5d placement: located, moved, duplicated, left-right swapped against other built items and boundary-wall landmarks;
- surfaces / context / kept trees by frame share;
- extra structures and extra lights;
- same viewpoint.

Doors and windows are not in the scene, so they are never checked. The judging code is generic. The vocabulary is garden-bound: the prompt says "garden", the landmark noun is `"boundary wall"`, and the extra-structure list is pergola…building. Reusing it for a bathroom means new nouns and new text, not new logic.

## (c) Fixtures

**A bare point list.**

- `plan_fixtures` (015, + 037 site-reference columns) stores:
  - `type` (enum-checked at the API);
  - `room_id`;
  - `position` [x, y] normalised;
  - `wall_id` (a column, but always null: seeding hard-codes it and the editor never sends it);
  - `spec` jsonb (free-form, `z.record(z.unknown())`);
  - `source`.
- No rotation, offset-from-wall, width or depth.
- Plumbing types: `wc_point`, `basin_point`, `shower_mixer`, `sink_point`, `washing_machine_point`, `water_heater`, `floor_drain` (+ garden `drainage_point`, `water_tap`). **There is no bath** and no bidet.
- Seeding spreads a bathroom's WC / basin / shower / drain / heater around the inset bounding box — "the BoQ uses counts, not positions" (`lib/overlays/seed.ts:78`).
- The BoQ is one line per type, quantity = count (`lib/overlays/boq.ts:51-71`). Spec and position are never read.

**Not enough for massing as stored, but no migration is needed.** `spec` can carry `width_mm` / `depth_mm` / `rotation_deg`, and `wall_id` exists. What is missing:

- per-type default footprints;
- a snap to the backing wall (openings already have one: `lib/plan/geometry.ts:802-817`, `lib/plan/plan-rules.ts placeOpening`);
- a W/D/rotation inspector.

The garden `landscape` units (`lib/scene/garden-scene.ts:262-360`) are the only precedent: axis-aligned boxes from `spec` with defaults, and no rotation. Adding a bath means adding `bath` to `PLUMBING_TYPES`, `FIXTURE_META` and the catalogue.

## (d) Photos

**One active photo per room.** `room_photos` keeps every assignment as a row, but the latest by `created_at` is the one used (`app/api/render/route.ts:266-273`; studio rehydrates the same). `components/blueprint/renders/RoomPhoto.tsx` shows one photo per room. No path conditions a render on more than one photo of a room.

**H9 is merged** (#95, 052 on prod). RoomPhoto uploads as `project_asset` / photo:

- 25 MiB, png/jpg by magic bytes, client-compressed to ≤ 2048 px;
- `room_photo` (20 MiB) is only reached via `/api/room-photo`.

**Restyle inputs.** Photo + prompt + style moodboard image (+ taste seed). No scene or anchor — see (a).

### (d′) Style from the client's reference photos

**`TASTE_SEED_ENABLED` is real image conditioning plus text.**

- `loadTasteSeed` sends the first `TASTE_SEED_IMAGE_CAP = 3` moodboard items as **image inputs**, after the source photo and the style art. That is up to 5 images, on nano-banana only (other models see `images[0]`).
- It also sends a `References:` clause of descriptors ending "Do not copy their layout or furniture placement".
- It writes `renders.reference_refs`.
- It affects `/api/render` only.

**The garden preset** (`gardenPresetItems`) is per direction: two built-in `style` items seeded onto an EMPTY board by `/api/render/batch` for exterior-only projects. It is not per project. (No "T2 reference-image" code exists under that name.)

**Client references already work as the style source, per project.**

- References view uploads are `reference_image` assets.
- Moodboard `asset` items resolve to storage URLs.
- Those URLs feed the taste seed.

**Cheapest path to "in the style of these N photos":**

- **Working today:** flip `TASTE_SEED_ENABLED`, then put the client photos at the top of the project's References.
- **One-line change:** raise the cap above 3.

Its caveats:

- the built-in style art still goes in as image 2;
- the board is project-wide, not per room;
- the QA retry drops the references;
- **composition risk**: G4b and G5c measured a second image pulling composition (garden passes 10/13 → 4/13 with an anchor image), and nothing on the interior path checks placement.

**Recommended:** text-first.

1. A vision model writes each client photo's descriptor. The upload descriptor is the one LLM-writable field.
2. Send the `References:` clause with the image cap at 0 for bathrooms.
3. Allow image conditioning only once the B2 placement/presence gate exists.

## (e) Renders page

**K8 is merged; the Blueprint studio is live.**

- `app/project/[id]/render/page.tsx` → `components/blueprint/renders/RendersStudio.tsx` (+ `RoomPhoto.tsx`, `MaterialPalette.tsx`), framed by `ProjectShell` in the segment layout.
- The Atelier `RoomPhotoPanel` / `AssetPicker` are deleted.
- The route scan's `ATELIER_PENDING` is empty.

**B4 builds on `RendersStudio`.**

## (f) R10 step 0, dining room

**Skipped.** The bathroom replaces the dining room as the R10 test case. R10a (#108) already shipped the step-0 finding: the unchanged edit is not saved as a version, and dining has its own prompt type.

## Files B1–B4 will touch

**B1 — dimensions and ceiling**

- `app/api/draw-plan/route.ts` — an authored single-room path not tied to `GARDEN_PILOT_ENABLED`, or a bathroom-pilot gate; plot = room.
- `app/project/new/_components/villa-intake.tsx`, `app/project/new/page.tsx` — the Draw option.
- `app/project/[id]/plan/_components/editable-plan-viewer.tsx` — add a room from L × W; ceiling-height field; interior default type. *(#112 overlap)*
- `supabase/migrations/20260101006100_rooms_ceiling.sql` — `rooms.ceiling_h_m` nullable (null = default 2.9, derived).
- `lib/plan/derive.ts`, `lib/plan/geometry.ts` — read it; measured when stored. *(#112 overlap)*
- `app/api/update-plan/route.ts` (and/or `app/api/plan-zones/route.ts`) — accept it; survive plan saves like `in_scope`. *(#112 overlap)*
- `lib/boq/quantify.ts` — already reads h. A tiling-height rule only if the pilot rules one.
- `lib/boq/takeoff.ts`, `lib/boq/rules.ts` — the engine path's constants, if the engine must agree.
- Tests: `lib/plan/__tests__/*`, `lib/boq/__tests__/*` (wet tiling / plaster at a measured h; pricing goldens unchanged at null).

**B2 — fixtures and placement-preserving restyle**

- `lib/overlays/types.ts`, `lib/overlays/catalog.ts` — `bath` (+ meta / rate).
- `lib/overlays/seed.ts`, `lib/overlays/rules.ts` — `wall_id` + default footprint / rotation in `spec`.
- New `lib/overlays/massing.ts` — per-type footprint and wall snap.
- `app/api/plan-fixtures/route.ts` — spec validation for the new fields.
- `app/project/[id]/plan/_components/overlay-editor.tsx` — W/D/rotation inspector, snap to wall. *(#112 overlap)*
- `lib/overlays/boq.ts` — bath line.
- **Route 1 (interior scene):**
  - `lib/scene/interior-scene.ts` (new);
  - `lib/scene/mesh.ts`, `textures.ts` — wall tile, ceiling, sanitaryware, glass, mirror;
  - `lib/scene/raster.ts` — no sky, interior light;
  - `lib/render/cameras.ts` — add height / FOV and wire it in;
  - `lib/scene-render/pipeline.ts`, `gate.ts`, `prompts.ts`, `design-spec.ts`, `consistency.ts`;
  - `app/api/render/scene/route.ts`.
- **Route 2 (photo, cheaper):**
  - interior variant of `lib/scene-render/photo-pair.ts` / `photo-pair-run.ts` (manifest from the room's fixtures and openings);
  - `app/api/render/route.ts`, `app/api/render/status/route.ts`, `lib/render-qa.ts`.

**B3 — style from references**

- `lib/render-grounding.ts` — cap / text-only mode.
- `lib/moodboard/types.ts`, `lib/moodboard/load.ts`.
- `app/api/moodboard/route.ts` — vision-written descriptor for an uploaded reference.
- `components/blueprint/design/ReferencesView.tsx`.
- `app/api/render/route.ts`, `app/api/render/status/route.ts` — reference images vs the QA retry.

**B4 — renders page**

- `app/project/[id]/render/page.tsx`.
- `components/blueprint/renders/RendersStudio.tsx`, `RoomPhoto.tsx` — several photos per room, if wanted.
- `lib/render-batch/plan.ts`, `lib/render-batch/client.ts`, `lib/render-lock-progress.ts`.
- `lib/icons/subset.json` — any new icon name.

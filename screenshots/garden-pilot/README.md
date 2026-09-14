# Garden pilot G4 — verification record (2026-09-13)

Deliverable pack for the **Villa 94 garden (ground truth)** project
(`8d460645-…`, dev DB, non-production), generated live against a dev server
started with `GARDEN_PILOT_ENABLED=true DRAWINGS_ENABLED=true
TASTE_SEED_ENABLED=true KG_ENABLED=false` (Neo4j was down; KG off avoids a 10 s
timeout per render and does not touch garden prompts). `.env.local` unchanged.

## How these were made

| File | Source |
| --- | --- |
| `drawing-*.png` | Pages of the **full drawing-set PDF** (`/api/projects/:id/drawings?format=pdf&sheet=all`), opened and rasterised with **mupdf** — an independent reader, so a page that did not open would not be here |
| `pack-*.png` | Pages of the **render pack PDF** (`/api/projects/:id/render-pack`), same method |
| `ui-*.png` | Headless Microsoft Edge screenshots of the running app at 1440 px |

## What was checked

- **Drawing set**: 15 A3 pages (L-100 site plan, L-101…L-111 one per zone,
  L-201 finish schedule, L-401 lighting & electrical, L-402 irrigation &
  drainage). Opens clean in mupdf; every page 420 × 297 mm.
- **Dimensions to the mm**: `scripts/garden-dry-run-live.ts` compares every
  printed dimension on the live sheets with sheets built from the same records
  in memory — **96 dimensions on 14 sheets, all equal** — and
  `lib/drawings/__tests__/garden-sheets.test.ts` checks every zone edge against
  the graph's vertices, the pergola's printed 3500 × 3500, the counter/bench/
  planter runs (3000 · 3400 · 7500 · 7800) and the plot (12060 × 26640).
- **Lighting overlay** states *LIGHTING AS DESIGNED — NOT SURVEYED*; 37 points
  (9 boundary, 7 inground, 8 LED-strip points, 7 × 4.5 W and 6 × 8.5 W spikes);
  the cable route is labelled *derived, not designed*. **No HVAC** anywhere.
- **Derived area**: the backyard lawn carries its 1.8 m² elliptical-quarter
  approximation as a flag on the zone — `44.97*` on the site plan, the zone
  sheet, the pack's zone page and its materials schedule.
- **Batch render**: one click on *Generate all* rendered **22 views** (11 day +
  11 evening; every zone has lighting on the plan or is a structure) through
  the ordinary render routes, three at a time, **0 QA failures**. It seeded
  the empty moodboard with Desert Modern's garden + structure art first.
  A second press plans 0 jobs.
- **Render pack**: 14 A3 pages (cover, plan overview, 11 zone pages with day +
  evening, materials & finishes), all 22 images embedded, none missing. No
  price, rate, rate source or contractor name on any page.
- **Delta log**: `boq_outcomes.delta_lines` stores all 20 compared lines; PCC
  and paving install carry the tile-purchase corroboration as `direct`, grass
  supply and install as `indirect`.

## Honest findings

- **The first evening prompt did not work.** It asked for "early evening" and
  the edit model kept a daylight sky with sun shadows, adding only light pools.
  The prompt now asks for the daylight to be removed (sky, sun highlights, sun
  shadows, ~3 stops darker); the evening renders here are the second run.
- **Off-plan render fidelity is not G4's to claim.** The *Aluminium pergola*
  day view shows a paved courtyard with no pergola, and the *Backyard lawn* view
  reads as paving with grass joints. Both come from the G1b off-plan shell for a
  zone with no photo; the pack shows what the pipeline produced. Photo mode (a
  client photo of each zone) is the pilot path and is unaffected.
- **A save-route bug.** `/api/update-plan` re-shaped non-overlapping rooms on
  every save (1 mm snapping plus T-junction vertices from clipping); on the
  abutting garden this added vertices the zone sheets then dimensioned. Fixed in
  `lib/plan/save-repair.ts`; the live run now round-trips every polygon exactly.
- One render's image failed to fetch on one build (transient); the pack now
  retries and, if an image is still unavailable, says so on the page.

---

# G4b — plan-faithful renders, elevations, isolation (2026-09-14, in progress)

`g4b-*.png` are pages of the live drawing-set PDF (24 A3 pages), opened with
mupdf: the site plan with level tags and existing context, a zone sheet with its
+300 level, the seven sectional elevations (L-301…L-307) and the boundary
elevation strips (L-501). `g4b-isolation.json` is the isolation check's record.

**Status: committed without regenerating the render pack.** The Replicate
account ran out of credit (HTTP 402) mid-verification; after the top-up the
regeneration was deferred and G4b closed on fixes only. Drawings, levels, the
live dry-run (30/30, 244 printed figures incl. 28 vertical dimensions equal to
the graph) and the isolation check (15/15, both directions) are verified. The
gate table for the Villa 94 pack comes from a rerun of
`scripts/garden-isolation-check.ts`.

Fixes after the 402:

- **Evening light positions are gated.** The evening check now sees the night
  design model as a third image; a light where none was designed is a failure.
  Calibrated on the saved live pergola evening: it failed on the surface-mounted
  downlight on the rear boundary wall (major) and classed soft spill beside
  designed points as minor.
- **Infrastructure faults are not verdicts.** Attempts that never produced an
  image are thrown, not saved as a 3D-view substitution; an evening that shipped
  as the night view only because no day had passed is re-rendered once one has.
- **The render page says what shipped**: *Checked* or *3D view* per garden view.
- Interior identity re-checked against `99cdd55`: Mudon graph (bar additive
  null fields), as-built + demolition sheets, quantities and the priced BoQ across
  four styles are byte-identical (BoQ minus `generated_at`).

---

# G5 — client garden draft stage (2026-09-14, in progress)

Project **Arabella Garden — Draft for Review** (`ec4497c7-…`, dev DB). No client
personal name appears anywhere. The client photos stay under `data/` (gitignored);
no image in this folder contains them.

## Step 1 — done

`scripts/arabella-draft-plan.ts` drew the reference layout through the authored
routes in 20.8 s, 11/11 checks (`g5-step1.json`): plot 26.7 × 10.5 m and every zone,
run and context footprint flagged `dims_derived` with the type-plan source note;
4 zones (rear lawn 90.73, deck strip 22.05, side lawn 24.50, existing gazebo 12.25);
villa + garage/drive block as context; 17 existing items from the photos tagged
site reference, **none decided** (gazebo, stepping path, sink counter, 2 planter
borders, 2 string-light runs, 6 trees, 4 boundary walls); all 14 photos in the
asset library, unassigned. The plan is a draft on 17 derived boundary-critical
items.

- `g5-L-000-cover-draft.png` — the new drawing-set cover: draft statement, source
  note, sheet index, existing-on-site schedule (all undecided).
- `g5-L-100-site-plan-existing.png` — existing items dashed, trees with canopies,
  zone areas `≈`, "Derived dimensions" note, the draft stamp over the title block.
- `g5-L-501-boundary-elevations.png` — boundary strips with the house and walls.

## Step 2 — the design session (Abdallah)

Blocked on the design pass. Editor fixes landed first so it is not blocked by the
tool: Landscape layer, keep/remove/replace for every existing item, levels and
structure heights, plot-fitted canvases with 5 cm snapping, numeric zone
geometry, add/remove vertex, run and fixture inspectors, context drawn under every
layer, draft banner, pack readiness, friction log (plan page, under the plan).

Known limitations going in (candidates for the friction log if they bite):
- a run cannot be reshaped after drawing — delete and redraw;
- a zone outline is edited as a rectangle (X/Y/W/D) or by vertices — no
  click-to-draw polygon tool;
- irrigation zones are derived from planting beds and planter runs — there is no
  separate irrigation-zone element;
- context (house, garage, walls) is editable through `/api/plan-context` only —
  the Step 5 amendment will need a UI for it;
- on this narrow plot the scene cameras sit close (a rehearsal gazebo render was
  honestly substituted by its 3D view: the model pulled back and invented a house
  volume); expect a lower first-pass gate rate than Villa 94's.

## Rehearsal (scratch project, deleted afterwards)

A scratch copy of the reference layout with a simulated design pass ran the whole
Step 3 pipeline: `garden-draft-pack.ts --no-render` → **18/18** (readiness,
needs_selection empty, draft BoQ, 5 derived lines, source labels, three PDFs,
cover/L-3nn/L-401/L-402, watermark on 12/12 sheets + both covers + every BoQ page,
`≈ AED 46,800*`, BoQ page and plan page flags, zero identity leakage across 25
documents). Live: one scene render (substituted, stated) and one photo pair
(passed on attempt 2 — attempt 1 lost to an unparseable gate reply, since fixed:
nullable fields, a re-check of the same image before another render). The pack
carried the pair page and the design view. `g5-rehearsal-boq-pdf-p1.png` is that
rehearsal's BoQ PDF page 1 (rehearsal quantities, not the client design). The
scratch project was then deleted: 5 → 4 projects, its 20 storage objects removed,
client and Villa 94 row counts identical before and after.

## Isolation — Villa 94 ↔ client, documents only

`garden-isolation-check.ts --client ec4497c7-… --no-render-reference
--no-render-client` → **11/11** both directions (`g5-isolation.json`): BoQ, take-off
and drawings regenerated on each side; the other side's rows (incl. photo assets,
room photos, pilot events, corrections) and storage (incl. `plan-uploads`)
unchanged. Rerun with renders once the design is in.

## Still to do for the draft stage

After the design session: `garden-draft-pack.ts ec4497c7-…` (renders, 2–3 photo
pairs, gate table, metrics, Step-5 baseline), the isolation check with renders,
then the draft-stage commit.

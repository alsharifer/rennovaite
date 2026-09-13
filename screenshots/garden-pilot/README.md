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

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

# G5 — client garden draft stage (2026-09-14 → 16, draft packs ready for the review session)

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

## Step 2 — the baseline design, seeded as a PROPOSAL

`scripts/arabella-design-seed.ts` applied the design brief through the authored
routes (7/7, `g5-design-seed.json`): 4 → 10 zones, 6 → 8 runs, 6 → 26 fixtures.
Every zone, run and context footprint is still `dims_derived`; all 11 existing
zones/runs/walls keep their `site_reference` tag; the plan is still a draft; the
export gate passes legitimately (no untyped counter, nothing undecided, no
`needs_selection`). Every pilot event the seeding caused is `stage: design_seed`.

| Zone | Type | m² |
| --- | --- | --- |
| Rear planting bed | planting bed | 12.36 |
| Rear garden — lawn | artificial grass | 55.62 |
| Porcelain path — garden gate to side garden | path | 20.60 |
| Pergola court — porcelain paving | paving | 13.98 |
| Louvred pergola (replaces existing gazebo) | structure, 2.8 m | 12.25 |
| Side garden — porcelain paving terrace | paving | 16.12 |
| Side garden — lawn | artificial grass | 14.88 |
| Side garden — planting bed | planting bed | 3.72 |
| Front garden — lawn | artificial grass (assumed) | 6.40 |
| Front garden — planting bed | planting bed (assumed) | 2.40 |

Runs: BBQ counter 3.0 lm (bbq, 900 × 900) under the pergola, L-bench 4.0 lm.
Points: 6 spike + 6 inground garden lights, 6 boundary-wall lights, 2 drainage
points. Style direction: Desert Modern, proposed.

**Decisions** (the pack's Design assumptions page, `g5-design-assumptions-page.png`):
REPLACE gazebo → louvred pergola; sink counter → BBQ counter under the pergola;
stepping-stone path → porcelain paving (the side terrace and the rear path); both
string-light runs → designed lighting. REMOVE both planter borders. KEEP 6 trees
and 4 boundary walls.

**Friction log** (9 entries, pilot data): no style locked (renders need one);
no front-garden footprint in the dimension set (assumed, garage block reshaped via
API — no context editor); no gate element on a boundary wall; no pergola variant
field; replace-by-a-different-element had no representation (added
`spec.replaced_by`, API only); PATCH replaces spec wholesale; counter default
section is not a BBQ counter's; irrigation has no drawn zones; one run replaced by
two elements has one `replaced_by` text.

## Rehearsal (scratch project, deleted afterwards)

Before the design, a scratch copy of the reference layout ran the whole pack
pipeline (18/18 with `--no-render`, one live render, one photo pair).
`g5-rehearsal-boq-pdf-p1.png` is that rehearsal's BoQ PDF page 1 (rehearsal
quantities, not the client design). The scratch project was deleted; client and
reference row counts were identical before and after.

## The client draft pack (paid run) — 20/20

`garden-draft-pack.ts ec4497c7-…` → drawing set (19 sheets), render pack (19
pages), BoQ PDF (2 pages) in `data/garden pilot/g5-draft-pack/` (gitignored).
Watermark on all 19 sheets, both covers and every BoQ page; `≈ AED 116,900*`;
zero contractor-identity leakage across 42 documents; no internal sales language.

**Mix**: 3 before/after photo pairs (one per zone photographed — the side-garden
zones on their second photo), 1 styled render (rear lawn), 15 3D design views by
choice (no clean camera: 0.6 m beds, the 1.0 m path, the side garden against the
house, the front garden), 5 3D design views after a failed gate. The cover leads
with the side-terrace pair.

What the run found and fixed (each cost a re-render, none tuned away):
- the pair gate went "unavailable" because a reply named the extra-structure
  field `what`; lenient schema + a withheld pair with no verdict is never cached;
- the stepping path's replacement named only the 1.0 m path, so the gate rightly
  rejected the side terrace in a side-garden photo;
- a shade-sail pergola passed as "a pergola" and became the cover — the gate now
  checks a *louvred* pergola;
- a render that dropped all six kept trees passed — kept trees are on the gate's
  list (species named), which needed the scene loader to read the fixtures'
  site-reference columns at all (a removed tree would otherwise have been drawn);
- the seeded pergola note said "the upsell conversation" on a client page —
  reworded, and asserted against.

The stricter gate is why the final mix has 1 styled render where an earlier,
laxer run had 4; the pergola and court now ship as design views.

**BoQ**: AED 116,942.01 (printed `≈ AED 116,900*`), 15 lines, 9 derived. Top 5:
irrigation allowance 1.6 lump × 11,000 = 17,600 · louvred pergola 12.25 m² ×
1,366.69 = 16,742 · BBQ counter 3 lm × 5,280 = 15,840 · porcelain tile supply
62.95 m² × 128.10 = 8,064 · PCC base 62.95 m² × 105.60 = 6,648. Planting beds carry
no supply line (no reference rate) — they only size the irrigation band.

## The reference pack — 9/9

`garden-reference-pack.ts` → the completed reference garden as
**Contemporary Villa Garden — Completed Renovation** (display name, migration
038): render pack (18 pages) and drawing set; no BoQ (negotiated prices). No
"ground truth", no house number, no contractor identity, no price, no draft
watermark, no assumptions page. Mix: 8 styled renders, 17 design views by
choice, 4 after a failed gate. Cover: `g5-reference-pack-cover.png`.

## Isolation — with renders, both directions — 16/16

`garden-isolation-check.ts --client ec4497c7-… --out g5-isolation`: regenerating
the reference pack leaves the client's 312 rows and 228 storage objects unchanged;
regenerating the client's leaves the reference's 155 rows and 254 objects
unchanged; every render row, manifest, photo pair, sheet and BoQ ref resolves to
its own project; 30 vs 91 cache keys, 0 shared.

## Next

The review session with the client (Step 5 amendment to measured dimensions, then
`garden-change-report.ts`).

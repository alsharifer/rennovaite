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

# G5c — the review defects, fixed at the root (2026-09-16 → 17)

Abdallah and a Claude review went through the G5 pack. Everything below is a
defect they found, fixed where it was wrong.

## A. Geometry

- **The plan was mirrored.** The developer type plan depicts this unit's handed
  twin. The photos settle it: walking in from the front passage (WA0084–0086) the
  villa is on the LEFT and the rear walls trees on the RIGHT (WA0077, WA0082),
  which the type-plan frame reverses. Facing the villa the site reads: entrance
  and path RIGHT, rear strip, pergola corner, side garden LEFT.
  `garden-mirror-plan.ts` applied ONE reflection through the editing routes
  (5/5 checks, `g5c-mirror.json`): every polygon stored exactly as its
  reflection, and the BoQ byte-identical across it — AED 116,942.01, 15 lines,
  28 take-off rows, before and after.
- **The separator wall and its gate** are modelled (migration 039: a gate is an
  opening that names its context wall). The existing shed is on the plan too,
  with the default decision KEEP. Kept items add no demolition and no new work,
  so none of them moved the BoQ.
- **Scene = graph, proven.** The pergola was reported mid-pathway in the 3D; the
  scene had always read the same coordinates (x 23.2–26.7 in both). The misread
  came from an oblique eye-level camera down a 4 m strip, where the far rear wall
  itself projects to mid-frame. `scene-graph-parity.test.ts` now pins it for
  both gardens: structure centres equal plan centres to the millimetre, and the
  pixel at each structure's projected centre is that structure.

## B. BoQ

Planting beds now carry a soil-preparation and planting line (GL-25, 18.48 m²,
QS-to-price — they were measured for irrigation and never priced); two outdoor
taps are on the plan, on the irrigation overlay and in the BoQ under Plumbing
(GL-26); irrigation is ONE allowance line at quantity 1, AED 17,600, with the
band explained in the note. Total unchanged at AED 116,942.01 — the taps and
planting lines are QS-to-price at 0 until the QS rates them.

## C. Renders

The flat low-poly pages are gone. The conditioning image is now TEXTURED (the
walkthrough's finish recipes ported to the server rasteriser: tile joints at the
1200 × 600 the BoQ prices, grass, mulch, foliage, louvre blades, world-planar
UVs, sun shadows), cameras stay inside the plot, structures are shot from back,
the neighbourhood is modelled beyond the walls, and an aerial view was added.

Client pack mix: **15 styled renders, 2 before/after pairs, 8 design views**
(mostly evenings), 0 missing — against G5's 1 styled render and 20 design views.
22/22 checks. Cross-view consistency: every passed view consistent with the
anchor (the pergola court).

**A measured rejection.** Conditioning each view on the anchor IMAGE as well as
the shared specification text was tried and dropped: it moved the pass rate from
10/13 to 4/13 (a second image pulls composition, as the G4b style-image
calibration found). The shared reference is the deterministic design
specification; the consistency gate enforces the rest.

## D. Parity gate

New and permanent, on every pack export: every BoQ line maps to an element
visible on ≥ 1 drawing sheet AND in ≥ 1 view; every drawn element with a cost
impact maps to a line; lumps and absorbed items are exempt with the reason. It
caught the L-bench (priced, drawn, in no view) and the 6 boundary wall lights,
whose fittings sat inside the wall geometry where no camera could see them.
Both packs now report PARITY CLEAN.

## The reference pack — 11/11

**Contemporary Villa Garden — Completed Renovation** (the display name; the
working name never reaches a page): 18 styled renders, 11 design views, 0
missing, parity clean, no "ground truth", no house number, no identity, no price,
no draft watermark.

**The consistency gate found a flaw in my own specification first.** Three
accurate views were failed for "planting palette" because the spec said "beds
are level with the paving, not raised planters" — true of the client garden,
false of the reference garden, which has planter runs and planter boxes. A
fourth was failed for a second pergola that is really the villa's existing
timber-slat one. The spec now describes raised planters and existing structures
where the plan has them (the client garden's text is unchanged, so its renders
were not re-run). After the fix one view was still inconsistent — a pergola
roofed in timber battens instead of bronze louvres — and the pack demoted it to
a design view, which is the gate working.

## Isolation — with renders, both directions — 16/16

Regenerating the reference pack leaves the client's 456 rows and 401 storage
objects untouched; regenerating the client's leaves the reference's 229 rows and
498 objects untouched. Every render row, manifest, photo pair, sheet and BoQ ref
resolves to its own project; 86 vs 130 cache keys, 0 shared.

# G5d — the Newspace design session, applied (2026-09-19)

`scripts/arabella-session-apply.ts` reads `Arabella_Session_Capture.xlsx` (parsed,
never retyped; 19/19 checks) and applies it in stages, regenerating the BoQ after
each so every movement has one cause (`g5d-session.json`).

## Reconciliation (type-plan frame; the site is its mirror)

| Zone | Draft | Point measures | Aggregate refit | Driver |
| --- | --- | --- | --- | --- |
| Porcelain path (measured) | 20.60 × 1.00 = 20.60 | 12.20 × 1.00 = 12.20 | 12.20 | dimension update |
| Garden entrance area (new) | — | 4.65 | 5.85 × 2.54 (less landing) = 13.30 | dimension → aggregate |
| Door landing (new, measured) | — | 1.20 × 1.30 = 1.56 | 1.56 | dimension update |
| Rear lawn | 55.62 | 48.38 | 12.20 × 2.70 = 32.94 | dimension → aggregate |
| Rear planting bed | 12.36 | 10.83 | 17.62 | dimension → aggregate |
| Pergola court | 13.98 | 13.98 | 13.98 | unchanged (6.0 m measure confirms) |
| Pergola / side terrace / side lawn / side bed | 12.25 / 16.12 / 14.88 / 3.72 | same | same | unchanged |
| Front lawn | 6.40 | 18.80 | 0.93 × 2.34 = 2.18 | dimension → aggregate |
| Front planting bed | 2.40 | 2.40 | 19.02 | aggregate refit |
| **Grass / tiled / planting** | 76.90 / 62.95 / 18.48 | 82.06 / 60.76 / 16.95 | **50.00 / 69.41** / 40.36 | aggregates ≈ 50 / ≈ 69.4 |

2.35 m of the (derived) 26.7 m plot at the garage end is UNALLOCATED — the
measured runs do not reach it. The plot is unmeasured, so the DRAFT stays.

## Change report — AED 116,942.01 → 116,216.57 (−725.44, −0.62%)

fix +0 (posts, surroundings; GL-28 drainage 2 no. at rate 0 in a late fix stage)
· design decision +0 · dimension update −188.50 · aggregate refit −536.94 ·
correction +0 (the programme section). Top movers: grass install −1,893.76,
tile supply +827.52, grass supply −710.16, PCC +682.18, paving install +454.78.

## Session record (three-firms #1)

4 decisions (shed KEEP; pergola = the drawings; programme; nothing else raised)
and 3 corrections attributed to Newspace — confirm (estimate), scope (firm),
design (firm). No rate was corrected; none would touch the rate book.

## The client pack — 31/31

Pipeline g5d-2 (g5d-1 plus placement boxes normalised: about one gate reply in
eight gave PIXELS, clamped to 100% — 17 of 121 boxes failed correct renders as
"moved"; the gate now converts them with the image size). Day views: 11/15 passed
the gate, 1 (whole garden view 2 — the old p8) then demoted by the consistency
gate; evenings 7/12, the rest dropped from the pack with "lighting as designed,
see L-401". Every passed render checked built-feature placement. Anchor: the
pergola court. The p4 pair shows the BBQ counter under the new pergola; Z01 shows
the court render ("render from the Z02 view"). The aerial passes with the
entrance side open (only the rear edge carries a neighbour volume). Mix: 2 pairs,
16 styled renders, 11 design views. Parity clean including overlay counts
(lights 12/12, wall lights 6/6, taps 2/2, drainage 2/2).

## The reference pack — 14/14

Villa 94 under g5d-2: 8/15 day views passed (1 then inconsistent), 5 evenings;
parity clean (lights 28/28, wall lights 9/9). No price, no identity, no draft.

## Isolation — with renders, both directions — 16/16

624 client rows / 752 objects untouched by the reference pack; 291 reference rows
/ 742 objects untouched by the client pack; 144 vs 214 cache keys, 0 shared.

## Next

Newspace's written line-by-line review (rate corrections become market_fair records), the plot survey (the unallocated 2.35 m, the 1 m drive), then the client review — `garden-change-report.ts` for the receipt.

# Parse strategy — build-vs-buy decision spike (A1b)

_Decision spike, 2026-08-05. **No product code was changed.** Output is this
report + decision matrix. Abdallah decides the branch before S4 runs._

## TL;DR (one-line recommendation)

**Don't do a from-scratch in-house ML overhaul.** Split by input type: build a
bounded **deterministic vector path** for DWG / vector-PDF (exact geometry +
openings for free, data stays in-house), and **adapter-in a hosted raster→vector
provider behind a `PARSE_PROVIDER` flag** for raster/photo — but only after a
paid trial on ~10 real GCC plans confirms CubiCasa actually ingests *existing*
plan images (its productised API is scan-first), plus its latency and data
terms. Lifting the 4-point-rectangle contract and persisting **openings** is
shared S4 work either way.

---

## Step 1 — Our real input mix + failure taxonomy

### 1.1 Input inventory (live DB + storage, this pilot)

| Signal | Value | Note |
| --- | --- | --- |
| Projects | 5 | whole corpus to date |
| Plans (source docs) | 5, **100% PDF**, all parsed | `plans.pdf_url` ext = `{pdf:5}` |
| `plan-uploads` bucket files | 15 pdf · 4 jpg · 1 png | pdfs = plans; images = room photos/render sources |
| `project_assets` (new library) | empty | A3 catalogue not yet populated; **no DWG/MEP corpus yet** |
| Mudon parsed rooms | **13 / 13 are 4-point axis-aligned rectangles** | **0 non-rectilinear polygons** |

**Two findings that frame the whole decision:**

1. **The corpus is tiny and PDF-only.** We cannot fit a strategy to 5 plans —
   decide on the *target* distribution (homeowner-supplied developer PDFs +
   phone photos of printed plans + occasional DWG from a contractor), not this
   sample.
2. **We don't yet distinguish vector-PDF from raster-PDF.** Every plan is
   rasterised into the LLM regardless. When a PDF carries exact CAD vector
   geometry, **we are throwing that geometry away** and asking a vision model to
   re-estimate it — the worst of both worlds.

### 1.2 What the parser actually is

`app/api/parse-plan/route.ts` is **not** a CV pipeline. It is a single
**Claude Sonnet 4.6 vision call**: the plan image/PDF → a strict JSON of rooms.
There is no segmentation/polygonisation/room-splitting code we own — it is all
delegated to the model, and the model is **contractually constrained** by the
system prompt:

> "**FOUR [x, y] points approximating the room's bounding rectangle** … Axis-aligned
> is fine; we do not need true vertices … The polygon is a rough visualization
> hint, not a survey. Axis-aligned bounding rectangles are fine."

Downstream, `lib/plan/geometry.ts` **derives** walls from *shared polygon edges*
(200 mm default, `is_structural: null`) and **always returns `openings: []`**
("we never invent doors"). So walls are only as good as the polygons, and
openings do not exist anywhere in the system.

### 1.3 Failure taxonomy — where it breaks

The three classic stages map onto the LLM contract like this:

| Stage | Owned by | Status |
| --- | --- | --- |
| **Segmentation** (which pixels = which room) | the model | Usually OK on clean rectilinear plans; degrades on scanned/skewed/low-res/ hatched images and furniture clutter. **Not** the primary complaint. |
| **Polygonisation** (region → vertices) | **the prompt (hard cap: 4 axis-aligned pts)** | **Root cause.** Every room is a bounding rectangle by construction. Confirmed empirically: Mudon = 13/13 axis-aligned quads. |
| **Room-splitting / topology** (non-overlap + shared walls) | nothing — each room is an independent bbox | No non-overlap or shared-edge constraint → adjacent/L-shaped rooms **overlap** → derived walls misfire → "heavy manual correction." |

**Per test case** (traced through the actual contract; the Mudon 13/13 result
already proves the polygonisation cap empirically):

- **Mudon (mostly rectilinear):** segmentation + polygonisation succeed; failures
  are **topological** — squared-off nooks and bboxes that overlap at shared
  walls, which is exactly the manual-correction load in `EditablePlanViewer`.
- **L-shaped room:** the L is flattened to its **bounding rectangle**, which
  swallows the notch belonging to the neighbour → **polygonisation → room-split
  overlap**; area overstated. Cannot be fixed by prompt tuning while the output
  is 4 points.
- **Diagonal walls:** an axis-aligned bbox cannot represent a diagonal → the
  room rectangle includes triangular dead space, neighbours overlap in the gap,
  and derived walls are only ever H/V. Breaks at **polygonisation** (+ wall
  derivation).
- **Curved bay / rounded room:** no curve primitive in the contract → the bay is
  clipped to a straight bbox edge; area lost or overstated. Breaks at
  **polygonisation**.

**Conclusion of Step 1:** "rectilinear-only" and "overlapping rooms" are
**structural consequences of the 4-point-axis-aligned output contract**, not a
model-quality or prompt-tuning problem. No amount of in-house LLM tuning fixes
non-rectilinear geometry while the output is a bounding rectangle. Fixing it
in-house means (a) N-vertex polygons, (b) enforced non-overlap/topology, and
(c) real openings — i.e. rebuilding toward what a dedicated vectoriser already
does.

---

## Step 2 — Hosted options (paper evaluation + trial note)

> **Trial caveat (honest):** a live CubiCasa trial requires provisioning an API
> key and uploading real villa plans to a third party — account creation and
> sending client data out are the user's calls, not an agent's. So this is a
> **paper evaluation from public docs**; the numbers below (esp. image-ingest
> pricing, latency SLA, and the DPA) must be confirmed by a **paid trial on
> ~10 representative GCC plans + a call with Sales@CubiCasa.com** before any BUY
> commitment. CubiCasa gives the **first 2D plan free**, which is enough to smoke
> test image-ingest fit.

### 2.1 CubiCasa

- **What it is:** the market leader (2M+ orders), built on the **CubiCasa5K**
  raster→vector model — semantic polygons for **rooms, walls, and icons incl.
  doors + windows**, delivered as **SVG** (parseable with any XML lib) plus
  raster exports.
- **Critical fit risk:** the productised API/SDK is **scan-first** — embed the
  mobile scanning SDK, manage orders, render via the Exporter API. Their public
  surface is oriented to *fresh phone scans*, not batch vectorisation of an
  *existing* uploaded plan. The ML capability for image→vector clearly exists
  (that's what CubiCasa5K is), and marketing mentions generating plans from
  uploaded room photos, but **"POST an existing floor-plan JPG/PDF, get vector
  JSON back" is not a documented self-serve endpoint** — it needs sales
  confirmation. **This is the single biggest unknown of the spike.**
- **Output vs our PlanGraph:** strong super-set of what we have — their
  rooms→our `rooms`, their walls→our `walls` (replacing our *derived* walls with
  real ones), and **their doors/windows→our `openings`, which we currently
  cannot produce at all.** Mapping their SVG polygons into `derivePlanGraph` is a
  bounded adapter (normalise coords, map labels→our room-type tokens, convert
  wall polylines, translate icons→openings).
- **Accuracy:** MLS/GLA-grade area accuracy is their core selling point;
  CubiCasa5K reports strong room/wall/icon scores on their benchmark. Much better
  on non-rectilinear geometry than a 4-point bbox.
- **Cost:** pay-per-scan, first free; **Standard ≈ A$15 (~US$10)**, Plus A$30,
  Plus 3D A$99. Image-redraw pricing is **not public → confirm with sales**.
- **Latency:** the productised path historically includes **human QA** →
  minutes-to-hours (3D quoted at 48 h). That does **not** fit a synchronous
  "Analyze my villa" screen; a BUY path must be **async** ("we'll notify you when
  the plan's ready"). Confirm the pure-ML SLA.
- **Terms / data / GCC:** CubiCasa OY is **Finnish (EU/GDPR)**; plans are
  processed on their cloud (EU/US). Uploading GCC clients' villa plans (which
  carry owner names/addresses in title blocks) off-region needs a **DPA + client
  consent + a PII stance**. Confirm data-retention / training-use terms in
  writing.

### 2.2 Alternatives (noted, not primary)

| Option | Ingests existing raster plan? | Output | Fit |
| --- | --- | --- | --- |
| **Archilogic** | Yes (plan → semantic 2D/3D, API) | rooms/walls/openings, 3D | Closest "upload plan → structured geometry via API" alt; enterprise pricing. Worth a parallel quote. |
| **Self-host CubiCasa5K / raster-to-vector models** (Liu et al., FloorplanTransformation) | Yes (self-run ML) | rooms/walls/icons | This **is** the "train/host in-house" branch the Blueprint warned about — GPU, dataset licence (CubiCasa5K is research-only), MLOps. High effort. |
| Mobile-scan players (magicplan, Matterport, Roomvo) | No — live capture | plans/3D | Wrong modality (we have existing plans, not on-site scans). |
| Restb.ai / generic real-estate CV | Partial (tagging, not full vector topology) | labels | Not a topology/vector engine. |

---

## Step 3 — Recommendation, cost, privacy, S4 scope

### 3.1 Per-input-type recommendation

| Input type | Recommendation | Why |
| --- | --- | --- |
| **DWG / DXF** | **In-house deterministic** (parse entities → polygons/walls/openings) | Geometry is exact + machine-readable; ML is strictly worse and unnecessary; data stays local. Bounded build, not "train from scratch." |
| **Vector PDF** | **In-house deterministic** (extract vector paths + text) | Same — exact geometry we currently rasterise away. Detect "has a vector layer" and route here. |
| **Raster PDF / photo of a printed plan** | **Hosted adapter behind `PARSE_PROVIDER`** (CubiCasa primary, pending trial) | This is the genuinely hard case the Blueprint meant — training a raster→vector model from scratch is the expensive path we should avoid. Buy it; **openings come free**. |
| **Any (fallback)** | Keep the current LLM-vision path as the flagged fallback | Zero-dependency degrade if the provider is down / a plan is ineligible / consent withheld. |

### 3.2 Decision matrix

| Criterion | In-house LLM (today) | In-house **deterministic vector** | In-house **self-host ML** (raster) | **Hosted CubiCasa** (raster) |
| --- | --- | --- | --- | --- |
| Non-rectilinear fidelity | ✗ (4-pt bbox) | ✓✓ (exact) | ✓ (model-dependent) | ✓✓ |
| Overlaps / topology | ✗ | ✓✓ | ~ | ✓ |
| **Openings (doors/windows)** | ✗ none | ✓ (from vector) | ✓ | ✓✓ (native) |
| Vector-PDF / DWG | ✗ (wasted) | ✓✓ | n/a | n/a |
| Raster / photo | ~ (poor) | ✗ | ✓ | ✓✓ |
| Cost / parse | ~$0.02–0.05 | ~$0 | infra $$ amortised | ~US$10 (confirm) |
| Latency | ~30–60 s | seconds | seconds–min | **min–hours (async)** |
| Data privacy / GCC | in-house | **in-house** | in-house | **off-region → DPA** |
| Eng effort | (built) | **medium, bounded** | **high** (GPU/data/MLOps) | medium (adapter + async + flag) |
| Ongoing maintenance | low | low | high | low (vendor-run) |

### 3.3 Cost per parse — pilot vs 1,000 projects

Assume the target mix is ~**60% vector (PDF/DWG) → in-house ($0)** and ~**40%
raster/photo → hosted (~US$10)**.

| Scale | All-in-house LLM (today) | Recommended split | All-raster-to-CubiCasa |
| --- | --- | --- | --- |
| Pilot (~20 parses) | ~$1 | ~$80 (≈8 raster × $10) | ~$200 |
| 1,000 projects | ~$30 | **~$4,000** (≈400 raster × $10) | ~$10,000 |

The split roughly **halves** the buy cost vs sending everything to the API,
*and* gives higher fidelity on the vector majority — because most homeowner/
developer plans are vector PDFs where hosted ML is both unnecessary and a
needless data-export. (All figures indicative; confirm CubiCasa image-redraw
pricing with sales.)

### 3.4 Data-privacy notes

- In-house vector path keeps client plans **on our infrastructure** — the
  privacy-safe default, and it covers the majority case.
- Any hosted branch exports **client villa plans with PII in title blocks** to an
  EU/US processor → requires a **signed DPA, explicit client consent at intake,
  a documented retention/no-training clause, and ideally title-block redaction
  before upload.** Gate the raster branch on this, not just on accuracy.

### 3.5 Proposed S4 scope per branch

**Shared prerequisite (either branch):** lift the 4-point-axis-aligned contract
to **N-vertex polygons**, add **openings** persistence (new `plan_openings` +
`plan_walls` or extend `parsed_json`), and teach `derivePlanGraph` to consume
real walls/openings instead of deriving them. This is the actual product unlock
and is independent of build-vs-buy.

- **Branch BUY-RASTER (recommended):** (1) input-type router (vector-PDF/DWG vs
  raster); (2) deterministic vector extractor MVP (vector paths/entities →
  rooms/walls/openings); (3) `PARSE_PROVIDER` flag + CubiCasa adapter mapping
  SVG→PlanGraph incl. openings, **async** delivery + consent/DPA gate;
  (4) schema + `derivePlanGraph` upgrade above; (5) keep LLM path as fallback.
- **Branch BUILD-ALL-IN-HOUSE:** (1) + (2) + (4) as above, **plus** train/host a
  raster→vector model (dataset licensing, GPU, eval harness, MLOps). Larger,
  slower, higher-risk; only justified if data-residency forbids any hosted
  processing **and** raster volume is high.
- **Branch DO-NOTHING / tune-LLM:** rejected — cannot fix non-rectilinear
  geometry (structural cap) or produce openings; only reduces some overlap noise.

---

## Recommendation

**Buy the hard part, build the easy-and-private part:** deterministic in-house
parsing for DWG/vector-PDF (fixes most of the corpus, keeps data local, yields
openings for free) + a flagged hosted raster→vector adapter (CubiCasa, pending a
paid trial on real GCC plans + DPA) for raster/photo — not a from-scratch
in-house ML overhaul.

---

## Sources

- [CubiCasa — APIs for Software Developers](https://www.cubi.casa/developers/)
- [CubiCasa Integrate API docs](https://integrate.docs.cubi.casa/get-started-1362307m0)
- [CubiCasa pricing packages](https://www.cubi.casa/pricing/)
- [CubiCasa pricing overview (Tekpon)](https://tekpon.com/software/cubicasa/pricing/)
- [CubiCasa5K: dataset + multi-task floorplan model (paper)](https://www.researchgate.net/publication/333230440_CubiCasa5K_A_Dataset_and_an_Improved_Multi-task_Model_for_Floorplan_Image_Analysis)
- [CubiCasa hosted floor plans](https://www.cubi.casa/hosted-floor-plans/)
- Internal: `app/api/parse-plan/route.ts` (LLM parse contract), `lib/plan/geometry.ts` (derived walls, empty openings), live DB inventory (5 plans/PDF; Mudon 13/13 axis-aligned).

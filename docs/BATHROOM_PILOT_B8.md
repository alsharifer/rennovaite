# Bathroom pilot B8 — render experiment B2c (report, 19 Oct 2026)

Dev test project `a2661f34` (the pilot bathroom, rev 14: a white storage
cabinet in place of the bidet, one fixed glass panel, the room anchored on
Photo 2 v13). Images and raw results are in `data/Bathroom Pilot/b8-eval/`
(gitignored: client photos). Scripts: `scripts/b8-check-noise.ts` (step 0–1),
`scripts/b8-render-experiment.ts` (steps 2–3, `--publish`).

## Decision

**No arm clears 4/5.** Both checks (layout and style or follows), two attempts
per arm:

| arm | both | layout |
|---|---|---|
| baseline | **2/5** | 2/5 |
| finish-only references | 0/5 | 2/5 |
| structure-conditioned | 0/5 | 0/5 |

The measured ceiling with today's models is **≈ 40 %**, not the 60 % the brief
allowed for. So:

- **Default pipeline stays the baseline:**
  - nano-banana-pro, frame-pinned;
  - the anchor's own view renders from the client's whole-room references;
  - every other view renders against the anchor's image and spec.

  Finish-only references held the layout no better and broke the "one design
  across views" rule. The structure arm drew a different room.
- **The product:** default to the views that passed, show an honest failure for
  the rest, show the re-render cost (the studio's cost guard already does), and
  the designer picks.
- **The pack carries the views that pass both checks, not all five.**
  - The others are named on the room page with the reason; they get no
    placeholder page.
  - The pilot pack now carries **2 views: Photo 2 (the anchor) and Photo 5.**
  - Photo 4 passes the follows check at 0.75 but not the pack's
    every-element-matches rule (WC, fittings and palette read "partly"), so it
    stays out.
  - Photos 1 and 3 have no render of the current design that passes.
- **Default view count: the views that pass — expect 2–3 of 5.**
  - "Render remaining" still renders every positioned, unlocked view, with the
    cost shown first.
  - Re-rendering a failed view costs ≈ US$0.15 per attempt plus about US$0.10
    of readings.

## Step 0 — the four held-back B7 renders, re-scored

Each was judged under the corrected check (below). No new renders.

| view | B7 check | corrected check | in the pack? |
|---|---|---|---|
| P1 | added a window, added a shower glass | added a shower glass | no |
| P3 | resized the WC and the vanity | WC 33 % taller, vanity +97 % | no |
| P4 | resized the WC (−) | **layout ✓, finishes follow 0.75 ✓** | follows ✓, but the pack rule wants every element "same" — no |
| P5 | added a WC | added a WC | no |

P4's gate was re-scored in place (`gate.rescored` records the old verdict).

## Step 1 — the check's own noise, measured

- **The sample:** 24 images, each read twice — the five photos (against both
  designs), B2b's five pro views, B2's five nano-banana R5 views and B7's four.
- **The pairs:** 68 items were seen in both readings. One image needed a third
  reading (the two disagreed on presence or count).

| between two single readings of one image | p50 | p90 | p95 | max |
|---|---|---|---|---|
| box area | ×1.03 | ×1.16 | **×1.40** | ×1.63 |
| box height | ×1.03 | ×1.12 | **×1.27** | ×1.55 |
| top as a share of floor-to-ceiling | 0.03 | 0.05 | **0.10** | 0.10 |
| centre, % of frame | 0.5 | 3.0 | 7.0 | 9.5 |

**The check now:** `CHECK_VERSION` c3, `photo-check.ts` + `photo-check-vocab.ts`.

- **Every image is read twice** (`detectAgreed`): a third reading when the two
  disagree on presence or count. The agreed reading takes the majority on
  presence and count, and averages the boxes.
- **Tolerances come from the measured noise.** Two agreed readings of an
  unchanged item differ by one single reading's noise, i.e. the single-pair p95
  ÷ √2.
  - **Size: ×1.27** either way. It is symmetric in log terms (B2b's linear ±25 %
    was asymmetric and sat inside a single reading's noise).
  - **Height: ×1.19** — new. A fixture can keep its area and grow tall.
  - **Stated height ±0.10 of floor-to-ceiling** — new, for an item whose plan
    states its height. A replacement's size is free; its height is not.
    - The reading gains `top`: how high the item reaches on the wall behind it.
    - The cabinet's 1,200 mm on a 2,800 mm ceiling = 0.43.
    - The wider single-reading band is kept, because the stated value carries
      the reader's bias, which two readings of one image cannot measure.
    - This is the rule B7's 2 m cabinet slipped through. In this run it caught
      cabinets drawn about 1.9, 2.0, 2.2 and 2.4 m tall.
- **Cost:** a reading costs ≈ US$0.03 and an image now takes two. The studio's
  per-view estimate moves from US$0.065 to US$0.09 of checks per attempt.

### The B2b table, restated under the corrected check

The final attempt of each view; the earlier attempts' model URLs had expired.

| pipeline | layout | style | **both** | attempts |
|---|---|---|---|---|
| nano-banana-pro, frame-pinned + references | 2/5 (P1, P5) | 2/2 | **2/5** — was 3/5 | 2 |
| nano-banana + references (R5) | 2/5 (P4, P5) | 1/2 | **1/5** — was 2/5 | 1 |

- **Pro P4 now fails:** the shower glass is +30 %, against ×1.27; a single
  reading had passed it.
- **P2 and P3 fail as before:** the WC moved, the vanity grew +77 % to +246 %.
- **R5:** P1 shrank the door and the WC; P2 grew the vanity +147 %; P3 grew the
  WC +47 %.
- **First attempts:** they tied at 2/5 in B2b; under the corrected check the B2b
  first attempts cannot be re-read (expired).

## Steps 2–3 — the experiment

The current design, all five photos, the same check, and **two attempts per arm
including the baseline**.

- **P2 is the anchor:** every arm rendered it from the client's references
  without replacing the locked version.
- **P1, P3, P4 and P5 follow the anchor:** their style check is the follows
  check beside it.

| arm | P1 | P2 | P3 | P4 | P5 | both | renders | US$ |
|---|---|---|---|---|---|---|---|---|
| **baseline** — pro, whole-room refs (P2) / anchor image (others) | ✗ | ✗ | ✗ | ✓ 0.75 | ✓ 0.90 | **2/5** | 5 new + 3 B7 | 1.72 |
| **finish** — pro, 4 finish close-ups | ✗ | ✗ | ✗ | layout ✓, follows 0.67 | layout ✓, follows 0.70 | 0/5 | 9 | 2.32 |
| **structure** — flux-canny-pro, texture-suppressed control | ✗ | ✗ | ✗ | ✗ | ✗ | 0/5 | 10 | 1.13 |

### Baseline

Attempt 1 of P1, P3, P4 and P5 is B7's render of the same pipeline, re-scored.
Attempt 2 is new where needed.

**Failures:**
- P1 added a second door and a second WC.
- P2 shrank the WC −55 %, moved the vanity and drew the cabinet ≈ 1.9 m tall.
- P3 grew the WC +38 % and the vanity +211 %.

P5's attempt 2 passed both and is published as a studio version
(`gate.pipeline` "b8-baseline"); it is in the pack.

### Finish-only references

The four crops are a travertine-look tile, an oak vanity front with a stone
top, a tap and mixer, and a backlit mirror's edge. They were cut from the
client's references by hand, with no room in them (`b8-eval/finish-refs/`).

**The hypothesis — "pro copies the layout from whole-room references" — is not
supported.**
- With no layout to copy, pro still grew the vanity +139 % to +483 %, drew the
  cabinet 2.0–2.4 m tall and moved the door and the WC.
- The growth follows the prompt's "floating vanity", not the reference image.

P4 and P5 held the layout, but their finishes drifted from the anchor (walls,
shower screen, palette). A close-up of the client's references is not the
anchor's own tile.

### Structure-conditioned

`structureControl`: the photo median-filtered at an eighth of its width, so
grout, tile joints and the frosted stripes go and the room's edges stay;
flux-canny-pro then renders from it. The prompt carries the look in words — the
model takes no images.

The control was too weak for the layout. The model drew a different room:
- moved the door and the window;
- added a window in the shower (P5);
- grew a vanity into P2 (+626 %).

The raw photo as control kept the old finishes in B2 (style 0/5), and the
smoothed one loses the layout. Neither reaches both.

## Pack

Re-exported with `scripts/b6-room-pack-check.ts 3096`: all checks pass.
`screenshots/bathroom-pilot/b6/pack/room-pack.pdf` (gitignored), 14 pages.

- **Pages:** cover → room + photos → 2 views → 5 drawings → materials → BoQ ×2
  → price → programme.
- **The cover** says "2 of 5 views from your photos in this pack".
- **The room page** names P1, P3 and P4 with why. It adds: "This pack carries
  only the views that passed both checks … A render that moves, resizes or adds
  a fixture is never shown."
- **A view is a candidate** only when its finishes were judged and passed
  (`room-pack-pdf.ts`).
- **The export's check** counts the views left out.

## Spend

US$6.85 for B8, against the brief's ≈ US$3:

| item | US$ |
|---|---|
| 24 renders — 14 pro, 10 canny | 2.60 |
| readings | 4.25 |

Reading every image twice (two images per after-reading) is most of the
overrun. The project total is US$25.19.

## Not done / next

- **The vanity is the repeat offender in every arm.**
  - Next to try: state its size in the prompt (870 × 540 mm, from the plan).
  - Or edit fixture by fixture with a mask, so the model cannot touch the rest
    of the frame.
- **Finish close-ups cut from the anchor itself** (its tile, its vanity, its
  mirror) would remove the consistency confound in the finish arm. Not run, to
  stay near the budget.
- **The follows check (≥ 0.75) and the pack's consistency rule (every element
  "same") disagree on P4.** One of them should change — a ruling, not done here.

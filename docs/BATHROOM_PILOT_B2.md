# Bathroom pilot B2 — photo views that keep the layout (report, 18 Oct 2026)

Dev test project `a2661f34` (B1's bathroom, the room sheet's 266 × 263 × 280),
the client's five photos placed at the sheet's §4 cameras. Images and the raw
results are in `data/Bathroom Pilot/b2-eval/` (gitignored — client photos);
this file has the numbers.

## Decision

**Photo views restyle with `google/nano-banana` (the edit path), prompted per
view, held by the placement check.** `PHOTO_VIEW_ARM = "edit"`
(`lib/render/photo-restyle.ts`).

On the final prompt and check (rounds 3 and 4, ten renders of the five photos):

| | layout check | style check | both |
|---|---|---|---|
| edit — nano-banana (chosen) | **9 / 10** | **8 / 10** | **7 / 10** |
| canny — flux-canny-pro | 4 / 5 | 0 / 5 | 0 / 5 |
| kontext — flux-kontext-pro | 4 / 5 | 0 / 5 | 0 / 5 |
| edit_pro — nano-banana-pro | 2 / 5 | 5 / 5 | 2 / 5 |
| depth — flux-depth-pro | 1 / 5 | 1 / 5 | 0 / 5 |

(after the one re-render the loop allows; "style" = the rendered view scores
≥ 0.75 against the brief's elements it shows.)

**Cost per photo view: ≈ US$0.08–0.10 (≈ AED 0.30–0.35)** — one nano-banana
image US$0.039, the after-reading of the check ≈ US$0.02, the style check
≈ US$0.015, and a re-render on one view in five. The before-reading is once per
photo (≈ US$0.02) and kept. Every call is a `render_spend` row (model, size,
cost); the studio shows the project's total.

**Neither conditioned path (depth / canny) won.** They were asked for as the
structural constraint; measured, they constrain the wrong thing:

- **canny** follows the photo's edges — so it keeps the layout *and the old
  finishes* that make those edges: the frosted striped glass, the tile grid,
  a terracotta floor, the mosaic border. Layout 4/5, style 0/5.
- **depth** keeps the room's volume but invents detail where depth is flat:
  a wooden door on the shower wall (P3), a second WC (P1), lettering printed
  on the shower glass. Layout 1/5.
- **kontext** (an edit model that changes locally) behaves like canny: layout
  kept, finishes not changed. Style 0/5.
- **nano-banana-pro** follows the brief best (style 5/5) but snaps the frame
  to 9:16 (1536 × 2752) — a re-framed photo moves every fixture. Layout 2/5,
  at 4× the price.

What made the edit path hold the layout was not the model but the **prompt
built from the check**: pass rate went 2/5 → 4–5/5 when each view's prompt
(1) lists the fixtures the photo shows with where they are in the frame,
(2) names the ones it does NOT show ("This photo shows no vanity — do not add
any"), and (3) describes only the finishes of what the view shows — the full
brief describes a vanity and a mirror, and a model painted them into the view
of the window wall (P4: the laundry trolley became a floating vanity).

## Method

- **The placement check** (`lib/render/photo-check.ts`, the garden pair gate's
  shape): the candidates are the room's door, window and sanitary fixtures from
  the plan; a vision model (`claude-opus-5-5`, structured JSON output) reads where
  each is in the before photo — box in % of the frame, copies — once per photo,
  kept on `room_photos.before_detection`; the after image is read *beside the
  before photo and its boxes* (the same physical items, even redesigned). The
  pass rule is pure code (`judgePhotoPlacement`): every item the photo shows is
  in the render, its centre within max(12% of the frame, 60% of its extent),
  not duplicated, not swapped left/right; nothing the photo does not have is
  added. One re-render with the findings as instructions, then the honest
  failure: "The render moved the vanity — see what differs."
- **The style check** (`checkStyle`): the render against each element of the
  brief the view shows — yes / partly / no — score ≥ 0.75 passes; the line is
  "Style follows your references ✓" or names the elements that do not.
- **Rounds.** R1: first prompt, check v1. R2: + the absent-fixture line and
  reason-specific retries; + nano-banana-pro and kontext arms. R3: + check v2
  (sharper item descriptions — the room door is never the shower's glass door;
  the after image read beside the before photo) and per-view style. R4: the
  chosen arm again (variance) + the reference-image test.

### All rounds (layout check after the retry; style re-scored on every final image)

| round · arm | layout | first try | style | both | renders | cost US$ |
|---|---|---|---|---|---|---|
| R1 edit | 2/5 | 2/5 | — | — | 8 | 0.47 |
| R1 depth | 1/5 | 1/5 | — | — | 9 | 0.65 |
| R1 canny | 2/5 | 1/5 | — | — | 9 | 0.67 |
| R2 edit | 2/5 | 2/5 | 2/5 | 0/5 | 8 | 0.45 |
| R2 edit_pro | 3/5 | 0/5 | 5/5 | 3/5 | 10 | 1.82 |
| R2 kontext | 1/5 | 1/5 | 0/5 | 0/5 | 9 | 0.54 |
| R2 depth | 1/5 | 1/5 | 1/4 | 0/4 | 9 | 0.53 |
| R2 canny | 3/5 | 3/5 | 0/5 | 0/5 | 7 | 0.43 |
| **R3 edit** | **4/5** | 4/5 | **5/5** | **4/5** | 6 | 0.41 |
| R3 canny | 4/5 | 3/5 | 0/5 | 0/5 | 7 | 0.56 |
| R3 kontext | 4/5 | 4/5 | 0/5 | 0/5 | 6 | 0.42 |
| R3 edit_pro | 2/5 | 1/5 | 5/5 | 2/5 | 9 | 1.74 |
| R3 depth | 1/5 | 1/5 | 1/5 | 0/5 | 9 | 0.48 |
| **R4 edit** | **5/5** | 4/5 | 3/5 | 3/5 | 6 | 0.48 |
| R4 edit + 3 reference images | not run — see below | | | | | |

R2 depth P1 errored at Replicate (no image). Eval spend in total ≈ US$10.8
(renders and checks US$9.65 + reference reading, before readings and the style
re-score); the project's `render_spend` ledger holds the rows of every run that
finished (a run cut short before the per-arm recording was added left none).

### What the five photos show (the before reading) vs where the camera says to look

| photo | §4 camera | the check reads | the plan says it should see |
|---|---|---|---|
| P1 | (35, 60) → 155° | door, WC, bidet | door, WC, bidet, vanity |
| P2 | (30, 130) → 105° | door, WC, bidet, vanity, shower glass | door, WC, vanity, shower glass |
| P3 | (40, 230) → 40° | WC, vanity, shower glass | WC, bidet, vanity, shower glass |
| P4 | (235, 235) → 300° | window, WC, shower glass | window, WC, bidet, vanity, shower glass |
| P5 | (118, 105) → 60° | shower glass | shower glass |

The camera expectation (an 80° field of view from the placed point) is a
report, never a pass rule: a phone held low sees less than its wedge, and the
photo is what the render is held to.

## Style from the references

The seven Pinterest screenshots were cropped to their photos (the vision model
finds the photo inside the app chrome) and read together into one brief —
stored on `project_briefs.reference_style`, the same text the app's
`POST /api/projects/:id/reference-style` writes:

> Warm spa-minimal bathroom. Floor and walls in warm beige-greige stone or
> travertine-look tile, matte honed finish, large-format rectangular slabs with
> tight tone-matched grout. Floating vanity in warm oak or walnut, optionally
> fluted fronts or an open towel shelf, with a thick honed stone top … Frameless
> backlit mirror with soft halo glow. Taps and fittings in brushed brass or matte
> black. Frameless clear glass shower with an LED-lit recessed niche. Lighting:
> hidden LED coves, warm 2700K, small recessed downlights. …

It matches the room sheet's §6 on every point (large-format warm travertine
look, floating oak vanity + stone top, backlit mirror, brushed brass, frameless
clear glass + lit niche, cove LED 2700 K); it adds "or matte black" as an
alternative finish, which §6 does not have.

**Image references (`TASTE_SEED_ENABLED`'s three images): NOT measured.** The
test run was refused by Replicate — the account ran out of credit (402
"Insufficient credit") before its first render. Until it is measured, images
stay gated off (`PHOTO_VIEW_IMAGE_REFS = false`, `lib/render/reference-style.ts`):
the views use the text brief only. To finish: top up Replicate, then
`node --env-file=.env.local --experimental-transform-types --import ./scripts/_alias-hook.mjs scripts/b2-restyle-eval.ts 3096 --arms=edit --seed-test --skip-refs --round=5`
and `scripts/b2-style-rescore.ts`; adopt images only if `edit+refs@5` holds the
layout pass rate of `edit@5`.

## Known limits

- **Size is not checked**, only position: in R3 P4 the window came out smaller
  than the photo's and passed. A size rule (box area within ×0.5–×2) is the next
  tightening; it was not added mid-eval so the rounds stay comparable.
- **Variance is real**: the same arm, prompt and check scored layout 4/5 then
  5/5 and style 5/5 then 3/5 across two runs. Ten renders is a small sample.
- **Output frame**: nano-banana returns 704 × 1472 (1 : 2.09) for the 946 × 2048
  photo (1 : 2.16) — portrait kept, no 3:2 re-crop, ~3.5% wider. None of the
  models offers the photo's exact ratio.
- **The ceiling**: renders repair the water-damaged ceiling. The room sheet's §7
  item 3 (is the leak fixed?) is a client question the render does not answer.
- **Refusal fallbacks**: the installed Anthropic SDK (0.91) has no server-side
  `fallbacks` field, so none is configured; a refused reading is "the render
  could not be checked" — never a pass.

## Still to do in B2 (blocked on Replicate credit)

- The five photo views through the app (`scripts/b2-photo-view-check.mjs`) and
  the deliberate failure (`scripts/b2-deliberate-failure.ts`) — both need
  renders.
- The reference-image test above.

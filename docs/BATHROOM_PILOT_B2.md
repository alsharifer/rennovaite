# Bathroom pilot B2 — photo views that keep the layout (report, 18 Oct 2026)

Dev test project `a2661f34` (B1's bathroom, the room sheet's 266 × 263 × 280),
the client's five photos placed at the sheet's §4 cameras. Images and the raw
results are in `data/Bathroom Pilot/b2-eval/` (gitignored — client photos);
this file has the numbers. Screenshots: `screenshots/bathroom-pilot/b2/`
(gitignored for the same reason).

## B2b — the pro model with its frame pinned (18 Oct, later)

> **Restated in B8 (19 Oct, `docs/BATHROOM_PILOT_B8.md`):**
> - **The check changed:** every image read twice, tolerances from the measured noise (size ×1.27, height ×1.19).
> - **The table below becomes:** pro **2/5** both (P4's glass +30 % now fails); nano-banana R5 **1/5**.

**Goal:** a full restyle AND the layout, by removing nano-banana-pro's re-frame
rather than accepting nano-banana's under-restyling.

**How:**
- **No way to pin the size directly.** nano-banana-pro takes no output size,
  only an aspect enum, and the photo (946 × 2048, 1 : 2.16) matches none of them.
- **Pad, then cut back.** The photo is padded to exactly 9 : 16 with mirrored
  edges (`lib/render/frame-pin.ts`). The output is cut back to the photo's frame
  by that geometry, refined from the fixtures the check finds in both images.
  That refinement is a uniform scale + offset, accepted only within 15 % /
  10 % of the geometry, so a recomposition fails instead of being absorbed.
- **The check runs on the cut-back image.** The crops checked out (P1 and P4
  were refined from fixtures, residual 16 and 41 px of 2752; P2, P3 and P5 kept
  the geometry).

**The size rule is in** (`SIZE_TOLERANCE`, box area within ±25 % of the photo's),
and every view's check line now reads "… · fittings may differ"; small fittings
stay unchecked.

**Run:** P1–P5, the client's reference images on, `PHOTO_VIEW_MAX_ATTEMPTS=2`,
through the studio. nano-banana's reference-image renders (R5) were judged again
under the same size rule (`scripts/b2b-rejudge.ts`, readings only, no renders).

| pipeline (current check, size included) | layout | style v2 | **both** | renders | cost per render |
|---|---|---|---|---|---|
| **nano-banana-pro, frame-pinned + references** | 3 / 5 | 3 / 3 passed | **3 / 5** | 8 | ≈ US$0.21 (AED 0.75) |
| nano-banana + references (R5, one attempt) | 2 / 5 | 2 / 2 passed | 2 / 5 | 5 | ≈ US$0.09 (AED 0.32) |
| *B2 table, before the size rule:* nano-banana + references | *4 / 5* | *4 / 5* | *3 / 5* | | |

Per view, frame-pinned pro:

| view | outcome | attempts | style | cost US$ |
|---|---|---|---|---|
| P1 | layout ✓ | 1 | 0.88 ✓ | 0.23 |
| P2 | **failed** — shrank the WC (−59 %), moved the bidet, enlarged the vanity (+244 %) | 2 | — | 0.38 |
| P3 | **failed** — moved the WC, enlarged the vanity (+109 %) | 2 | — | 0.38 |
| P4 | layout ✓ | 1 | 0.90 ✓ | 0.23 |
| P5 | layout ✓ (attempt 1 shrank the shower glass −63 %) | 2 | 0.90 ✓ | 0.42 |

Total US$1.64 (AED 6.02) for the five views: 8 pro renders and their checks.
nano-banana + references under the size rule: P1 shrank the door (−31 %), P2
enlarged the vanity (+154 %), P3 enlarged the WC (+44 %); P4 and P5 passed at
style 0.90.

**Picked by both checks: frame-pinned pro** (3/5 vs 2/5). It is the default
(`PHOTO_VIEW_DEFAULT_MODEL = "pro"`); nano-banana is the fallback behind
`PHOTO_VIEW_MODEL=edit`.

Caveats on that pick:
- Pro had its re-render (two attempts) and nano-banana did not. On first
  attempts they tie at 2/5.
- Pro costs ~2.4× per render.

**The verify bar was not met.** P2 and P3 are not layout-green after two
attempts each, so style is 3/5, not ≥ 4/5. These are real recompositions, not
crop error. In P2 pro moved the door right, swapped the WC and the bidet, and
grew the vanity into a long floating unit. Removing the re-frame was necessary,
but not sufficient: pro still redesigns the vanity at the size the references
show.

**The size rule is close to the readings' own noise.** A second reading of the
same nano-banana P1 image found the door 31 % smaller than the first reading
did. ±25 % fails some renders on reading noise, not on the render.

**Options (not taken — they spend renders):**
1. **Render P2 and P3 again:** 2–4 pro renders, ≈ US$0.4–0.8.
2. **Tell the prompt to keep the vanity's size and run:** the vanity is the
   repeat offender (+109 %, +154 %, +244 %).
3. **Loosen size to ±35 %, or average two readings:** a check change, no renders.

## Where B2 stood (before B2b — the model and size rule above supersede it)

- **Layout is held.** The live run through the studio — one render per photo
  (`PHOTO_VIEW_MAX_ATTEMPTS=1`, at Abdallah's spending cap) — passed the
  placement check on **5 / 5** photos: "Layout follows your photo ✓".
- **Style is the weak half.** Judged beside the photo it came from (style check
  v2), the same five views follow the references on **2 / 5** (P2, P3); P4 and
  P5 only partly (0.7); P1 was barely restyled (0.25 — the old tiles and the
  damaged ceiling stayed). The studio says so on each view.
- **The client's reference images fix most of that** (measured, one render per
  photo): style 4 / 5, both checks 3 / 5 — against 4 / 15 without them — with a
  layout pass rate of 4 / 5 against 13 / 15. B2's rule was to adopt images only
  if the layout pass rate does not drop; it dropped by one render in five, which
  is inside the run-to-run spread but is a drop — so it went to Abdallah, who
  ruled (18 Oct) that the style gain is worth the possible one-in-five layout
  cost: **images are ON** (`PHOTO_VIEW_IMAGE_REFS = true`). The placement check
  still holds every render to the photo.
- **The honest failure works**: a render told to move the vanity instead tiled
  over the door; the check named what actually changed — "The render removed
  the door — see what differs." — never a pass.

**Ruled (18 Oct):** reference images on — the five views in this report were rendered before the switch, with the text brief only; renders from now on carry the first three references after the photo.

## The B2 model: `google/nano-banana` (edit), prompted per view — now the fallback (`PHOTO_VIEW_MODEL=edit`)

`PHOTO_VIEW_ARM = "edit"` (`lib/render/photo-restyle.ts`). Final prompt and
check, layout after the loop's one re-render, style with check v2 (beside the
photo):

| arm (round 3) | layout | style v2 | both | US$ / 5 photos |
|---|---|---|---|---|
| **edit — nano-banana** | **4 / 5** | 2 / 5 | 1 / 5 | 0.41 |
| canny — flux-canny-pro | 4 / 5 | 0 / 5 | 0 / 5 | 0.56 |
| kontext — flux-kontext-pro | 4 / 5 | 0 / 5 | 0 / 5 | 0.42 |
| edit_pro — nano-banana-pro | 2 / 5 | **5 / 5** | **2 / 5** | 1.74 |
| depth — flux-depth-pro | 1 / 5 | 1 / 5 | 0 / 5 | 0.48 |

and nano-banana again (R4: layout 5 / 5, style 1 / 5) and live (5 / 5, 2 / 5).

Why nano-banana, honestly: it holds the layout most reliably at the lowest
cost (≈ US$0.08–0.10, AED 0.30–0.35 per view, check included) — but partly by
restyling too little. **nano-banana-pro** restyles fully (style 5 / 5) and ties
it on "both" in round 3, at 4× the price; it loses on layout because it snaps
every frame to 9 : 16 (1536 × 2752) and the fixtures move with the re-frame.
Feeding pro a photo padded to 9 : 16 (and cropping its output back) may close
that — not tried, to stay inside the render budget.

**Neither conditioned path (depth / canny) won**: canny follows the photo's
edges, so it keeps the layout *and the old finishes* (frosted striped glass,
the tile grid, a terracotta floor) — style 0 / 5; depth invents detail where
depth is flat (a wooden door on the shower wall, a second WC, lettering on the
glass); kontext keeps the finishes like canny.

What moved the edit path's layout pass rate from 2 / 5 to 4–5 / 5 was the
**prompt built from the check**: the fixtures the photo shows and where they
are in the frame, the ones it does NOT show ("This photo shows no vanity — do
not add any"), and only the style elements the view shows (the full brief
describes a vanity, and a model painted one over P4's laundry trolley).

## Method

- **Placement check** (`lib/render/photo-check.ts`, the garden pair gate's
  shape): candidates = the room's door, window and sanitary fixtures from the
  plan; `claude-opus-5-5` (structured JSON) reads each in the before photo — box
  in % of the frame, copies — once per photo (`room_photos.before_detection`,
  keyed by `CHECK_VERSION`), and in the render beside the photo and its boxes.
  Pure pass rule `judgePhotoPlacement`: every item the photo shows is in the
  render, centre within max(12%, 60% of its extent), once, same left/right
  order; nothing the photo lacks is added. One re-render with the findings as
  instructions, then the honest failure.
- **Style check v2** (`checkStyle`, `STYLE_CHECK_VERSION = "s2"`): the render
  beside the photo, per brief element in view, yes / partly / no; an element
  still showing the old finish is "no"; ≥ 0.75 → "Style follows your references
  ✓". v1 judged the render alone and passed P1 with its old tiles — every style
  number in this report is v2.
- **Rounds**: R1 first prompt, check v1. R2 + absent-fixture line and
  reason-specific retries, + pro and kontext. R3 + check v2 (the room door is
  never the shower's glass door; the after image read beside the before) and
  per-view style. R4 the chosen arm again. R5 the reference-image test. Live:
  the studio, one render per photo.

### Every round (layout after the retry; one render per photo in R5 / live)

| round · arm | layout | first try | renders | US$ |
|---|---|---|---|---|
| R1 edit / depth / canny | 2/5 · 1/5 · 2/5 | 2 · 1 · 1 | 8 · 9 · 9 | 0.47 · 0.65 · 0.67 |
| R2 edit / pro / kontext / depth / canny | 2/5 · 3/5 · 1/5 · 1/5 · 3/5 | 2 · 0 · 1 · 1 · 3 | 8 · 10 · 9 · 9 · 7 | 0.45 · 1.82 · 0.54 · 0.53 · 0.43 |
| R3 edit / canny / kontext / pro / depth | 4/5 · 4/5 · 4/5 · 2/5 · 1/5 | 4 · 3 · 4 · 1 · 1 | 6 · 7 · 6 · 9 · 9 | 0.41 · 0.56 · 0.42 · 1.74 · 0.48 |
| R4 edit | 5/5 | 4 | 6 | 0.48 |
| R5 edit + 3 reference images | 4/5 | 4 | 5 | 0.43 |
| live (studio) edit | 5/5 | 5 | 5 (+2 refused, 402) | ≈ 0.40 |

Style v2 where scored: R3 edit 2/5 · canny 0/5 · kontext 0/5 · pro 5/5 · depth
1/5; R4 edit 1/5; R5 edit + references 4/5; live 2/5.

B2 spend on the project (`render_spend`, AED 39.25 in all): the eval US$10.04
on the ledger + US$2.27 of one run cut short before per-arm recording was added
(R2 edit + pro, in the table above); live US$0.65 (AED 2.37) — six renders (the
five views and the deliberate failure), their checks, the style re-checks and
one reading of the references.

### What the five photos show (the before reading) vs the placed camera

| photo | §4 camera | the check reads | the plan says it should see |
|---|---|---|---|
| P1 | (35, 60) → 155° | door, WC, bidet | door, WC, bidet, vanity |
| P2 | (30, 130) → 105° | door, WC, bidet, vanity, shower glass | door, WC, vanity, shower glass |
| P3 | (40, 230) → 40° | WC, vanity, shower glass | WC, bidet, vanity, shower glass |
| P4 | (235, 235) → 300° | window, WC, shower glass | window, WC, bidet, vanity, shower glass |
| P5 | (118, 105) → 60° | shower glass | shower glass |

The camera expectation (80° from the placed point) is a report, never a pass
rule: the photo is what the render is held to.

## Style from the references

The seven Pinterest screenshots, cropped to their photos (the vision model finds
the photo inside the app chrome), read into one brief on
`project_briefs.reference_style` — the same text the app's
`POST /api/projects/:id/reference-style` writes from the References board:

> Warm spa-minimal bathroom. Floor and walls in warm beige-greige stone or
> travertine-look tile, matte honed finish, large-format rectangular slabs with
> tight tone-matched grout. Floating vanity in warm oak or walnut … thick honed
> stone top … Frameless backlit mirror with soft halo glow. Taps and fittings in
> brushed brass or matte black. Frameless clear glass shower with an LED-lit
> recessed niche. Lighting: hidden LED coves, warm 2700K, small recessed
> downlights. …

It matches the room sheet's §6 on every point; it adds "or matte black" as an
alternative finish, which §6 does not have.

## The deliberate failure

`scripts/b2-deliberate-failure.ts` — the real pipeline on P2, both prompts
replaced by "move the vanity onto the shower wall … fill where it stood with
plain tiled wall", one render. nano-banana kept the vanity and tiled over the
door instead; the check read what was there: **"The render removed the door —
see what differs."**, the studio drawing the door's box in the photo and its
absence in the render. P2's latest view in the studio is this failure (by
design of the demonstration); "Render again" makes a normal one.

## Known limits

- **Size is not checked**, only position (R3 P4's window came out smaller and
  passed). Next tightening: box area within × 0.5–2.
- **Fittings are not checked**: P1's live render added a shower riser on the
  door wall — not a fixture the check knows.
- **Variance**: the same arm and prompt scored layout 4 / 5 then 5 / 5, style
  2 / 5 then 1 / 5. Five photos is a small sample for every number here.
- **Output frame**: nano-banana returns 704 × 1472 (1 : 2.09) for the
  946 × 2048 photo (1 : 2.16) — portrait kept, no 3 : 2 re-crop, ~3.5% wider.
- **The ceiling**: a passed render repairs the water-damaged ceiling; the room
  sheet's §7 item 3 (is the leak fixed?) stays a client question.
- **Refusal fallbacks**: the installed Anthropic SDK (0.91) has no server-side
  `fallbacks` field, so none is configured; a refused reading is "could not be
  checked" — never a pass.
- **Spending cap**: `PHOTO_VIEW_MAX_ATTEMPTS=1` caps a deployment at one render
  per view; unset, the loop re-renders once (B2's rule).

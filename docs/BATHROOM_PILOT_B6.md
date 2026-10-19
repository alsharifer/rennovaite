# Bathroom pilot B6 — the client pack (19 Oct 2026)

One branded A3 PDF for one room, built from the plan graph, the studio's photo
views and the stored BoQ revision. Dev test project `a2661f34` (the room
sheet's bathroom). No migration: the door's hinge is `plan_openings.spec.hinge`
(jsonb, already there).

## What the pack is

`GET /api/projects/:id/room-pack` (a document route: `guardDocumentRoute`,
`DRAWINGS_ENABLED`, fonts shipped by `outputFileTracingIncludes`). It is served
only to a running pack-export job, like every document. `?format=json` gives
the contents and `?format=pages` the page SVGs plus where each photograph sits.
Export pack produces it beside the drawing set and the BoQ PDF whenever the
project is one room from the room intake (`plans.intake = 'room_dimensions'`,
one in-scope room).

| page | from |
|---|---|
| Cover | the anchor render (the locked view the room's finishes follow), the total with contingency and VAT, what is excluded |
| The room and your photos | the room outline, fixtures, openings, and every photo's camera (P1…; the anchor filled) with its heading |
| One page per view | the shown version (locked, else the latest passed) beside the owner's photo. Origin "from your photo — restyled, its layout kept". The checks are the studio's own lines: layout, follows the anchor / changed / differs / anchor, and the small-fittings caveat |
| R-101 dimensioned plan, 1:20 | walls; the door's leaf and swing from `spec.hinge` (W = the west jamb); window; fixture footprints with codes; a chain on every wall (corner → jamb → jamb → corner); each fixture's centre from its nearest corner |
| R-201…R-204 wall elevations, 1:20 | one per wall, seen from inside. Shows the tiled band with its **setting-out** (a joint or a tile on the centreline, whichever leaves the larger equal cuts, dimensioned joint to joint), courses from the floor, the top-course cut, openings with sill / head / width from the graph, and fixtures at standard heights printed with ≈. A fixture is face-on only on the wall its back is against; on a wall it touches by its side it is a profile, with no mirror and no shaver point. The mirror is round only when the design spec says so |
| Materials and finishes | the anchor's design spec (B4), with "read from Photo 2 — the view that anchors the room" |
| Bill of quantities | the stored revision, curated, by section |
| Price | the section totals, then subtotal → contingency → VAT → total (to the fil). Below them: the lines to be priced (not in the total) and the options, each priced separately |
| Indicative programme | the interior phase model (`loadTimeline`): ≈ N working days, the range, the phases. The basis sentence names the calibrated reference project. Labelled indicative and derived, "never a commitment" |

The room's sheets are numbered **R-** so they never share a number with the
general drawing set's A- sheets in the same export.

## Verified (dev, a2661f34, rev 9)

`node --env-file=.env.local --experimental-transform-types --import ./scripts/_alias-hook.mjs scripts/b6-room-pack-check.ts [port]`
reads the pack through a verification job: **15/15**.

- 17 pages, in order: cover, room, 5 views, 5 drawings, materials, 2 BoQ, price, programme.
- Every view has its render and photo, and no image is missing.
- The total is the latest BoQ's to the fil, AED 49,267.88. Both options are priced.
- Every dimension matches the graph to the mm:
  - wall lengths 2660 / 2630;
  - ceiling 2800 on all 4 elevations;
  - door 870 × 2100;
  - window 450 × 600 on a 1500 sill.
- Every plan chain closes on its wall: N 2660 · E 2630 · S 2660 · W 2630.
- Every elevation's tile chain closes too: 430 · 600 · 600 · 600 · 430, and 415 · 600 · 600 · 600 · 415.
- The door swings from the stored hinge (W).
- No withheld identity appears on any page.

Review PNGs, with the photographs composited, are in
`screenshots/bathroom-pilot/b6/pack/` (gitignored — the client's room).

The whole export, `scripts/garden-draft-pack.ts a2661f34 3096 --no-render
--no-regen --pairs 0 --stage verification`, gave **13/13**. The drawing set,
BoQ PDF and room pack all came out. Parity was clean, there was zero identity
leakage across 25 documents, and the room pack's total equals the BoQ's.
The first run was refused by the gate for the working name "(scratch)". The
dev project now has `display_name` "Bathroom renovation".

Unit: `lib/drawings/__tests__/room-sheets.test.ts` (11) — the sheet's chains,
setting-out, sill / head, fixture walls, side profiles, mirror shape.

## Found while reviewing the pages (fixed)

- The vanity touches the south wall by its side, so the south elevation drew
  its mirror and shaver point across the door. Fixtures are now face-on only on
  their back wall.
- The tile chain printed only cut · one tile · cut. It now runs joint to joint
  and closes.
- The WC's label was hidden under the pan's fill, and the WC was drawn 360 wide
  instead of its 420.
- The programme's bars started a day early (`start_day` is 0-based).
- The heater's legend read "800 × ? mm". It now reads "800 mm wide".

## For a ruling

1. **Mirror shape.** The anchor render and the design spec say rectangular,
   and the drawings now follow the spec. The BoQ line (B5, from the room sheet)
   says "backlit LED mirror, round or pill". One of them should change before
   the client sees the pack.
2. **Plumbing vs Plumbing & Sanitary.** B5's BoQ has both sections (the
   engine's and the fixture overlay's). The price page prints both.
3. **The programme** is the interior model's minimum (≈ 32 working days,
   32–64). That is long for one bathroom. Should a single-room project get its
   own phase model, or keep the label and let the contractor answer?
4. **Hinge entry.** `spec.hinge` is set by API (dev: W, opens in). The
   Openings editor has no control for it yet. Without one the sheet says "hinge
   not stated" and draws no swing.

## Client comments (19 Oct)

Three comments, applied to the dev test bathroom with
`scripts/b6-client-comments.ts` through the app's own routes (idempotent):

1. **A white storage cabinet instead of the bidet.** The bidet leaves the plan,
   and a `storage_cabinet` fixture takes its place. It is a footprint on the
   wet-room layer with no services, so the overlay feed gives it no point line.
   Its `spec.replaces = "bidet_point"`. The wet-room package prices it as
   joinery: W-25 / R-66, AED 750 allowance. The strip-out still names the bidet
   because it is still on site (`rooms.spec.wet_room.existing_fixtures`).
2. **The shattaf on the right of the WC.** We read "right" as the user's right
   hand when seated, which you confirmed. The WC faces east, so the shattaf goes
   on its south side, between the WC and the cabinet, 1,620 mm from the north
   wall.
   - It is a `shattaf_point` fixture: a supply point at AED 350, QS to confirm.
   - It appears as SF on R-101 and on the west elevation at ≈ 600 mm.
3. **A price closer to 35–40K.** You picked three groups of spec changes, set in
   `rooms.spec.wet_room` (`WetRoomChoices`, `lib/boq/wet-room.ts`):
   - fixed walk-in glass panel (R-67) + manual concealed mixer (R-68);
   - ready-made vanity with integrated basin (R-69) + mid-range basin mixer
     (R-70), WC (R-71) and LED mirror (R-72);
   - bagged waste (R-73) + a niche without LED (R-74).

   Each is a different PRODUCT at its own allowance; no existing rate is cut. No
   choices set = the base case, byte for byte (tested).

**The price: AED 49,267.88 → 38,778.38** (subtotal 34,196.10 + contingency
2,735.69 + VAT 1,846.59).

### Renders: what the check caught

The renders now know about a swap.
- A fixture that replaces another becomes a check item read as the old item in
  the photo and the new one in the render. It is held to the old item's
  footprint (centre x, bottom edge), not its size.
- The replaced item is its own "gone" item, so a render that keeps the bidet
  FAILS.
- The restyle prompt says "Replace the bidet (…) with a white floor-standing
  storage cabinet standing in the same spot; no bidet anywhere".
- `lib/render/fitting-notes.ts` tells each view where the shattaf is relative to
  the WC in that frame, and to remove the hand spray by the door.
- "Ask for a change" is now checked against the plan's CURRENT items, with the
  parent's reading carried over (`carryLocated`).

Live, on the anchor (Photo 2), there were 10 nano-banana edits at about
US$0.07 each, US$0.78 that day:

| request | result |
|---|---|
| all five changes at once | refused: shower glass removed |
| cabinet, before the "gone" item existed | **kept, wrong**: bidet kept, cabinet beside the door. The anchor was re-locked to v4 (re-locking now moves the anchor back) |
| cabinet, worded "remove the bidet … put a cabinet where it stood" | **v6** ✓ |
| shattaf removal (×3) | refused twice: invented window; one no-op kept as v7 |
| fixed glass panel | 422 (the word "door") → reworded → refused: invented window |
| ceramic vanity top | refused once (window) → **v8** ✓ |

Every change prompt now says "Do not add any window, door or opening".
A change whose reading says the request did not happen (`request_done: "no"`)
is the honest "unchanged" answer, never a version: v7 was that no-op.

The anchor is now **v8**: cabinet ✓, ceramic vanity top ✓, but the shattaf is
still by the door and the glass is still the hinged screen. The other four views
are not re-rendered yet.

### Second round: pro for edits and a taller cabinet (19 Oct)

BoQ and pricing untouched: revision 09745967 stays at AED 38,778.38.

- **"Ask for a change" uses the photo-view model** (`photoViewArm`:
  nano-banana-pro). The parent is padded to 9 : 16 and the output cut back to
  its frame (`fitMap` on the carried reading).
- **A change may resize only what it names** (`itemsNamedBy`: "glass" frees the
  shower glass's size). Its place is still held.
- **Cabinet height** is `plan_fixtures.spec.height_mm` = 1,200. It reaches the
  check's words ("about 1.2 m tall — well above the WC cistern") and the west
  elevation.
- **Photo-view renders know the room's screen choice.** With `fixed_panel` the
  prompt says one fixed walk-in panel and the shower glass's size is freed.

Photo 2 (anchor), pro edits:

| version | result |
|---|---|
| v9 | taller cabinet — came out ~2 m |
| v10 | shattaf by the door removed ✓ |
| fixed panel | refused ("shrank the shower glass", before `itemsNamedBy`) |
| v11 | cabinet down to ~1.2 m ✓ |
| v12 | fixed panel ✓, rain head lost |
| v13 | rain head back ✓ — **the anchor** |

Photos 1, 3, 4 and 5 were rendered once each (US$0.92):
- **P4 passed**, but it shows the hinged enclosure; the glass size rule held it
  to the photo, before the screen choice reached the check.
- **P1 failed**: reframed, door −58%. The shattaf is beside the WC and the bidet
  is gone, but the cabinet is ~2 m.
- **P3 failed**: recomposed again, WC moved.
- **P5 failed**: the fixed panel is right by design, now freed; it also read an
  invented vanity.

The pack shows each view's latest PASSED version. Until P1, P3 and P5 pass
again, their pages are the older renders (with the bidet), marked "Photo 2
changed after this view was rendered".

## Part 2 — the client project (not started)

The brief's second half: create the client's project from the room sheet,
upload and place the photos (6 with the doorway shot), crop the references
into References, render the photo views, lock the client's pick, re-render the
rest, regenerate the BoQ, export, and freeze. Capture the angles asked for, the
"Ask for a change" rounds, the render spend, and every BoQ line the client or
their contractor corrects. It waits on three decisions: which environment
(production needs 062–065 there first), the client's anchor pick, and the
doorway photo.

# Bathroom pilot B4 — one design across a room's views (18 Oct 2026)

Spec §7.5 (Figma J7 82:48 / dark 82:2438). Built on the B2b pipeline
(nano-banana-pro frame-pinned, reference images on, `PHOTO_VIEW_MAX_ATTEMPTS=2`).
Dev test project `a2661f34` (the room sheet's bathroom). Migration **064**
(`room_anchors`, `room_photos.locked_render_id`, `renders.anchor_render_id`) —
**dev only; push to production before merging.**

## What it does

1. **Anchor.** The first view the user locks anchors the room. It is a photo
   view, because it carries the real layout.
   - **The room design spec.** It is read from the anchor's render by one
     vision reading (~AED 0.05) and stored on the anchor: floor tile, wall
     tile + tiled height, vanity, mirror, WC, shower screen, fittings finish
     and palette.
   - **No mounting in the spec.** How the WC is mounted is the plan's
     decision, never the anchor's. The first reading said "wall-hung WC" from
     a render, while the client keeps the floor-standing WC (sheet §7 item 1:
     wall-hung is a priced option). So the reading asks for design and finish
     only, and `withoutMounting` strips mounting words.
2. **Every other view follows it.** Its render gets the anchor's image after
   the photo, in place of the three reference images (the anchor already
   embodies them), and the spec as the look. It is then checked beside the
   anchor: "Finishes follow Photo 2 (locked) ✓", or which elements differ. The
   render records the anchor version it followed. Re-rendering a non-anchor
   view never moves the anchor. A locked view is never re-rendered (it
   changes only by asking for a change).
3. **Ask for a change** keeps the edit-model path (nano-banana edits the
   current image):
   - a structural request goes to the plan, with no model call;
   - an image that comes back the same is on record but is not a version
     ("That change didn't come through — the image is the same. Try being
     more specific.");
   - an edit that moves a fixture is not kept;
   - otherwise it becomes version N, with "Last change: “…” → version N ·
     changed: <what>".

   A change to the anchor moves the anchor: the spec is read again and the
   old version kept in `history`. Every other view then reads TO UPDATE ("Photo
   2 changed after this view was rendered"); none is re-rendered on its own.
4. **The studio per 82:48.**
   - **Left:** the list grouped by room → views, each with an icon + label
     status: ANCHOR · LOCKED · READY · RENDERING · NOT YET · NOT PLACED ·
     CHECK FAILED · TO UPDATE.
   - **Centre:** the eyebrow (room · photo N of M · from your photo · version),
     the image (Restyled / Your photo), the views strip with Add photos
     (multiple) and Add a view (disabled with its reason: a view with no
     photo needs the room in 3D, descoped in B3), the design check block, Lock
     / Render again / versions, Ask for a change and the last change.
   - **Right:** VIEWS ON THE PLAN (room outline, door, window, fixture
     footprints, P markers; press where it was taken and drag toward what it
     shows), the design checks per view, render spend and the references.
5. **Cost guard.** "Render remaining" covers positioned, unlocked views not
   yet rendered against the current anchor. Unplaced photos never render in
   bulk, and concept views come only on request. The button shows "N
   positioned photos · ≈ AED a–b" before anything is spent, and renders two at
   a time.

## Live run (18 Oct, dev `a2661f34`, `scripts/b4-anchor-check.mjs`)

**Lock P2 (vanity) → anchor.** P2's latest version (B2b pro) had failed its
layout check, so version 1 was locked: the B2 render that passed. Only a
version that keeps the layout can be locked. Spec read: AED 0.05.

- **First reading:** "white ceramic **wall-hung** WC". This was fixed so the
  spec never carries mounting.
- **Re-read:** floor "large-format beige limestone-look porcelain, matt";
  walls "large-format beige travertine/limestone, honed", full height; vanity
  "wall-hung two-drawer walnut-oak veneer, thick beige stone top, undermount
  white basin"; mirror "rectangular frameless, backlit LED perimeter"; shower
  screen "frameless clear glass, brushed-brass hinges"; fittings brushed
  brass; palette warm beige stone / walnut / white / brushed brass.

**"Render remaining 4"** showed "4 positioned photos · ≈ AED 3.16–6.32" before
anything was spent. It rendered P1, P3, P4 and P5 against the anchor, two at a
time, in 161 s, for **AED 5.29**:

| view | layout | finishes vs Photo 2 | attempts | AED |
|---|---|---|---|---|
| P1 | ✓ | ✓ follow | 1 | 0.81 |
| P3 | **✗** — enlarged the WC (+57 %) | not checked | 2 | 1.41 |
| P4 | ✓ | ✓ follow | 2 | 1.55 |
| P5 | ✓ | ✓ follow | 2 | 1.51 |

- **By eye, P1, P4 and P5 follow P2:** the same beige travertine-look tile,
  brushed-brass rain head and hinges, frameless glass and warm cove light.
- **P3 is still the B2b problem.** The pro model recomposes this view, whose
  vanity and WC are near the frame edge. It is shown as CHECK FAILED with
  "see what differs", never as a pass.

**Three "Ask for a change" requests** (AED 0.82, then 0.60 for the two re-asked
after the fix below):

| view | request | result |
|---|---|---|
| P4 | "add a small green plant in a white pot on the floor in the corner by the window" | version 4 · **changed: accessories**; the plant stands by the shower glass |
| P2 (anchor) | "make the vanity wood a lighter natural oak" | version 4 · **changed: vanity** ("slightly lighter, warmer grain", 4.4 % of pixels). The anchor moved; P1, P4 and P5 turned **TO UPDATE**, with no auto re-render |
| P1 | "make the door handle brushed brass" | **not kept**: "That change enlarged the bidet (33 % of its area) — it was not kept. Try asking for it differently." Twice, consistently |

**Found and fixed in the run:**

- **Changes were judged against the original photo.** The first P1 and P2
  requests were both refused for "enlarged the bidet". A change was held to
  the photo, so it inherited what its parent was measured with: P2 version 1
  predates the size rule, and its own vanity is +154 % against the photo. A
  change is now held to the VERSION it edits (the parent's own reading).
- **A locked view showed its latest version's check, not the locked one's.**
- **A failed render read "finishes differ".** It was never compared, so it
  now reads "not checked".
- **The rail's 03 Renders ignored a photo-view lock.** It now counts an
  anchored room as locked.

**Known limits:**

- **The edit model re-frames slightly.** nano-banana returns 704 × 1472 for a
  946 × 2048 parent.
- **It under-delivers on finishes.** "Lighter oak" changed the vanity only
  slightly, and the re-read spec still says walnut. The change line names
  what changed, but not how much.
- **P1's bidet** reads +33 % after an edit. That is consistent across two
  different requests, so the edit really does re-frame that view.

**Screens:** light and dark at desktop, tablet and phone. axe is clean, there
is no horizontal overflow and no console error. Shots are in
`screenshots/bathroom-pilot/b4/` (gitignored, client photos).

**Render spend on the project:** AED 45.77 → **52.58** for all of B4 (spec
reads, 4 anchored views, 5 change edits and their checks).

## Next step (recorded, not wired)

The room design spec is the hook to 03 Specification and the BoQ: the vanity,
WC and tiles read here are what the client will be priced for. B5/B6 can read
`room_anchors.spec`.

# Bathroom pilot B10 — masked per-fixture edits (report, 20 Oct 2026)

Dev test project `a2661f34` (the pilot bathroom). B8 found the vanity grows in
every arm: the model's prior, not its inputs. The candidate mechanism is a mask
from the fixture regions the check already reads.
`black-forest-labs/flux-fill-pro` inpaints only inside the mask, and the
original is pasted back outside it (`compositeInside`), so **nothing outside
the mask can change, by construction**. Scored with the B8 check.

- Code: `lib/render/masked-edit.ts` (`maskPng`, `padBox`, `raiseToTop`,
  `compositeInside`, `maskedEdit`) and `lib/render/spend-cap.ts`.
- Script: `scripts/b10-masked.ts`.
- Images: `data/Bathroom Pilot/b10-eval/` (gitignored).

## Hard cap

US$5.00, enforced in code (`SpendCap`, session_ref "b10"):
- every paid call — fill, reading, check, Pro restyle — reserves its worst case
  first;
- a call that would cross the cap is refused before it runs;
- tested.

**Spent: US$3.16.** The cap was never reached.

## Verdict

- **Masked edits are not a one-shot for every comment.** Three of the four
  comments passed in one edit. Each was only "partly" what was asked. The fixed
  glass panel failed twice.
- **The edit path stays as it is.** The masked path is recommended for in-place
  requests (remove, replace in place, refinish one item), with today's edit as
  the fallback. That is not wired; it needs your ruling.
- **The restyle pipeline stays as is**, as the brief said. The masked restyle
  is not client-viable.

What the mask does fix:
- **Layout.** Five masked edits out of five held it — the reason B6 refused six
  of its 16 edits (an added window, a moved or resized fixture).
- **The vanity's size.** ×0.98 on P3 against ×2.68 for the size-in-prompt
  control.

What it does not fix: **what the model draws inside the mask.** It still
follows its own idea of the item:
- a hinged door with a gold handle for "one fixed panel";
- a vessel basin for "an integrated ceramic top";
- a towel hook where the hand spray was.

## (b) "Ask for a change" cost — Photo 2's client comments, replayed

The replay starts at v4 (`247a88f0`), the version the four comments were made
on:
1. a cabinet where the bidet was, 1.2 m;
2. one fixed glass panel;
3. a white ceramic top with an integrated basin;
4. the hand spray off the wall beside the door.

Each is one masked edit, judged as "Ask for a change" is: the placement check
against its parent, and "was the request done" (`describeChange`). A failed
edit is tried once more.

| comment | edits | kept | layout | request done | what it drew |
|---|---|---|---|---|---|
| cabinet where the bidet was | 1 | ✓ | ✓ | partly | white cabinet in place; looks short |
| one fixed glass panel | 2 | ✗ | ✓ ✓ | no, no | a hinged double panel with a gold pull handle — both times |
| white ceramic top, integrated basin | 1 | ✓ | ✓ | partly | white counter with a raised vessel basin |
| hand spray off the door wall | 1 | ✓ | ✓ | partly | the spray, hose and valve gone; a towel hook added |
| **masked** | **5** | **3** | 5 / 5 | | 3 of 4 comments done (each partly) |
| **B6 (same comments, nano-banana → pro)** | **16** | **10** | 10 / 16 | | 4 of 4 done, after repairs (the rain head put back) |

**A first replay is kept on record** (`results.json` `replay_v1`; images
`v1-replay-*`). It was a design error on my side, not a property of masking:
- **The mask was too tall.** The cabinet's mask was the bidet's box raised ×3,
  and the model filled it: drawn 1.6–1.7 m against 1.2 m.
- **The later comments were judged against the bidet.** Because the cabinet
  wasn't kept, they were judged against a parent that still had the bidet, so
  all three failed "kept the bidet" — a cascade.

**The fixes:**
- **Mask height:** a replacement's mask is now raised to its STATED height from
  the check's own reading (`raiseToTop`: the old item's box over its top share
  gives the wall's height in the frame; the cabinet tops out at 0.43 of it).
- **Independent judging:** while a replacement is open, later comments are
  judged without it.

## (a) The vanity's size on P1 / P3

| arm | P1 | P3 | vanity (P3) |
|---|---|---|---|
| **masked** — the shell restyled with every fixture masked out, then each fixture inside its own box | ✗ kept the bidet; cabinet ~1.7 m | ✗ added a window | **×0.98** |
| **control** — today's pipeline, the vanity's size stated in the prompt (2 attempts) | ✗ shrank the door −50 % (+2 more) | ✗ WC +129 %, vanity +168 % | **×2.68** (+132 %, then +168 %) |

- **P1 shows no vanity.** The photo's reading has none in frame, so it is scored
  for "no vanity added" and the layout; neither arm added one.
- **The size line doesn't hold the vanity.** The control grew it in both
  attempts — expected, and now measured. That closes the question.
- **The mask holds it,** but the masked restyle fails as a restyle:
  - The shell stage (everything but the fixtures) barely restyles. The model has
    no reference images and copies its surroundings, the mats and towels stay,
    and on P3 it invented a window in a wall.
  - The per-fixture fills draw their own fixtures. P3's shower became a
    brass-framed enclosure with a basin inside it. P1's cabinet (still raised ×3
    in this arm) stood behind a bidet the shell kept.

## Spend (render_spend, session_ref b10)

| | US$ |
|---|---|
| (b) first replay (8 fills + readings) | 1.06 |
| (b) second replay (5 fills + readings) | 0.64 |
| (a) masked P1 + P3 (7 fills + readings + follows) | ≈ 0.45 |
| (a) control P1 + P3 (4 pro renders + readings) | ≈ 1.01 |
| **total** | **3.16 of the 5.00 cap** |

## Next

- **A ruling: masked edits as the "Ask for a change" path for in-place
  requests** — a request that names one item, with that item's box as the mask.
  - Measured: 3 of 4 comments in one edit, 0 layout refusals.
  - Today's edit stays the fallback when the masked edit's request is not done
    (the glass panel).
- **What's inside the mask is the new limit.** Worth trying: a reference crop of
  the wanted product as an image condition (flux-fill takes none, so a model
  that takes a mask and an image).

## Wired (20 Oct): masked edits are "Ask for a change" for one-item requests

Ruling: a request that names one item is edited inside that item's box, and
today's edit is the fallback when the request isn't done.

- **Routing** (`lib/render/masked-change.ts`, pure):
  - `maskedChangeTarget` finds the ONE live check item the request names
    (`itemsNamedBy`). Its box comes from the current image's reading,
    padded 1.5 % and raised to a stated height.
  - No item, several items, or an item not in view → today's edit, no masked
    try.
  - `maskedVerdict` keeps the masked version unless:
    - the image is unchanged;
    - the layout check refuses it;
    - the reading says "not done" ("partly" is kept, as for today's edit).
- **Route** (`photo-view-change.ts`):
  - the masked try → kept as a version with `change.path = "masked"`;
  - or today's edit runs, with `change.masked = { item, box, kept: false, why }`
    on every row it writes.
  - The studio says which path made the version.
- **Live** (`scripts/b10-masked-change-check.mjs`, dev test bathroom, Photo 3's
  B2-era version, hard cap US$2, ≈ US$0.24 spent):
  - "Change the vanity counter to a white ceramic top with an integrated basin"
    → version, flux-fill-pro, `path: masked`, layout held; nothing outside the
    vanity's box moved. Run twice.
  - **But the fill redesigned what the request did not name**: the top became
    white, and the oak cabinet became black, both times. The second run had the
    prompt line "every other part of the vanity keeps exactly its colour,
    material, size and design". The describer still rated the request done, so
    the version was kept.
- **One trial, not wired** (US$0.04): the same request through today's edit
  model (nano-banana), pasted back inside the vanity's box only
  (`compositeInside`) → white top, oak cabinet kept, nothing outside the box
  changed (`data/Bathroom Pilot/b10-eval/live-edit-inside-mask.jpg`). One
  sample; the edit model sees the whole room, so it knows what the vanity is.

## Measured (20 Oct): edit, then paste back inside the box — the masked arm now

The question: does "edit the whole image, keep only the inside of the item's
box" (nano-banana, which sees the room) beat flux-fill on the same one-item
requests?

- **Script:** `scripts/b10-paste-eval.ts`. It runs the route's own target logic:
  `maskedChangeTarget` over the plan's current items and the parent's carried
  reading. Both arms get the same mask and the same `compositeInside`, and are
  scored the way the route scores:
  - **done:** `describeChange`;
  - **unnamed parts kept:** a reading of the box's crop, before and after. It
    lists the parts of the item and its region the request does not name, and
    whether each kept its colour, material, size and design;
  - **layout held:** `judgePhotoPlacement` against the parent.

  Every pair was also looked at by eye (below).
- **Images:** `data/Bathroom Pilot/b10-eval/paste-eval/` (gitignored). No render
  rows were written; render_spend rows are on dev only.
- **Hard cap: US$5.00** (`SpendCap`, session_ref `b10-paste`), never raised.
  **Spent: US$3.20** for 24 samples. One spend row failed to record ("fetch
  failed", ≤ US$0.05), so the real figure is at most US$0.05 higher. The route
  check below added US$0.10.

### The cases (2 samples each, both arms)

| case | parent | request |
|---|---|---|
| p3-ceramic_top | Photo 3's B2-era version `c1e7b0ef` | Change the vanity counter to a white ceramic top with an integrated basin |
| p3-vanity_white | `c1e7b0ef` | Make the vanity drawers matte white |
| p3-fixed_panel | `c1e7b0ef` | Make the shower glass one fixed frameless clear glass panel — no hinged door, no second panel |
| p2-fixed_panel | Photo 2's v4 `247a88f0` (the comments' version) | the same |
| p2-ceramic_top | `247a88f0` | Change the vanity counter to a white ceramic top with an integrated basin |
| p2-cabinet | `247a88f0` | Replace the bidet with a white floor-standing storage cabinet, about 1.2 m tall, in the same spot |

Photo 2's fourth comment (the hand spray off the door wall) names no check
item. The route sends it straight to today's edit, so it has no masked case.

### Result (by eye, agreeing with the readings except where noted)

| | fill (flux-fill-pro) | paste (nano-banana → box) |
|---|---|---|
| request done (yes / partly) | 7 / 10 | 6 / 10 |
| **unnamed parts of the item kept** | **0 / 10** | **5 / 10** |
| layout held | 10 / 10 | 10 / 10 |
| all three | 0 / 10 | 5 / 10 |
| what the route would keep (`maskedVerdict`) | 6 — every one with the item redesigned | 7 — 5 clean, 1 lost the fluting, 1 near no-op |
| image price | US$0.05 | US$0.039 |

The five cases excluding the cabinet, case by case:

- **p3-ceramic_top**
  - fill: top white, but the oak cabinet went black (×1) or dark grey (×1), the
    basin black (×1), the brass tap black.
  - paste: white integrated top on the fluted oak cabinet, tap kept — **both
    samples**.
- **p3-vanity_white**
  - fill: white drawers, but it also swapped the stone top for a white one,
    added bar handles and doors, and changed the tap.
  - paste: white drawers; the stone top, basin and tap kept. ×1 flat fronts
    (the fluting lost — the reading's ✗), ×1 fluted white (kept by eye; the
    reading flagged grey grooves).
- **p3-fixed_panel**
  - fill: a framed enclosure with a hinged door, plus a new basin, tray,
    drain and shower set — both samples.
  - paste: next to no change, both samples (×1 read as "partly" and kept).
- **p2-fixed_panel**
  - fill: framed or two-panel glass, a new tray, the rain head and niche gone.
  - paste: ×1 no change; ×1 **done** — the hinges gone, a stay bar added,
    nothing else touched.
- **p2-ceramic_top**
  - fill: white top, but the walnut cabinet went black or dark glossy, with
    legs, handles and a new tap.
  - paste: ×1 **done** (white top with integrated basin, walnut kept); ×1 a
    white vessel basin on the stone top — scored "unchanged" by the whole-frame
    similarity and not kept.

**p2-cabinet fails on both arms, for a reason outside the model:**
- v4's stored reading is B2-era and carries no `top` share. `raiseToTop` keeps
  the box as it is, so the mask is the bidet's own box.
- fill drew a second toilet; paste left the bidet, with a sliver of a cabinet
  cut off at the box edge.
- A 1.2 m cabinet needs a reading with a `top` share (any version read since
  B8's c3 check has one).

### Why paste wins

The edit model sees the whole room, so it changes the part named and leaves the
rest of the item. The inpainting model sees only a hole shaped like the item,
and redraws an item to fill it — whatever the prompt says.

When paste falls short, it falls short as **no visible change**. That is the
honest answer: the route then runs today's edit as the fallback. When fill
falls short, it falls short by **redesigning** the item, and "was it done"
still says yes. That is how the black vanity was kept live, twice.

### Wired

- **The masked arm** (`masked-edit.ts`):
  - `maskedArm()` reads `MASKED_CHANGE_MODEL`: `paste` (the default) |
    `fill`;
  - `editThenPaste` is the paste arm; `maskedChange(arm, …)` dispatches to
    either arm;
  - `photo-view-change.ts` uses the arm's model, prompt (`pasteChangePrompt` /
    `maskedChangePrompt`) and price, and records `arm` on the spend row.
- **flux-fill-pro stays** as `MASKED_CHANGE_MODEL=fill`.
- **Live through the route:** `scripts/b10-masked-change-check.mjs`, cap
  US$2, US$0.10. "Change the vanity counter to a white ceramic top with an
  integrated basin" on Photo 3's B2-era version → a version from
  `google/nano-banana`, `path: masked`, layout held: white top, the fluted oak
  cabinet kept (`live-paste-change.jpg`). It is dev render `009d809a`; it cannot
  enter the pack (its anchor does not match).

### Still open

- **Similarity is measured over the whole frame.** A real change that is small
  against the frame (a vessel basin, a tap) can read as "unchanged" and fall
  back. Measuring inside the mask would fix it.
- **The edit can land outside the box.** The paste arm cuts off anything the
  edit model draws past the box edge (the cabinet sliver). The layout check
  held in every sample here, but a seam is possible.
- **No check for unnamed parts.** "Did the unnamed parts survive" is not a
  check in the route. The reading used here could become one.

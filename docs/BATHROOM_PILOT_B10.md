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

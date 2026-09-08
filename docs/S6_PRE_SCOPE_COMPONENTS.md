# Pre-review scope components — one page for Friday

Newspace (Abdallah) annotated column G of the Delta Log with components their
own initial scoping left out. This is what the platform now does about each.

**Read the disposition column first.** Three of the flagged components were
already priced by the engine. Column G says what the **labour contract**
excluded — not what the platform is missing — and treating every note as a
missing feature would have double-counted spotlights, sockets and water heaters.

## Component → mechanism → rate source → flag

| # | Component | Cell | Mechanism | Rate source | Flag |
|---|---|---|---|---|---|
| 1 | Ceiling spotlights | G10 | **Already priced** — rule R-14, 40 no. New: 3 catalog spec classes | AED 300/no rule rate; catalog economy 145 / standard 300 / premium 620 | `indicative` (catalog) |
| 2 | **Cove LED strip** | G10 | **New rule R-45** + 3 catalog spec classes | AED 85/lm — 24V COB strip + driver + profile, Dubai trade counter | `indicative` |
| 3 | Water heaters | G12 | **Already priced** — rule R-17, 3 no. New: 3 catalog spec classes | AED 5,000/no rule rate; catalog economy 1,250 / standard 5,000 / premium 8,900 | `indicative` (catalog) |
| 4 | Sockets & switches | G13 | **Already priced** — rule R-15, 58 no. New: explicit count rules + a default selection | Schneider vendor catalogue (6 rows, already seeded) | `needs_qs` on selection |
| 5 | **Vanity stone slab** | G19 | **New rule R-46**, additive to the Joinery section | AED 1,450/no allowance — quartz ≈1.5 lm incl. cut-out, edge, fixing | `site_assessment` |
| 6 | **Shower glass** | G21 | **New rule R-47**, additive to Aluminum & Glass | AED 2,200/no — frameless 10 mm tempered, 900–1200 mm screen | `indicative` |
| 7 | **Bathroom mirror** | G21 | **New rule R-48**, additive to Aluminum & Glass | AED 650/no — 5 mm silvered, polished edge, concealed fixing | `indicative` |
| 8 | Demolition rate | G7 | **Pre-signal only — no rate change** | Logged against `demo.*`; QS column decides | pre-signal |
| 9 | Extra tiles AED 3,000 | G22 | **Variation record** against the tiles actual | RAK cart 0000160602 unchanged | `actual_transaction`, `variation` |
| 10 | Staircase scope | G15 | **Scope clarification** — R-36 note corrected to LABOUR ONLY | Rate unchanged at AED 6,000 | — |
| 11 | Joinery coverage | G20 | **Checklist record** — `MUDON_JOINERY_COVERAGE` | Atrium QTN20261407 | — |

## What actually appears in the Mudon BoQ

Four new lines, AED 13,445, every one flagged:

| Rule | Section | Qty | Rate | Total | Flag |
|---|---|---|---|---|---|
| S6-02 / R-45 | Lighting | 32.30 lm | 85 | 2,745 | `indicative` |
| R-46 | Joinery | 3 no | 1,450 | 4,350 | `site_assessment` |
| R-47 | Aluminum & Glass | 2 no | 2,200 | 4,400 | `indicative` |
| R-48 | Aluminum & Glass | 3 no | 650 | 1,950 | `indicative` |

`indicative` now renders its own dot in the BoQ table — it had none before, so
these lines would have been invisible as pending review.

## Count rules, so they can be argued with

- **Spotlights** — `ceil(area / 3.5 m²)` per interior room, `derived`. The
  existing F-06 divisor, kept rather than re-picked. No drawing has been counted.
- **LED strip** — room perimeter for living / dining / majlis / master only,
  perimeter estimated from area at aspect 1.3.
- **Water heaters** — one per wet-room cluster, kitchens excluded. Reduces to 3.
- **Sockets** — type base + `floor(area / 6 m²)` where the type scales; wet rooms
  and circulation do not scale. **Switches** — one per room, plus a second for
  two-way in stairs and bedrooms.
- **Vanity slabs** — one per vanity in the joinery scope, not per room.
- **Shower glass** — per bathroom/ensuite (powder rooms excluded).
  **Mirrors** — `max(wet rooms, vanity units)`.

## 1. Sockets, switches and water heaters are priced twice today

Not by this work — it is pre-existing. The engine prices them (R-15, R-17) and
the P2 overlay section prices them again with no dedupe:

| Component | Rule line | Overlay line | Exposure |
|---|---|---|---|
| Sockets/switches | R-15, 58 no, AED 12,760 | `socket_13a` + `switch_1g` + `switch_2way`, 41 no | **AED 4,750** |
| Water heaters | R-17, 3 no, AED 15,000 | `water_heater`, 2 no @ 0 | AED 0 **today** |

The water-heater duplicate is free only because the overlay rate is
`0 / needs_qs`. Price it and the villa buys six heaters for three bathrooms.

Both pairs now surface **in the BoQ itself** as "duplicate detected, pending QS
scope ruling", with the duplicated amount named. Nothing is removed
automatically: which line survives depends on what each rate is meant to cover,
and that is a QS decision, not a developer one.

## 2. The delta — correcting my own earlier number

**I reported "+1.6% → +40.4%" as if the platform had moved. It had not.** Those
are two different comparisons, and the movement that phrasing implied does not
exist.

Column C of the Delta Log was never the platform's subtotal. Running the engine
at `2c79556` — the commit whose message is literally "reconcile delta table",
i.e. the moment column C was filled — gives a platform subtotal of
**AED 554,842** against column C's **460,470**. It was already 94,372 short on
the day it was written, because it was filled row-by-row against the
contractor's 14 SOW sections, and every platform line with no contractor
counterpart was simply never entered: DM/DEWA permits, skips, floor protection,
scaffold, handover clean, the sanitary INSTALL lines, the AC equipment, and
later the two P2 overlay sections.

So:

- **+1.6%** compares a partial mapping (460,470) with the contractor's actual.
- **+40.4%** compares the platform's FULL BoQ (636,440) with the same actual.

Neither is "the true number" until the scope basis is agreed. That is the first
thing Friday should settle.

### Genuine platform movement, and where every dirham of it goes

Engine at `2c79556` → the stored BoQ of 2026-09-05, before any S6-pre work:
**554,842 → 637,815, a movement of +82,973.** Every row attributes:

| Section | Then | 05-Sep | Δ | Attribution |
|---|---:|---:|---:|---|
| Plaster | 2,752 | 30,129 | **+27,377** | P4 element mapping replaced the engine's 15 % make-good with the full wall area — a definitional change, not a rate change |
| Sanitaryware | 38,000 | 60,510 | **+22,510** | `ba6b01c` powder room reclassified as a full wet room, 2→3 (38,000 ÷ 2 × 3 = 57,000) + `5cd2275` accessory set R-40…R-43 (3,510). Exact. |
| Demolition | 30,820 | 50,031 | **+19,211** | Element mapping took the quantity from the P4 wall area (555.9 m²), which itself moved with `fedbc88` true polygon perimeter and the A5 opening deductions |
| Plumbing | 38,400 | 57,600 | **+19,200** | `ba6b01c`, 2→3 wet rooms (38,400 ÷ 2 × 3 = 57,600). Exact. |
| Electrical Installations | — | 8,380 | **+8,380** | P2 overlay section, seeded from `plan_fixtures` after column C was filled |
| Plumbing & Sanitary | — | 6,440 | **+6,440** | P2 overlay section, same cause |
| Wall Finishes | 18,595 | 24,235 | **+5,640** | `ba6b01c` — a third wet room adds perimeter × height of tiling |
| Ceilings | 18,232 | 21,593 | **+3,361** | Element mapping: ceiling area from the P4 take-off (166.1 m²) |
| Decoration & Painting | 19,310 | 19,173 | −137 | Element mapping + A5 opening deductions |
| Floor Finishes | 73,479 | 44,470 | **−29,009** | Element mapping replaced separate material + labour lines with one 190/m² supply-and-install over 152.8 m²; partly offset by `5cd2275` stair tile (+15,438) |
| Blockwork · Electrical · MEP/HVAC · Lighting · Preliminaries · Joinery · Aluminum | | | **0** | unchanged |
| **Total** | **554,842** | **637,815** | **+82,973** | |

**Nothing is unattributed.** No existing rate was altered in the period — the
only rules added were R-40…R-44 (sanitary accessories, stair tile) and R-45…R-48
(S6-pre). The movement is entirely (a) the P4 element-mapping path taking over
quantity derivation, and (b) the powder room becoming a wet room.

### On demolition specifically

**Demolition has not moved at all relative to column C.** Column C shows 50,031;
today shows 50,031 — identical. My earlier note calling it "the largest
contributor" referred to the platform-vs-ACTUAL gap (50,031 against a 22,500
actual), not to any movement, and that phrasing invited exactly the wrong
reading.

It also shows column C is of **mixed vintage**: several of its rows match
today's lines exactly (demolition 50,031, civil works 15,000, flooring 29,032)
while its total corresponds to no single platform state. It cannot be read as a
point-in-time platform total, which is why it should be rebuilt on an agreed
scope basis rather than patched.

S6-pre itself adds **+13,445** on top, all four lines flagged.

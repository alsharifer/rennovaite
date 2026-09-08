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

## Two things to raise on Friday

**1. Sockets, switches and water heaters are priced twice today.** Not by this
work — it is pre-existing. The engine prices them (R-15, R-17) and the P2
overlay section prices them again with no dedupe:

| Component | Rule line | Overlay line | Exposure |
|---|---|---|---|
| Sockets/switches | R-15, 58 no, AED 12,760 | `socket_13a` + `switch_1g` + `switch_2way`, 41 no | **AED 4,750** |
| Water heaters | R-17, 3 no, AED 15,000 | `water_heater`, 2 no @ 0 | AED 0 **today** |

The water-heater duplicate is free only because the overlay rate is 0 /
`needs_qs`. Price it and the villa buys six heaters for three bathrooms.
`lib/boq/component-dedupe.ts` now detects both; **neither is fixed** — which
line to keep is a QS decision, not a developer one.

**2. The Delta Log's platform column is stale.** It shows AED 460,470 against a
453,228 actual, a +1.6% delta. Regenerating today gives **AED 636,440 — +40.4%**.
The +1.6% figure predates the current engine and should not be quoted on Friday.
**No rule was tuned toward the actual**, and none should be until the QS column
says which side is wrong. The largest single contributor is demolition, where
the platform prices AED 50,031 against a 22,500 actual — the same line G7 flags
as having run expensive.

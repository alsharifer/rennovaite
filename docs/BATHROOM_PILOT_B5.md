# Bathroom pilot B5 — a wet-room BoQ, options, a priced summary (19 Oct 2026)

Room sheet §3, §6, §7; dev test project `a2661f34` (the sheet's bathroom,
266 × 263 × 280, door S, window W, shower NE, WC + bidet on the W wall, vanity
SE, water heater N wall over the shower, curved bulkhead over the shower).
Migration **065** (`rooms.tiled_height_m`) — **dev only; push to production
before merging** (after 062–064).

## The audit — what the BoQ said, what a QS expects

Before B5 the pilot room's BoQ was **AED 202,645.35**: a villa's BoQ for one
bathroom. Two causes:

1. **The element take-off rebuilds six sections and drops what it doesn't
   measure.** Those sections are Demolition, Plaster, Floor, Wall, Ceilings and
   Painting. The engine's strip-out (Q-01–03), screed (Q-06), cove (Q-15) and
   ceiling paint vanish on EVERY take-off plan, villas included. The Demo villa
   has no Demolition section at all. It also painted every wall, tiled or not.
2. **The engine prices a villa.** It carries whole-home allowances (civil
   works 15,000, the aluminium & glazing package ~93,000, doors), per-bathroom
   Mudon lumps (a full re-pipe, a new concealed heater, a wall-hung WC) and
   villa-sized preliminaries.

| QS expects | before B5 | B5 |
|---|---|---|
| Preliminaries | villa: site set-up 12,000, permits 6,000, scaffold 2,500, clean 1,500 + skip + floor protection | one room: protection + dust screens 1,200 (R-49), community NOC **TBC**, skip 1,500, floor protection 56, final clean 400 (R-51) |
| Demolition & strip-out | **missing** (dropped by the take-off) | wall tiles 27.53 m² (R-03), floor 7.00 m² (R-02), sanitaryware + vanity + mirror + accessories by area (R-01), shower screen (R-52), ceiling finish 7.00 m² (R-53, site assessment) |
| Ceiling repair (leak unknown, flagged) | new gypsum ceiling 7 m² × 130 | repair 7.00 m² × 45 (R-54) — **allowance, "is the leak fixed?"** on the Issues navigator; bulkhead made good with it |
| Waterproofing (floor + upstand, shower walls to 2.0 m) | **missing** | new section: floor 7.00 + (10.58 − 0.87) × 0.15 = **8.46 m²**; shower walls (1.41 + 0.91) × 2.0 = **4.64 m²** (R-55), both from the plan |
| Floor 7.0 + wall tiling ≈ 27.5 net (per-room H) | 7.00 + 27.53 ✓ | unchanged ✓ + screed to falls 7.00 m² (R-05, was dropped) |
| Shower: frameless glass, rain + hand shower, lit niche, drain | glass 1 × 2,200; shower set; drain | glass = **2 panels** (the footprint's two open sides); shower set; **lit niche** (R-56); linear drain (R-18) |
| WC floor-standing base; wall-hung + concealed cistern **option** | wall-hung WC in the base + actuator | floor-standing WC (R-57) base; wall-hung = **option** (R-19 + R-43 + duct wall R-63 − the floor-standing WC) |
| Bidet; basin + mixer | bidet point **0, to be priced** (B1) | bidet (R-58) + bidet point **650** (as the basin point); basin + brass mixer (R-20) |
| Vanity: floating, stone top, open shelf | MR melamine box + bath cabinet with doors + slab | floating vanity (GT, Mudon) + stone top (S6-05); **no cabinet** |
| Backlit mirror | plain mirror 650 | backlit LED mirror (R-59) |
| Electrical: downlights, cove LED, mirror light, shaver, extractor | 2 downlights + 3 points | IP65 downlights; switches + spurs (lights, cove, mirror backlight); **shaver point** (R-60); **extractor** (R-61); **cove** on the bulkhead's open edges 2.32 lm (R-45 supply + R-31 labour) |
| Plumbing reconnections (no relocation) | full PPR re-pipe 7,500 + new concealed heater 2,800 | **no re-pipe**: the P2 points (WC, basin, shower, drain, bidet) are the reconnections |
| Painting by rule | wall paint 27.52 m² **on tiled walls**; no ceiling paint | wall paint **0, stated** (tiled to the ceiling); ceiling paint 7.00 m² (R-13) |
| Water heater box-in / relocation | (the heater's overlay line: "supply & install" TBC) | box-in or relocate allowance (R-62) at its plan position "N wall"; **confirm on site** |
| Skirting = 0 stated | absent | **0, stated**: "none — the walls are tiled from the floor" |
| Bath fixture type | bath point TBC | bath point **750** (as the shower mixer point); bath line (R-65 labour book) when one is on the plan |

**Not in a bathroom's BoQ, so removed:** civil alterations (Q-05), the
aluminium & glazing allowance (the window stays, §7 item 6), door leaf and
frame (the door stays), bath cabinet, scaffold.

**Plaster** stays at 27.52 m², re-described as substrate making-good after tile
removal, to receive the membrane and tiles. Ruling below.

## The rules

**Painting by rule (all projects).** Each room has a `tiled_height_m` (065):
null means the type default, full height for a wet room. The element take-off
now does two things:
- **Wet tiling** runs up to the tiled height, net of each opening's part
  inside that band.
- **Wall paint** is measured only above the tiled height, on walls that bound
  only wet rooms (the take-off counts one face per wall; a wall with a dry room
  on it keeps its painted face). At full height that is zero, and the line
  says so.

It is editable on 01 Plan ("Tiled height", `PATCH /api/plan-tiling`, a
`design_edit` on layer "tiling"). The revision cause reads "Tiled height —
Bathroom full height → 1.20 m", and Regenerate says "Tiled height changed
since rev N". A 1.20 m dado moves both lines together (tested).

**The wet-room package** (`lib/boq/wet-room.ts`). It applies only when the
plan came from "One room from its dimensions" and that room is a bathroom,
ensuite or powder room. Villa bathrooms are unchanged until R10. It runs
after the joinery pass, and every added line prices through the engine's own
resolver (`priceScopeItem`): its rule, tier, provenance and a firm's own rate.
Fourteen allowance rules (R-49, R-51–R-65) carry their reasoning in
`rules.ts`, the QS review surface. One line has no figure in any book (the
community NOC): it is **TBC at 0**, named in the headline and on the Issues
navigator, never inside the total.

**Rate basis.** Every line of the package's document carries `rate_basis`:
- **calibrated** — Mudon / Villa 94: the GT joinery, R-40–R-43 accessories,
  R-30/31/35/36/44;
- **market** — the labour book, the take-off and point constants;
- **allowance** and **TBC**.

The pilot: calibrated 5 lines (AED 2,624.40), market 21 (24,573.50),
allowance 18 (16,248.20), TBC 1.

## The price

| | AED |
|---|---|
| Subtotal (14 sections, 45 lines) | 43,446.10 |
| Contingency 8 % | 3,475.69 |
| VAT 5 % | 2,346.09 |
| **Total** | **49,267.88** — excludes 1 line to be priced (community NOC) |
| Option: wall-hung WC with concealed cistern | net 2,450.00 → **+ 2,778.30** incl. contingency + VAT |
| Option: remove the bulkhead over the shower | net 798.40 → **+ 905.38** incl. contingency + VAT |

Every line multiplies out (qty × rate = amount), every section adds up, and the
chain reconciles to the fil. The only zero lines are the two stated zeros and
the TBC. Options are never inside the total: each option's delta runs through
the BoQ's own chain (OH&P, contingency, VAT) after OH&P.

**Where it shows:**
- **BoQ page:** the rate-basis line and the Options panel under the summary
  chain, and the Issues navigator ("NOT PRICED — LEFT OUT OF THE TOTAL", plus
  "ALLOWANCE — CONFIRM ON SITE" for the ceiling and the heater).
- **BoQ PDF (owner, 68:1396):** a one-page summary. It holds the sections, the
  chain, the options with "total moves by", the to-be-priced line and the rate
  basis, and each line names its basis under its description.
- **Proposal (a firm's client):** the options under the price summary, with no
  rate provenance.

The PDF and the proposal read the **same stored revision** (checked).

## Regression

- **Arabella (garden):** dry run byte-identical (116,679.56).
- **Dev Demo villa:** B5's own move is the wet-wall paint, 426.95 → 391.45 m²
  (−1,242.50). The skirting (+7,909) and staircase (+6,000) lines in the same
  diff are #117 / #107, landing on a stored 12 Oct revision.
- **Mudon P4 golden:** the same 35.5 m² of wet-wall paint leaves (snapshot
  updated; grand 386,131.59 → 384,722.59).

## Rulings for Abdallah (QS read)

1. **Allowance figures** (R-49 to R-64) are judgement figures, each with its
   note. Please confirm or correct them, above all the floor-standing WC
   1,600, bidet 1,400, backlit mirror 1,400, niche 950, extractor 650,
   heater box-in 900 and membrane 50/m².
2. **Plaster under tiles:** the 27.52 m² × 55 line is kept as making good the
   substrate after tile removal. Is that in the tiling rate (then remove it),
   or right as a line?
3. **Shattaf with a bidet:** both are kept (the client keeps the bidet;
   shattaf R-40 is calibrated). Drop the shattaf?
4. **The systemic drop on villas.** Every villa BoQ priced by the element
   take-off still has no Demolition section, screed, cove or waterproofing.
   Mudon's +1.6 % calibration was measured with that drop, so restoring it
   moves Mudon. This is a follow-up with a measured Mudon delta — not done
   here.

## Checks

- `lib/boq/__tests__/wet-room.test.ts`: the painting rule (full height and a
  dado), the footprint against the walls, every removal and addition, stated
  zeros, every line multiplies out, the basis, the options.
- `scripts/b5-bathroom-boq.ts`: in-process dump with the checks; nothing is
  written.
- Live `node --env-file=.env.local --experimental-transform-types --import
  ./scripts/_alias-hook.mjs scripts/b5-bathroom-check.ts [port]`: regenerate
  → the stored revision → the BoQ page (axe light + dark) → the BoQ PDF
  through a verification job → the proposal shape from the same revision.
  41/41.

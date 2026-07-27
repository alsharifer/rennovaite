# QS Pack Validation — against the real Villa 94 renovation documents

Engine v0.1.0 pack (`QS_REVIEW_PACK.md`) reviewed against the signed-scope documents for
**Al Naseem F2, Villa 94, Mudon** (Newspace FZ L.L.C, SOW-R02, June 2026): 43-page Scope of
Work, RAK Tiles BoQ (cart 0000154374), Grohe/Laspinas sanitary quotation 46703, and the
Rev-00 shop drawings (dimensions, flooring, walls, drainage, water supply, power, RFC,
skirting).

**Verdict: the engine's architecture is validated — labour/material split, POMI-style
sectioning, per-line sourcing, and VAT chain all mirror how the real contract is
structured. But the v0.1 scope preset models a much smaller job than a real Mudon
first-floor renovation. Roughly half the real contract value sits in work sections the
engine doesn't generate at all.**

Real commercials for calibration: contract **AED 236,500 → AED 200,000 after a 36,500
discount (15.4%) → AED 210,000 incl. 5% VAT**, labour-only (tiles, sanitary, lighting,
sockets/switches, joinery, glass, aluminium all client-supplied). Client-side materials
so far: tiles ≈ AED 28,360 (177.7 m², RAK), sanitary ≈ AED 9,644 incl. VAT (Grohe, 3
bathrooms). 12-week programme, 7 phases, milestone payments.

---

## 1. Fixture corrections (rooms)

| Engine fixture (assumed) | Reality (SoW + flooring shop drawing) |
|---|---|
| 2 bathrooms | **3 bathrooms** — Master, Kids Bath 1, Kids Bath 2 (CLAUDE.md's "2 bathrooms" is wrong too) |
| 3 bedrooms = 48 m² | 3 bedrooms = **60–61 m²** (FL-01 parquet-effect porcelain, 61 m²) |
| Living 30 m² | Living **34–35 m²** (FL-02, 34 m²) |
| No corridor / stairs / storage | Corridor exists; staircase tiled at 45°; **new storage room** built |
| No terrace / office | **Terrace balcony + office ≈ 70 m²** tiling, office 20 m² |
| Interior total 89 m² | Interior ≈ **140 m²**; protected tiled area incl. terrace ≈ **210 m²** |
| Bath floors ~5.5–6 m² each | Confirmed ✓ (FL-02 9.3 m² + travertine 8.7 m² ≈ 18 m² / 3 baths) |

## 2. Measurement-convention corrections

- **C-04 bathroom tile height 2.4 m → FULL HEIGHT.** SoW 3.3 specifies full-height wall
  tiling. Bathroom wall+floor tiling = **90 m² for 3 baths** vs engine's 41.9 m² for 2.
- **F-04 skirting**: real = **90 lm** (incl. corridor) vs engine 66.7 lm — corridor and
  tile-matched skirting (8 mm profile) missing from take-off.
- **Q-01/Q-02 demolition is understated in kind, not just size**: real strip-out includes
  ceilings, doors, door frames, built-in cabinets, sanitary ware, drainage break-out and
  chasing, staircase handrail, terrace tiles, and furniture relocation + temporary
  protective partition. Engine models tiles-off-floors only.
- Quantities marked TBC in the SoW are measured from shop drawings — confirms the
  engine's plan-derived take-off approach is the right long-term design.

## 3. Missing work sections (the big finding)

Engine v0.1 generates none of the following, which together are ≈ AED 100k+ of the real
AED 236.5k pre-discount price:

| Real scope | Real price (AED) | Engine v0.1 |
|---|---|---|
| Gypsum false ceilings throughout, 130 m² + 120 lm LED cove | 21,000 | — missing |
| HVAC: 2 new ducted units + full ductwork + grilles + thermostats + office split | 31,500 | 1,400 (FCU cleaning only) |
| Civil works: close/open door openings, new walls, storage room blockwork | 15,000 | — (Blockwork section never fires) |
| Staircase: tread tiles @45°, LED nosing strips, circuit | 6,000 | — missing |
| Terrace: waterproofing membrane + screed-to-falls + tiling | 6,000 | — (waterproofing already a known gap) |
| Master bathroom builds: tiled twin-sink unit, new partition | 10,000 | — missing |
| Scaffold hire, floor protection 210 m², furniture relocation, handover clean | in prelims (27.5k) | partially (24k ✓ close) |

## 4. Rate calibration (engine bands vs implied real rates)

| Item | Engine (mid) | Real implied | Note |
|---|---|---|---|
| Tiling labour (floor+wall, incl. skirting) | 70/m² floor, 85/m² wall | **≈ 120/m²** blended (30.5k / ~255 m²) | Real premium job sits at/above engine's *high* band |
| Electrical fit-out | 10.4k built-up | **25k** (≈ 180/m² interior) | First-fix chasing + cove circuits dominate; engine's per-point model too thin |
| Painting + plastering | 8.1k | **21.5k** | Real includes full plaster prep lump + scaffold hire |
| Demolition | 11.4k | **22.5k** | See §2 — kind understated |
| Sanitary + plumbing install (per bath, incl. full PPR re-pipe) | ~18.7k/bath supply+install | **≈ 6.7k/bath install-only** + ~3.2k/bath client materials (Grohe) | Engine's supply+install bands overstate when client supplies; needs a "client-supplied" mode |
| Preliminaries | 24,000 | **27,500** | ✓ within 13% — best-calibrated section |
| Floor tile material (premium) | 137/m² (RAK 60×120) | **281/m²** (RAK 120×120 large-format) | Premium tier percentile 0.8 underpicks real premium taste; blended real tile spend ≈ 160/m² |
| VAT 5% | ✓ | ✓ | Matches |
| Contingency 8% | in estimate | not in contract (fixed lump sum instead) | Keep for client-side planning; label it as such |

## 5. Commercial-model lessons for RennovAIte

1. **The real contract is labour-only; materials are client-procured.** The engine's
   labour/material line split maps to this perfectly — add a `procurement: "contractor" |
   "client"` flag per line so a BoQ can be presented both ways (all-in estimate vs
   contractor-scope price + client shopping list).
2. **Negotiation margin is real**: 15.4% discount off the opening price. Engine output
   should be framed as *pre-negotiation market estimate*.
3. **Payment schedule mirrors phases** (20% down, 10–11% per milestone, 5% retention at
   handover) and the 7-phase / 12-week programme is exactly the Gantt structure the
   orchestration layer should emit — phases map 1:1 to engine work sections.
4. Standard exclusions to model explicitly: joinery/glass/aluminium as separate scopes,
   structural fees/NOCs, low-voltage/smart-home, summer outdoor-hours restriction on
   terrace works.

## 6. Recommended engine changes (v0.2)

1. Fixture: 3 bathrooms, bedroom areas from FL drawing, add corridor, staircase, storage,
   terrace + office as room types; update CLAUDE.md canonical villa description.
2. C-04: bathroom tiling full height (wall height 2.9 m), not 2.4 m.
3. New quantity rules: gypsum false ceiling (≈ 0.9 × interior floor area) + LED cove lm;
   ducted-AC replacement per bedroom-bathroom pair (not FCU cleaning); terrace
   waterproofing + screed-to-falls; staircase treads + nosing LED; civil
   opening-alteration items; scaffold + floor-protection + furniture-relocation prelims;
   final handover clean.
4. New labour-rate rows needed in `labour-rates.csv` for: gypsum ceiling /m², LED cove
   /lm, ducted AC unit installed /no, waterproofing /m², staircase treads /no, wall
   opening alteration /no. (Current CSV has no ceiling section at all.)
5. Rate bands: shift tiling labour and electrical toward the real figures above; add
   `procurement` flag; raise premium SKU percentile or price-floor it (~0.9).
6. Contingency stays, but rendered as "client planning buffer — not part of contractor
   lump sum".

## 7. What the real documents confirm the engine got right

POMI-style work sections match how the contractor itemises. Labour/material separation
matches the client-supply model. Preliminaries within 13%. Per-bathroom counting logic
(WC / vanity / shower / re-pipe / drain per bathroom) matches SoW sections 7, 16, 17
line-for-line. Bath floor areas confirmed. VAT chain correct. Skip/waste, daily clean,
permits all present in both. The deterministic, rule-ID'd structure is exactly the right
review surface — this document is itself the proof it can absorb real-project
corrections.

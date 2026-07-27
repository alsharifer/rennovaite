# RennovAIte — QS Review Pack

Deterministic BoQ engine v0.2.0 · generated 2026-07-03 · pilot: Mudon Al Naseem F2, Villa 94, first-floor renovation · style: contemporary-majlis (tier mid, porcelain flooring)

Every quantity, rate, and factor below is produced by a rules engine (no AI in the pricing path). Each carries a rule ID. **We are asking you to mark up: (a) wrong or missing factors, (b) wrong measurement conventions, (c) unrealistic rates, (d) missing line items.** Corrections are applied to the rules table and the whole model re-prices.

v0.2 is calibrated against the real Villa 94 project documents (signed Scope of Work, tile BoQ, sanitary quotation, Rev-00 shop drawings) — see `QS_PACK_VALIDATION.md` for the full derivation.

## 1. Rooms (calibrated to Villa 94 shop drawings + SoW)

| Room | Type | Area m² |
|---|---|---|
| Master Bedroom | master_bedroom | 24 |
| Kids Bedroom 1 | bedroom | 18.5 |
| Kids Bedroom 2 | bedroom | 18.5 |
| Master Bathroom | bathroom | 8.7 |
| Kids Bathroom 1 | bathroom | 4.7 |
| Kids Bathroom 2 | bathroom | 4.6 |
| Family Living Area | living | 34 |
| Corridor | corridor | 12 |
| Storage Room (new) | storage | 4 |
| Office (build-out) | office | 20 |
| Terrace Balcony | terrace | 50 |
| **Total** | | **199** |

## 2. Constants and factors under review

| ID | Constant | Value | QS correction |
|---|---|---|---|
| C-01 | Wall height (slab to ceiling) | 2.9 m | |
| C-02 | Door opening | 0.9 × 2.1 m | |
| C-03 | Window deduction, dry rooms | 8% of gross wall | |
| C-04 | Bathroom tile height (full height per Villa 94 SoW §3.3) | 2.9 m | |
| C-06 | Debris volume proxy | 0.2 m³/m² | |
| C-07 | Skip capacity | 4.5 m³ | |
| W-01 | Floor tile wastage | 10% | |
| W-02 | Engineered wood wastage | 8% | |
| W-03 | Wall tile wastage | 12% | |
| F-05 | Plaster make-good share of net wall | 15% | |
| F-12 | Gypsum ceiling coverage of interior area | 90% | |
| F-13 | LED cove lm per m² of dry interior | 0.85 | |
| P-01 | Contingency (client planning buffer) | 8% | |
| P-02 | VAT | 5% | |

Tier policy: labour band by tier = {"value":"low","mid":"mid","premium":"high"}; SKU price percentile by tier = {"value":0.25,"mid":0.5,"premium":0.8}; style→tier = {"scandi-arabic":"value","coastal-emirati":"value","contemporary-majlis":"mid","modern-hijazi":"mid","andalusian-heritage":"premium","luxe-minimal":"premium"}; style→flooring override = {"scandi-arabic":"engineered_wood","coastal-emirati":"engineered_wood"} (default porcelain).

## 3. Quantity take-off (with derivations)

| ID | Section | Item | Qty | Unit | Derivation | QS correction |
|---|---|---|---|---|---|---|
| Q-01 | Demolition | Full soft strip — finishes, ceilings, doors, cabinets, sanitary ware (no structural) | 199 | m2 | total floor area incl. terrace = 199 m² | |
| Q-02 | Demolition | Existing floor finish removal — all areas incl. terrace | 199 | m2 | total floor area = 199 m² | |
| Q-03 | Demolition | Bathroom wall tile removal — full height | 78.69 | m2 | F-03: Σ bath (perimeter × 2.9 m − door) = 78.69 m² | |
| Q-04 | Plaster | Plaster make-good / skim after strip-out | 58.24 | m2 | F-05: interior net wall 388.27 m² × 0.15 = 58.24 m² | |
| Q-05 | Blockwork | Civil alterations — opening closures/openings, new partitions, storage room | 1 | project | allowance pending design layout (R-35) | |
| Q-06 | Floor Finishes | Floor screed 50mm incl. falls — wet areas + terrace | 68 | m2 | bath floors 18 + terrace 50 m² | |
| Q-07 | Floor Finishes | Waterproofing membrane — terrace | 50 | m2 | terrace area = 50 m² | |
| Q-08 | Floor Finishes | Porcelain floor tiling — labour | 199 | m2 | total floor area = 199 m² (porcelain throughout incl. wet areas + terrace) | |
| Q-09 | Floor Finishes | Porcelain floor tiling — material supply | 199 | m2 | net laid area; wastage added at pricing per W-01/W-02 | |
| Q-10 | Floor Finishes | Skirting — tile-matched, dry rooms + terrace | 142.38 | lm | F-04: Σ (dry + terrace) perimeter − door widths = 142.38 lm | |
| Q-11 | Floor Finishes | Staircase renovation — tread tiling + LED nosing (excl. handrail) | 1 | project | allowance (R-36); treads TBC from stair drawing | |
| Q-12 | Wall Finishes | Bathroom wall tiling — full height, labour | 78.69 | m2 | F-03 (as Q-03) = 78.69 m² | |
| Q-13 | Wall Finishes | Bathroom wall tile — material supply | 78.69 | m2 | net tiled area; wastage per W-03 | |
| Q-14 | Ceilings | Gypsum false ceiling incl. plastering + painting — all interior rooms | 134.1 | m2 | F-12: interior area 149 m² × 0.9 = 134.1 m² | |
| Q-15 | Ceilings | Continuous LED cove channel within gypsum ceiling | 111.35 | lm | F-13: dry interior area 131 m² × 0.85 = 111.35 lm | |
| Q-16 | Decoration & Painting | Internal painting — walls + ceilings, 2 coats | 456.42 | m2 | F-02: dry (net wall + ceiling) + bath ceilings = 456.42 m² | |
| Q-17 | Electrical | LED downlights — supply and install (interior) | 48 | no | F-06: Σ interior ceil(area / 3.5) = 48 | |
| Q-18 | Electrical | Power sockets and switches — supply and install (interior) | 63 | no | F-07: Σ interior ceil(area × 0.4) = 63 | |
| Q-19 | Plumbing | Bathroom plumbing re-pipe (full PPR) — per bathroom | 3 | no | bathroom count = 3 | |
| Q-20 | Plumbing | Concealed water heater — supply and install | 3 | no | 1 per bathroom × 3 (Villa 94 retained existing heaters — QS to confirm inclusion) | |
| Q-21 | Plumbing | Floor / linear shower drain — install | 3 | no | 1 per bathroom × 3 | |
| Q-22 | Sanitaryware | Wall-hung WC incl. concealed cistern — install | 3 | no | 1 per bathroom × 3 | |
| Q-23 | Sanitaryware | Vanity basin with mixer — install | 3 | no | 1 per bathroom × 3 | |
| Q-24 | Sanitaryware | Shower system with concealed thermostatic valve — install | 3 | no | 1 per bathroom × 3 | |
| Q-25 | MEP / HVAC | New ducted AC unit incl. ductwork, grilles, thermostat — secondary bedrooms | 2 | no | F-15: 1 per secondary bedroom × 2 | |
| Q-26 | MEP / HVAC | Split AC unit (2 ton) — office, incl. commissioning | 1 | no | F-16: 1 per office × 1 | |
| Q-27 | MEP / HVAC | FCU deep service and clean — retained units | 2 | no | rooms retaining existing FCU = 2 | |
| Q-28 | Joinery & Carpentry | Built-in wardrobes — bedrooms | 8.4 | lm | F-08: master 3.6 lm + secondary 2.4 lm each = 8.4 lm | |
| Q-29 | Joinery & Carpentry | Bathroom vanity with quartz top | 3 | no | 1 per bathroom × 3 | |
| Q-30 | Joinery & Carpentry | Internal doors — supply and hang | 6 | no | F-10: bedrooms 3 + bathrooms 3 = 6 | |
| Q-31 | Lighting | Decorative pendants — installation | 5 | no | F-09: 1 per bedroom (3) + 2 living = 5 | |
| Q-32 | Preliminaries | Site setup, hoarding, protection, daily clean | 1 | project | lump sum per project | |
| Q-33 | Preliminaries | DM / DEWA permits and fees | 1 | project | lump sum per project | |
| Q-34 | Preliminaries | Skip hire and waste disposal | 9 | no | F-11: ceil(199 × 0.2 ÷ 4.5) = 9 skips | |
| Q-35 | Preliminaries | Protective floor covering over new tiling until handover | 199 | m2 | F-14: total floor area = 199 m² | |
| Q-36 | Preliminaries | Rolling scaffold hire — ceiling + painting works | 1 | project | lump sum per project | |
| Q-37 | Preliminaries | Final clearance + professional handover clean | 1 | project | lump sum per project | |

## 4. Priced Bill of Quantities

### Demolition — AED 24,413

| Item | Qty | Unit | Rate AED | Total AED | Source | Band | QS correction |
|---|---|---|---|---|---|---|---|
| Full soft strip — finishes, ceilings, doors, cabinets, sanitary ware (no structural) | 199 | m2 | 40 | 7,960 | labour_rates: Soft strip — carpets, fixtures, fittings removal (no structural) | mid | |
| Existing floor finish removal — all areas incl. terrace | 199 | m2 | 55 | 10,945 | labour_rates: Floor tile removal — intact substrate | mid | |
| Bathroom wall tile removal — full height | 78.69 | m2 | 70 | 5,508 | labour_rates: Wall tile removal — bathroom | mid | |

### Blockwork — AED 15,000

| Item | Qty | Unit | Rate AED | Total AED | Source | Band | QS correction |
|---|---|---|---|---|---|---|---|
| Civil alterations — opening closures/openings, new partitions, storage room | 1 | project | 15,000 | 15,000 | allowance | allowance | |

### Plaster — AED 2,038

| Item | Qty | Unit | Rate AED | Total AED | Source | Band | QS correction |
|---|---|---|---|---|---|---|---|
| Plaster make-good / skim after strip-out | 58.24 | m2 | 35 | 2,038 | labour_rates: Internal skim or smoothing coat | mid | |

### Floor Finishes — AED 64,330

| Item | Qty | Unit | Rate AED | Total AED | Source | Band | QS correction |
|---|---|---|---|---|---|---|---|
| Floor screed 50mm incl. falls — wet areas + terrace | 68 | m2 | 60 | 4,080 | labour_rates: Floor screed 50mm | mid | |
| Waterproofing membrane — terrace | 50 | m2 | 50 | 2,500 | allowance | allowance | |
| Porcelain floor tiling — labour | 199 | m2 | 70 | 13,930 | labour_rates: Porcelain floor tiling — labour only | mid | |
| Porcelain floor tiling — material supply | 218.9 | m2 | 137 | 29,989 | RAK Ceramics — RAK-MRB-MAXIMUSC-60X120 | sku (+10% wastage) | |
| Skirting — tile-matched, dry rooms + terrace | 142.38 | lm | 55 | 7,831 | labour_rates: Skirting installation (MDF or wood) | mid | |
| Staircase renovation — tread tiling + LED nosing (excl. handrail) | 1 | project | 6,000 | 6,000 | allowance | allowance | |

### Wall Finishes — AED 15,238

| Item | Qty | Unit | Rate AED | Total AED | Source | Band | QS correction |
|---|---|---|---|---|---|---|---|
| Bathroom wall tiling — full height, labour | 78.69 | m2 | 85 | 6,689 | labour_rates: Ceramic or porcelain wall tiling — bathroom, labour only | mid | |
| Bathroom wall tile — material supply | 88.13 | m2 | 97 | 8,549 | RAK Ceramics — RAK-MRB-CALACATT-60X60 | sku (+12% wastage) | |

### Ceilings — AED 21,774

| Item | Qty | Unit | Rate AED | Total AED | Source | Band | QS correction |
|---|---|---|---|---|---|---|---|
| Gypsum false ceiling incl. plastering + painting — all interior rooms | 134.1 | m2 | 125 | 16,763 | allowance | allowance | |
| Continuous LED cove channel within gypsum ceiling | 111.35 | lm | 45 | 5,011 | allowance | allowance | |

### Decoration & Painting — AED 13,693

| Item | Qty | Unit | Rate AED | Total AED | Source | Band | QS correction |
|---|---|---|---|---|---|---|---|
| Internal painting — walls + ceilings, 2 coats | 456.42 | m2 | 30 | 13,693 | labour_rates: Internal painting — 2 coats over prepared surface | mid | |

### Joinery & Carpentry — AED 50,520

| Item | Qty | Unit | Rate AED | Total AED | Source | Band | QS correction |
|---|---|---|---|---|---|---|---|
| Built-in wardrobes — bedrooms | 8.4 | lm | 1,800 | 15,120 | labour_rates: Built-in wardrobe — mid-range MDF with lacquer or melamine | mid | |
| Bathroom vanity with quartz top | 3 | no | 7,000 | 21,000 | labour_rates: Vanity cabinet with quartz top — bathroom | mid | |
| Internal doors — supply and hang | 6 | no | 2,400 | 14,400 | labour_rates: Flush internal door — supply and fit | mid | |

### Electrical — AED 17,460

| Item | Qty | Unit | Rate AED | Total AED | Source | Band | QS correction |
|---|---|---|---|---|---|---|---|
| LED downlights — supply and install (interior) | 48 | no | 180 | 8,640 | labour_rates: LED downlight — supply and install | mid | |
| Power sockets and switches — supply and install (interior) | 63 | no | 140 | 8,820 | labour_rates: Power socket or switch — supply and install | mid | |

### Plumbing — AED 32,850

| Item | Qty | Unit | Rate AED | Total AED | Source | Band | QS correction |
|---|---|---|---|---|---|---|---|
| Bathroom plumbing re-pipe (full PPR) — per bathroom | 3 | no | 7,500 | 22,500 | labour_rates: Bathroom plumbing rewire — per bathroom, full | mid | |
| Concealed water heater — supply and install | 3 | no | 2,800 | 8,400 | labour_rates: Concealed water heater — supply and install | mid | |
| Floor / linear shower drain — install | 3 | no | 650 | 1,950 | labour_rates: Floor drain — supply and install | mid | |

### Sanitaryware — AED 23,100

| Item | Qty | Unit | Rate AED | Total AED | Source | Band | QS correction |
|---|---|---|---|---|---|---|---|
| Wall-hung WC incl. concealed cistern — install | 3 | no | 2,400 | 7,200 | labour_rates: WC suite supply and install — mid-range | mid | |
| Vanity basin with mixer — install | 3 | no | 1,800 | 5,400 | labour_rates: Wash basin with mixer — supply and install | mid | |
| Shower system with concealed thermostatic valve — install | 3 | no | 3,500 | 10,500 | labour_rates: Shower system — mixer, handset, rain head | mid | |

### MEP / HVAC — AED 34,200

| Item | Qty | Unit | Rate AED | Total AED | Source | Band | QS correction |
|---|---|---|---|---|---|---|---|
| New ducted AC unit incl. ductwork, grilles, thermostat — secondary bedrooms | 2 | no | 14,000 | 28,000 | labour_rates: Concealed ducted AC FCU replacement | mid | |
| Split AC unit (2 ton) — office, incl. commissioning | 1 | no | 5,500 | 5,500 | labour_rates: Split AC unit (1.5-2.5 ton) — supply and install | mid | |
| FCU deep service and clean — retained units | 2 | no | 350 | 700 | labour_rates: AC servicing and cleaning | mid | |

### Lighting — AED 1,400

| Item | Qty | Unit | Rate AED | Total AED | Source | Band | QS correction |
|---|---|---|---|---|---|---|---|
| Decorative pendants — installation | 5 | no | 280 | 1,400 | labour_rates: Decorative pendant — installation labour only | mid | |

### Preliminaries — AED 37,092

| Item | Qty | Unit | Rate AED | Total AED | Source | Band | QS correction |
|---|---|---|---|---|---|---|---|
| Site setup, hoarding, protection, daily clean | 1 | project | 12,000 | 12,000 | labour_rates: Site setup, protection, daily clean — residential first-floor refit | mid | |
| DM / DEWA permits and fees | 1 | project | 6,000 | 6,000 | labour_rates: Permit and DM/DEWA fees — typical first-floor refit | mid | |
| Skip hire and waste disposal | 9 | no | 1,500 | 13,500 | labour_rates: Skip hire and waste disposal | mid | |
| Protective floor covering over new tiling until handover | 199 | m2 | 8 | 1,592 | allowance | allowance | |
| Rolling scaffold hire — ceiling + painting works | 1 | project | 2,500 | 2,500 | allowance | allowance | |
| Final clearance + professional handover clean | 1 | project | 1,500 | 1,500 | allowance | allowance | |

### Summary

| | AED |
|---|---|
| Subtotal | 353,108 |
| Contingency 8% | 28,249 |
| VAT 5% | 19,068 |
| **Grand total** | **400,425** |

### Cross-check against the real Villa 94 contract

Engine (all-in: labour + materials, pre-negotiation, mid tier) AED 353k subtotal vs real contract AED 236.5k labour-only pre-discount + client-supplied materials (tiles ≈28.4k, sanitary ≈9.6k, plus lighting/joinery/glass/handrail as separate scopes). Directly comparable sections: Ceilings 21.8k vs 21.0k · MEP/HVAC 34.2k vs 31.5k · Demolition 24.4k vs 22.5k · Civil 15k vs 15k · Terrace 6.6k + staircase 6k vs 6k + 6k. Sanitary, plumbing, and joinery run high because the engine prices supply+install where the real contract is install-only — the v0.3 procurement flag addresses this.

## 5. Known gaps and allowances (flagged, not hidden)

- Individual bedroom/bathroom area splits are estimates within document-confirmed totals (bedrooms 61 m², bath floors ≈ 18 m², living 34 m²).
- Allowance-rated items (no labour_rates row yet — QS to confirm): gypsum ceiling 125/m², LED cove 45/lm, terrace waterproofing 50/m², civil alterations 15,000 lump, staircase 6,000 lump, floor protection 8/m², scaffold 2,500, handover clean 1,500.
- Engineered-wood supply is an allowance (no seeded SKU): 180 AED/m².
- Water heaters included 1/bathroom; Villa 94 retained existing units — confirm convention.
- No bathtub line — preset assumes shower-only bathrooms (matches Villa 94).
- Doors/wardrobes/vanities priced supply+install; in the real contract joinery is a separate client scope — a procurement flag (contractor vs client) is the planned v0.3 change.
- Real-project calibration: tiling labour ≈120/m² blended and electrical ≈180/m² interior imply the CSV mid bands are low for premium jobs — rates are QS-review items, not engine constants.
- Skirting take-off (142 lm) exceeds the SoW's 90 lm — wardrobe walls and full-height joinery reduce real skirting runs; QS to advise the deduction convention.

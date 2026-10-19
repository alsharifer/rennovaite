# Bathroom pilot B9 — pricing credibility before the itemised quote (report, 19 Oct 2026)

Dev test project `a2661f34` (the pilot bathroom). The client's contractor gave
a single total for this bathroom, with no sections and no lines. That is a
**benchmark**: it can say whether the engine is higher or lower, never which of
the allowance lines is wrong. Line-by-line review waits for the itemised quote
(step 5). Script: `scripts/b9-pricing.ts`; migration **066**.

## 1 · Frozen: rev 14 is the pre-comparison snapshot

`boq_snapshots` (066) holds:
- **The revision:** `purpose` pre_comparison, `boq_id` b07e4ca8 — rev 14,
  AED 38,778.38.
- **Its pricing fingerprint and a copy of its document.**
- **Snapshot id:** 3ceb1981-f49d-4583-91e3-6984580307c1.

Revisions are append-only already. The snapshot records WHICH revision a
contractor's figure is compared against, so the rev 15 conversion below cannot
blur it.

`--freeze` refuses:
- a second snapshot;
- any revision other than the one named (`--expect=38778.38`).

## 2 · Benchmarks — logged as benchmarks, never as ground truth

`boq_outcomes` gains `kind` (ground_truth | benchmark), `label`, `scope` and
`platform_snapshot_id` (066). Every earlier row stays ground_truth.

Before a total is compared, it is normalised (`lib/boq/benchmark.ts`
`compareBenchmark`, pure):
- **The engine's side.** The total is subtotal + 8 % contingency + 5 % VAT, and
  excludes the community NOC fee (a TBC line). It is rebuilt to the
  contractor's scope: with or without contingency, with or without VAT.
- **Labour only.** A labour-only quote is not comparable: the engine prices
  supply as well.
- **Unstated scope.** Where the scope is not stated, the comparison is the
  range over every reading of it.
- **No calibration.** No rate is ever calibrated from a benchmark.

| # | what | logged |
|---|---|---|
| 2 | a contractor's quote for a **different** bathroom, AED 35,000–40,000, scope unknown | ✓ — on its possible scopes the engine reads AED 34,196.10–38,778.38: same neighbourhood, nothing more |
| 1 | **the client's contractor, this bathroom, one total** | **waiting for the figure and what it includes** — `--contractor=<aed> --vat=yes\|no --contingency=yes\|no --noc=yes\|no --supply=full\|labour` |

## 3 · Allowances by value, not count

`lib/boq/allowance-share.ts` gives the allowance AED over the base total (the
subtotal, before contingency and VAT). Since B9 the price page, the BoQ page's
rate-basis line and the script all read it.

| | allowances | base | share | lines |
|---|---|---|---|---|
| **before** (frozen rev 14) | AED 15,898.20 | AED 34,196.10 | **46.5 %** | 21 of 42 |
| **after** (rev 15) | AED 7,898.20 | AED 33,158.10 | **23.8 %** | 16 of 42 |

The top 5 allowance lines by value before, and what each needs:

| line | AED | needs |
|---|---|---|
| W-27 concealed manual shower set | 2,200 | supplier quote or catalogue price + fitting |
| W-28 ready-made vanity | 2,000 | supplier quote or catalogue price + fitting |
| W-26 fixed glass panel | 2,000 | supplier quote or catalogue price + fitting |
| W-01 room protection + dust screens + daily clean | 1,200 | a labour rate for ONE room from a real job — the reference villa's site set-up (10,500) covers a whole floor |
| W-15 floor-standing WC | 1,200 | supplier quote or catalogue price + fitting |

## 4 · Converted without the contractor

The products went first: the brief's big items, plus the basin mixer.

| line | was (allowance) | now | basis | how |
|---|---|---|---|---|
| W-27 shower set | 2,200.00 | **1,750.00** | calibrated | the reference villa's transacted concealed GROHE shower set (sanitaryware supplier, Jun 2026); fitting = the shower point's second fix |
| W-28 vanity | 2,000.00 | **1,474.00** | catalogue | 80 × 50 vanity with seamless basin, 1,299.00 (verified 28 Apr 2026) + ½ day carpenter at 350.00 (labour book, mid) |
| W-26 glass panel | 2,000.00 | **2,139.00** | catalogue | walk-in panel 1200 × 2000, 1,299.00 + 2.40 m² × 350.00 glass install (labour book, mid) — higher than the allowance |
| W-15 WC | 1,200.00 | **1,199.00** | catalogue | close-coupled WC, dual flush, 1,199.00; fitting = the WC point's second fix |
| W-29 basin mixer | 600.00 | **400.00** | calibrated | the reference villa's transacted basin mixer; fitting = the basin point's second fix |

- **Where the figures live:** in their rules (R-67 to R-71, `sourced: { basis }`)
  with the arithmetic in the note. The resolver reports a catalogue figure as
  tier `catalog`, and the rate basis reads `catalogue` / `calibrated`.
- **Sources stay private:** the role is named, never the vendor; a test scans
  the notes.
- **The product picker** labels an option "catalogue price" /
  "reference-villa price" instead of "estimate (allowance)".
- **W-01 stays an allowance.** No per-room figure exists. A real one-room job,
  or the contractor's itemised quote, would replace it.
- **Finish caveats:**
  - The reference villa's shower set and mixer were matt black; brushed brass
    is the same GROHE colour range at a similar price.
  - The catalogue panel's profile is chrome or steel; a brushed-brass profile
    may cost more.
  - Both are stated in the line notes.

**Result:**
- **The share falls to 23.8 %**, under the ~25 % target.
- **The total moves** AED 38,778.38 → **37,601.29** (rev 15, −1,038.00 on the
  subtotal).
- **Only the five converted lines moved** (rev 14 vs rev 15, line by line: 44 →
  44 lines, 5 moved).
- **The pack:**
  - re-exported, every B6 check green, AED 37,601.29;
  - the price page reads "AED 7,898.20 of the AED 33,158.10 of work (23.8%) is
    priced on our own estimates (allowances, 16 of 42 lines), for the QS to
    confirm";
  - the renders are unaffected: the design did not change.

**Arabella and the villas are unchanged:**
- Arabella dry run = stored to the fil (116,679.56).
- The demo villa's dry run is byte-identical with and without B9's code. Its
  moves since its 12 Oct revision are earlier merged work: the skirting fix,
  K12's staircase rule, B5's painting rule.
- The pricing goldens pass. Rules R-67 to R-71 are used only by the wet-room
  package.

## 5 · The itemised quote — drafted for the client (Abdallah sends)

> Thank you for sharing your contractor's figure. To show you where our numbers differ from theirs, line by line, could you ask them for the itemised version of the same quote — the sections (strip-out, waterproofing, tiling, sanitaryware, glass, joinery, electrical, plumbing) with quantities and rates, and whether the total includes VAT, a contingency, the building NOC and the fixtures themselves? We'll put the two side by side and explain every difference.

When it arrives, the original protocol applies:
- per section, engine vs quote, every delta explained (rule gap / allowance vs
  rate / scope / contractor pricing);
- compared against the **frozen rev 14**;
- the bathroom is recorded as ground-truth project #3 in `boq_outcomes`
  (kind ground_truth).

## DB step

`npm run db:push` for **066** — on dev now. Production before the merge
(check-then-merge).

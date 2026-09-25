# T6 — verification walkthrough (2026-09-22, dev)

Screens taken on the dev DB (`askzyqgcnjmbqegfifxq`) against a dev server with
`GARDEN_PILOT_ENABLED DRAWINGS_ENABLED OVERLAYS_ENABLED PACK_EXPORT_ENABLED
WHATIF_ENABLED VIEWER_3D_ENABLED` on. Production flags are unchanged.

| File | What it shows |
|---|---|
| `t6-demo-firm-popover-firm-rate.png` | **Resolution tiers on a test firm.** A firm rate book ("T6 Test Contracting", OH&P 8%, two entries) attached to the dev demo villa. PLA-01 wall plaster prices at **AED 72/m²** (the book) instead of 55, the SOURCE column reads *contractor rate book*, and the popover states `RESOLUTION TIER · PRIVATE — the contractor's own rate book, shadows the market reference for this project only` with `QS VALIDATION — not QS-reviewed by the platform`. The firm's **name appears nowhere**. |
| `t6-demo-firm-summary-rows.png` | The assembly chain on screen: Subtotal · **Overheads & profit 8%** ("applied once here and never inside a rate") · Contingency · VAT · Project total. |
| `t6-demo-firm-popover-project-total.png` | The displayed total is not silently the stored one: the popover prints *stored AED 552,080 → scenario AED 538,730 (what-if grades moved the subtotal by −AED 10,901; recomputed with the stored percentages)* and flags **not the stored figure**. |
| `t6-arabella-popover-market-rate.png` | The same trail with no firm: `RESOLUTION TIER · ACTUAL_TRANSACTION`, source *market reference — Dubai garden 2026*, `QS-validated: no`, plus the derived-quantity flags. |
| `t6-arabella-summary-rows.png` | The client garden's draft totals. |
| `t6-export-gate-blocked.png` | **The export gate as a checklist** on the interior demo: six green items — including *Everything drawn with a cost is priced*, which used to 409 every interior BoQ PDF — and one red: the working name. |
| `t6-export-passed.png` | **A gated export that passed**: 26/26 checks, four signed downloads (drawing set, render pack, BoQ, manifest), reloaded from a fresh page load. |

The test firm was deleted after the shots and the demo BoQ regenerated back to
**AED 498,824** exactly, so nothing here is left attached to a fixture.

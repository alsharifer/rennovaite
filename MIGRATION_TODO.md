# Migration TODO — deliberately-faked placeholders

These are **intentional** stubs that are fine for the Mudon pilot / demo. They
render plausible values so flows aren't blocked, but they are not backed by real
data yet. Each line says when to close it. Don't rewrite these speculatively —
close one only when its "close when" condition is actually met.

| # | Placeholder | Location | Close when |
|---|-------------|----------|------------|
| 1 | Vendor sourcing metadata (distance, country of origin, warranty, sample availability) — hardcoded `VENDOR_META` per brand | [`app/project/[id]/vendors/_components/vendor-picker.tsx:58`](app/project/[id]/vendors/_components/vendor-picker.tsx) | `pricing_skus` (or a vendor table) carries distance/origin/warranty/sample columns — then read them instead of the map. |
| 2 | Project timeline dates — hardcoded `TIMELINE` milestones (Oct 24 … Feb 15) | [`app/project/[id]/page.tsx:774`](app/project/[id]/page.tsx) | A real schedule/milestones source exists (derive from project start + phase durations, or a `milestones` table). |
| 3 | Material palette + swatch images — hardcoded `MATERIALS` (stable Unsplash CDN swatches, client-only swap, no persistence) | [`lib/materials.ts`](lib/materials.ts) | Materials come from the KG / `pricing_skus` with real swatch assets, and swaps persist. |
| 4 | Auth hero image — Unsplash placeholder (`DETAIL_IMG`) | [`app/auth/page.tsx:12`](app/auth/page.tsx) | A licensed brand photograph is available to swap in. |

## Not a stub — tracked separately

**BoQ quantities are heuristic-derived, not faked.** `computeQuantities()` in
[`app/api/generate-boq/route.ts`](app/api/generate-boq/route.ts) computes
quantities from real plan area + room counts using documented rule-of-thumb
factors (e.g. demolition debris = area × 0.20 m³, bathroom wet-wall = 28 m²/bath).
These are deliberate estimates, not placeholders — improving their accuracy is a
separate QS/pricing workstream and should **not** be lumped in with the cosmetic
stubs above.

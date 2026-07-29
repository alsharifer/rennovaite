# Pilot Seven — deploy checklist

Compile-and-merge runbook for shipping `pilot-seven` → `master`. Pairs with
`PILOT_SEVEN_STATUS.md` (what shipped + QS/consultant follow-ups). Everything is
flag-gated, so the safe default is **merge with flags off, then flip on per
environment.**

---

## 0. Pre-merge (branch is green)
- [ ] `npm ci` on a clean checkout
- [ ] `npx tsc --noEmit` clean
- [ ] `npx eslint .` clean
- [ ] `npm test` → 68/68
- [ ] `npm run build` exit 0
- [ ] `node scripts/verify-graph-integrity.ts` → all 4 checks pass (needs prod-or-pilot DB env)

## 1. Database migrations (manual — no runner; Supabase SQL editor)
Apply **in order**, idempotent (`if not exists`). The pilot DB is already done;
this is for any **other** environment (staging/prod project).
- [ ] 013 plan_snapshots · 014 drawing_sets (P1)
- [ ] 015 plan_fixtures (P2)
- [ ] 016 renders_kind (P3)
- [ ] 017 takeoff_items (P4)
- [ ] 018 rate_book · 019 whatif_scenarios (P5)
- [ ] **020 permit_checks (P6)**
- [ ] **021 staging — renders.staging_set + furniture_opt_ins + furniture_prices (P7)**

## 2. Storage
- [ ] Private Storage bucket named **`drawings`** exists (P1 signed-URL PDF export).
      Without it, live drawings still render; only persisted PDF links fail.

## 3. Seed data
- [ ] Base catalogs present: `labour_rates`, `pricing_skus` (pre-pilot seeds)
- [ ] `node scripts/seed-rate-book.ts` (after 018 — P5 grade rates; 3 rows land pending-QS)
- [ ] `node scripts/seed-furniture-prices.ts` (optional, after 021 — DB-editable furniture overrides; app falls back to module defaults without it)

## 4. Environment variables (server)
Required: `ANTHROPIC_API_KEY`, `REPLICATE_API_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only).
Optional: `RENDER_MODEL`, `BOQ_ENGINE`, PostHog keys, Neo4j + `KG_ENABLED`.

**Pilot feature flags** — set each to `"true"` to expose the feature (all
default off). Flip only after §1–§3 for that environment:
- [ ] `DRAWINGS_ENABLED` (needs 013/014 + `drawings` bucket)
- [ ] `OVERLAYS_ENABLED` (needs 015)
- [ ] `VIEWER_3D_ENABLED` (needs 016/017 — also gates P4 inspect)
- [ ] `WHATIF_ENABLED` (needs 018/019 + rate-book seed)
- [ ] `PERMIT_CHECK_ENABLED` (needs 020)
- [ ] `STAGING_ENABLED` (needs 021)

> Flags read at server start — **restart/redeploy after changing any flag.**

## 5. Build & release
- [ ] `next build` (SWC; ignores `scripts/`)
- [ ] Deploy; confirm the six flag values are set as intended in the runtime env

## 6. Post-deploy smoke test (Mudon or equivalent)
- [ ] `/project/<id>/plan` loads; Drawings card + overlay toggle + "Walk in 3D" appear (flags on)
- [ ] `/project/<id>/drawings` renders the sheet set; `/viewer` loads orbit + walk (WebGL)
- [ ] `/project/<id>/boq` — what-if panel present; permit card renders (calm or fired); no console errors
- [ ] Lock a render → furniture opt-in appears → BoQ shows "Furniture (optional)" and toggles off cleanly
- [ ] With all six flags off: gated routes 404, no new UI — confirms clean fallback

## 7. Rollback
- [ ] **Instant:** set the offending flag to `"false"` and restart — no redeploy, no data loss. Migrations/seeds are additive and safe to leave in place.
- [ ] Full revert: `git revert` the merge commit (features are isolated; P1–P4 on master are untouched).

## 8. Known-manual / follow-ups (from PILOT_SEVEN_STATUS.md)
- [ ] Screenshots: 13-shot manifest in `screenshots/pilot-seven/` (capture on a WebGL browser; pane in CI can't composite)
- [ ] QS: confirm 2 `needs_qs` overlay rates + 3 pending rate-book grades
- [ ] Consultant: confirm 6 weak permit rules + authority routing table
- [ ] Mudon geometry is `derived: true` (walls/openings/scale/structural) — engineer site visit replaces it

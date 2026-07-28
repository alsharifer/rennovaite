# Pilot Seven — Pre-Flight Verification (read-only)

Verifies the repo is ready for the seven-feature pilot pack (P1–P7) before any
feature work. **Read-only** except the three sanctioned writes: this file, the
new `.env.local.example`, and the Step-6 scaffolding (empty `lib/*` folders +
`CLAUDE.md` env rows). No feature code, refactors, or "improvements" were made.

Probed live: Supabase (PostgREST, service role) and Neo4j (bolt). Type-check,
lint, and build were run. Facts below are as observed on this branch (`master`).

---

## GREEN — verified assumptions

### Design-system foundation (Refactor Prompt A — complete)
- `components/app/AppShell.tsx`, `Sidebar.tsx`, `TopBar.tsx` all exist.
  `AppShell` composes `<Sidebar/>` + `<TopBar/>` (`ml-60 pt-16`, `noPadding`
  escape hatch).
- **Every in-app page wraps `<AppShell pageName=…>`** — all 9 verified:
  `/project/new`, `/project/[id]` (hub), `/project/[id]/plan|style|render|boq|vendors`,
  `/dashboard`, `/my-projects`.
- `tailwind.config.ts` carries the Atelier tokens the pack references: `canvas`,
  `paper`, `bone`, `ink-900/700/500/100`, `brass-600`; the full M3 set
  (`surface*`, `primary*`, `secondary*`, `tertiary*`, `error`, `outline*`,
  `*-fixed*`); `boxShadow.hairline` / `level-1` / `level-2`; the type scale
  (`headline-*`, `body-*`, `label-caps`, `data-mono`). `.label-caps` utility
  lives in `app/globals.css`.
- Fonts loaded in `app/layout.tsx` via `next/font/google`: **EB Garamond, Inter,
  JetBrains Mono** + Arabic fallbacks **IBM Plex Sans Arabic** & **Rubik**;
  **Material Symbols Outlined** via `<link>` in `<head>`.
- **No Dark Silk remnants** on any touched surface: `grep` for
  `neo-raised` / `glow-indigo` / `#0b1326` returns nothing (outside
  node_modules/.next/worktrees/design-refs).

### Style library (P7 staging sets must match these)
Six keys, verbatim from `lib/styles.ts`:
`contemporary-majlis`, `modern-hijazi`, `coastal-emirati`, `scandi-arabic`,
`andalusian-heritage`, `luxe-minimal`.
`STYLE_KEYS` in `lib/render-prompts.ts` is the **same six** (union +
`STYLE_FRAGMENTS`), so render prompts and staging share one source of truth.

### APIs (exist; prompt-assembly + persistence located)
- `app/api/render/route.ts` — builds `buildEditPrompt` + materials clause +
  optional KG context + optional tweak; photo vs off-plan path; **persists a
  `pending` `renders` row** (finalised by `/api/render/status`).
- `app/api/render-iterate/route.ts` — Claude rewrites the tweak
  (`REWRITE_SYSTEM_PROMPT`), edits the **parent render's image**, persists a
  `renders` row with `mode="tweak"`, `parent_render_id` set, inherits parent
  `kg_bundle_id`.
- `app/api/generate-boq/route.ts` — **default path = deterministic
  `lib/boq/engine`** (no LLM); legacy Claude-priced path behind
  `BOQ_ENGINE="llm"`. Both **insert into `boqs`** (`sections` jsonb +
  `total_aed`). POMI grouping enforced.

### Data model (kg_bundle_id present on both — KG1 Step 8 complete)
- `renders`: `image_url`, `room_id`, `project_id`, `parent_render_id`,
  `source_image_url`, `model`, `mode`, `prediction_id`, `status`, `qa`,
  **`kg_bundle_id`** ✓ (migration `008`).
- `boqs`: `project_id`, `total_aed`, `sections` (jsonb), `locked_at`,
  **`kg_bundle_id`** ✓ (migration `008`).
- `rooms`: geometry is **`polygon` (jsonb) only** — plus `name_en`, `name_ar`,
  `room_type`, `area_m2`; FK to `plans` (not `projects`).
- `style_choices`: `project_id`, `style_key`, `room_id`, `created_at`.
- **RLS pattern is consistent:** every table is created then
  `alter table … disable row level security` (single-user pilot). New P1–P7
  tables should copy that (disable RLS), not add policies.

### Reference / demo data (live Supabase)
- `labour_rates` = **52 rows**; `pricing_skus` = **600 rows**;
  `vendor_selections` = 3; `feedback_events` = 13; `room_photos` = 1.
- 4 projects, 4 plans (areas **142.5 / 162.1 / 122 / 178.5 m²**), **50 rooms**
  (~12–13/plan), **38 renders (all `succeeded`, all have images, 15 distinct
  rooms rendered)**, **4 BoQs**, 6 approved designs.
- CSV shapes (for P5's rate-book seed):
  - `assets/labour-rates.csv`: `work_section, description, unit, rate_low_aed,
    rate_mid_aed, rate_high_aed, source, notes` (52 data rows).
  - `assets/pricing_skus.csv.csv`: `ID, SKU, Brand, Category, Subcategory,
    Description_en, Description_ar, Unit, Price_aed, Vendor, Source_url,
    Photo_url, Lead_time_days, in_stock, Last_verified` (600 data rows). CSV
    headers are Title-Case; DB columns are lower-case (`category`, `price_aed`)
    — the seed script maps them.

### Green baseline (P1–P7 start clean)
- `tsc --noEmit` → **exit 0** (no errors).
- `npm run lint` → **0 errors, 1 warning** (pre-existing): `no-page-custom-font`
  on `app/layout.tsx:71` (the Material Symbols `<link>`).
- `npm run build` → **exit 0**, all routes compiled. One benign node warning:
  `MODULE_TYPELESS_PACKAGE_JSON` for `tailwind.config.ts` (loaded via the v4
  legacy-config bridge). Record both so P1–P7 don't inherit blame.
- Package baseline: **Next 16.2.4, React 19.2.4, TypeScript 5.9.3, Node
  v24.15.0, `neo4j-driver` ^6.1.0**. `three` / `@react-three/fiber` /
  `@react-three/drei` **absent** (matches P3's assumption).

### KG plumbing
- `kg/retrieval/agent.ts` vendored in-repo (`neo4j-driver`); `lib/kg/brief.ts`
  and `lib/kg/context.ts` exist. `getKgContext` never throws — returns
  `{context:"", bundleId:null}` on flag-off / no-mapping / timeout / error.
- Neo4j was **unreachable at pre-flight** (Docker KG stack down). The
  empty-fallback path is confirmed by code and by data (0 rows carry a
  `kg_bundle_id`). To exercise KG-dependent prompts: `cd kg && docker compose up -d`.

---

## AMBER — true but different (use the substitution noted)

1. **BoQ is a jsonb blob, not line rows.** `boqs.sections` stores the **entire**
   BoQ object: `{ sections:[{ work_section, lines:[{description, quantity, unit,
   rate_aed, total_aed, vendor_or_source, notes, …}], section_total_aed }],
   subtotal_aed, contingency_*, vat_*, grand_total_aed, engine? }`. `boqs.total_aed`
   mirrors `grand_total_aed`.
   → **P2/P4 `element_refs` attach as an additive field inside each
   `sections[].lines[]` item**, exactly like the engine's existing per-line
   `rule_id` / `kind` / `rate_band` (`lib/boq/schema.ts`). **No new column, no
   `boq_lines` table.**

2. **Feature pages are nested, not top-level.** There is no `/style`, `/render`,
   `/boq`, `/vendors`, `/plan`. They live at
   `app/project/[id]/{style,render,boq,vendors,plan}/page.tsx`.
   → Later prompts must target `/project/[id]/<feature>`.

3. **Renders have no `version` column.** Versioning is the `parent_render_id`
   lineage chain; `mode ∈ {photo, offplan, tweak}` distinguishes passes.
   → P-code that expects `renders.version` must walk `parent_render_id` instead.

4. **`projects` has no community field.** Columns: `id, created_at, city,
   currency, budget_aed, status, name`. `city` is "Dubai" for all; budget lives
   on `budget_aed` (null in demo); `name` is "Untitled" for all 4.
   → No `community` column to read; community is fixed in the KG brief (below).

5. **KG brief IDs differ from the pack's stated values.** `lib/kg/brief.ts` uses
   `community:mudon-al-naseem` ✓, but `property:villa-mudon-4br-first-floor`
   (**not** `villa-mudon-alnaseem-f2-v94`), and style is **per-key mapped**
   (`luxe-minimal → style:minimalist`, the other five 1:1) — there is **no single
   `style:contemporary-warm-minimal`**. `budgetTiers` = `["mid","premium",
   "luxury"]` (includes `"mid"` ✓).
   → Any prompt hard-coding Mudon KG IDs must use the actual slugs above.

6. **No single named "Mudon pilot" project.** 4 unnamed `draft` projects exist.
   Most-complete candidates for P1's cross-check:
   - `6b5fda9d-e40f-4e16-940c-7a17d27ec5dc` — **178.5 m²**, style
     `coastal-emirati` (latest), 13 rooms, renders + **2 BoQs (AED 374,533 /
     382,157)** + 3 approved designs.
   - `0089e18a-c962-4b4a-a4d9-2430529d759a` — **122 m²**, style `luxe-minimal`,
     13 rooms, renders + **2 BoQs (AED 295,734 / 279,302)** + 2 approved.
   Each plan has ~13 rooms (master_bedroom, 2× bedroom, bathroom, ensuite,
   powder, living, closet, foyer, stairs, balcony, 1–2 terraces); **~6 are in
   renderable scope**. → P1 should pick one project and pin its
   room-count/area as the cross-check.

7. **Existing BoQs are LLM-path, not the current deterministic engine.** All 4
   demo BoQs have **no `engine` key** in the blob (12 sections, 24–27 lines,
   totals AED 279k–382k). The default path is now `lib/boq/engine`, whose output
   carries `engine.{version,tier,flooring}` and extra per-line fields.
   → P5's baseline should **regenerate** a BoQ to get the true engine output;
   don't treat the stored LLM totals as the engine baseline.

8. **POMI section lists differ slightly by path.** Engine (`lib/boq/schema.ts`) =
   14 sections incl. `Blockwork` + `Ceilings`; legacy route
   (`app/api/generate-boq`) = 13 (no `Ceilings`). Both group by POMI.

9. **Asset filenames.** Pricing CSV is `assets/pricing_skus.csv.csv` (double
   `.csv`); labour is `assets/labour-rates.csv`; first-floor plan is
   `assets/villa-plan-first-floor.pdf`. Moodboards live as
   `assets/moodboards/mood-<Name>-<room>.png` and are served from
   `public/moodboards/<style-key>-<room>.png`.

10. **`kg_bundle_id` is populated on 0 rows.** The columns exist (GREEN) but no
    render/BoQ was generated with Neo4j up, so grounding has never persisted.
    Not a defect — informational for anyone expecting grounded demo rows.

11. **`lib/materials.ts` is a hardcoded placeholder** (Unsplash swatches, per
    `MIGRATION_TODO.md`), not KG/`pricing_skus`-backed. Any prompt consuming it
    should read that file's real shape, not assume live material data.

12. **Pilot flag names / folder↔prompt mapping are inferred.** The six flags and
    the `lib/*` owner labels below are the pre-flight's best inference; each
    owning prompt should confirm/rename. Flags added commented-out to
    `.env.local.example`: `PLAN_ENABLED`(P1·lib/plan),
    `DRAWINGS_ENABLED`(P2·lib/drawings), `OVERLAYS_ENABLED`(P3·lib/overlays),
    `WHATIF_ENABLED`(P4·lib/whatif), `COMPLIANCE_ENABLED`(P6·lib/compliance),
    `STAGING_ENABLED`(P7·lib/staging). `lib/boq` (P5) already exists and is
    populated. `BOQ_ENGINE` also added to the `CLAUDE.md` table (was undocumented).

13. **No test runner installed.** `package.json` has **no** jest/vitest/mocha/etc
    and **no `test`/`typecheck` script**. P1/P5/P6 write unit tests, so a runner
    must be added first. Repo tooling (Next 16 + TS 5 + ESM, `csv-parse` as the
    only script dep) implies **Vitest** (or Node's built-in `node:test`) as the
    natural fit. This is an *add*, not a missing prerequisite — hence AMBER, not
    RED — but it blocks the test-writing prompts until done.

---

## RED — missing prerequisites (owning fix, not an inline workaround)

**None.**

- KG1 Step 8 (kg_bundle_id on `renders` **and** `boqs`) — present ✓, no re-run.
- Refactor Prompt A (AppShell + tokens + fonts on every page) — present ✓,
  no re-run.
- No absent route, API, table, or token among the pack's dependencies.

(Neo4j being down at pre-flight is not RED: KG grounding is optional and the
fallback is clean. Start the KG Docker stack before running KG-dependent prompts.)

---

## Verdict

`PRE-FLIGHT: GO`

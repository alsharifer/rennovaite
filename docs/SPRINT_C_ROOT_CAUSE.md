# Sprint C0 — root cause: Jumeirah scope leak, Mudon export, status truthfulness

20 Oct 2026. Diagnosis only: no code changed. Production was read only
(`npx supabase db query --linked --project-ref efrcgktrlsjnzkzzuhof`, SELECTs
only; the CLI link and `.env.local` were left on dev `askzyq…`). Every prod row
id below came from those reads.

Projects (prod):

| Project | id | firm | plan | BoQ revisions |
| --- | --- | --- | --- | --- |
| Jumeirah Parks Garden | `a7fc40cb-c6f6-49e1-9a6e-71548e8620dc` | none | `1f9ee118…`, 12 rooms | 1 — `aacc3876-1f02-418d-b3c6-4ffa9a8d0ef0` (13 Oct 14:38 UTC, engine 0.3.0, AED 504,469.38) |
| Mudon pilot villa | `6b5fda9d-e40f-4e16-940c-7a17d27ec5dc` | none | 13 rooms | 22 — latest `c0beeaaf-4006-47c1-a02f-7ca1b82c3e41` (5 Sep) |

---

## 1. Jumeirah — glazing lines that name rooms the project does not have

### The plan (prod `rooms`, plan `1f9ee118…`)

Bath · Entrance Foyer · Family Room · Grass · Hall · Kitchen · Living Room ·
Maid Room · New room (paving) · New room (deck) · Powder Room / WD · Stairs.
Interior and garden: a ground floor with a garden. No bedroom, no office, no
master bathroom.

### The lines (BoQ `aacc3876…`, section "Aluminum & Glass", AED 95,949)

| Rule id (no `item_key` is stored) | Description | AED | Names a room the plan lacks? |
| --- | --- | ---: | --- |
| `GT/aluminum/guest_bedroom_thermal_break_hinged_door_curved_fixed_d` | Guest bedroom — Thermal-break hinged door + curved fixed DG glass, 700×2650 | 10,300.00 | yes |
| `GT/aluminum/master_bedroom_thermal_break_hinged_door_curved_fixed_d` | Master bedroom — Thermal-break hinged door + curved fixed DG glass, 700×2650 | 10,300.00 | yes |
| `GT/aluminum/master_bathroom_tilt_turn_system_dg_950_950` | Master bathroom — Tilt & turn system DG, 950×950 | 3,000.00 | yes |
| `GT/aluminum/kids_bedroom_thermal_break_sliding_system_dg_1850_246` | Kids bedroom — Thermal-break sliding system DG, 1850×2460 | 12,040.00 | yes |
| `GT/aluminum/office_thermal_break_sliding_system_dg_1700_230` | Office — Thermal-break sliding system DG, 1700×2300 | 10,384.00 | yes |
| `GT/aluminum/office_thermal_break_sliding_system_dg_1830_300` | Office — Thermal-break sliding system DG, 1830×3000 | 14,176.00 | yes |
| `GT/aluminum/living_area_skylight_dg_1830_3750` | Living area — Skylight DG, 1830×3750 | 15,749.00 | yes ("Living area" is Mudon's; Jumeirah has a Living Room and Family Room, and no skylight on its plan) |
| `GT/aluminum/g_f_f_f_stair_shaped_glass_balustrade_12mm_tinted_bron` | G.F–F.F stair — Shaped glass balustrade 12mm tinted bronze | 16,500.00 | in part: Jumeirah has "Stairs", but the 10 lm is Mudon's |
| `S6-06/R-47` | Frameless shower glass partition | 2,200.00 | no (counted from Jumeirah's own bathrooms) |
| `S6-07/R-48` | Bathroom mirror | 1,300.00 | no (counted from Jumeirah's own bathrooms) |

The 8 `GT/aluminum/*` lines total **AED 92,449.00** before contingency and VAT.

Two weaker cases elsewhere in the same revision (they don't name a missing room
outright):
- `S6-02/R-45` "Cove LED strip — supply (living/dining/master)" names a master
  bedroom the plan lacks. The text is generic; the quantity is Jumeirah's.
- `Q-32/R-27` and `Q-33/R-28` carry the source "… residential first-floor
  refit". Jumeirah is a ground floor. These are Mudon-era labour-book labels.

### Where each line comes from

For every one of the 8 lines:

- **Emitted by**: `buildAluminumSection`
  ([lib/boq/joinery-aluminum.ts:189](../lib/boq/joinery-aluminum.ts)). It is
  called through `appendJoineryAluminumSections` on both BoQ paths:
  [lib/boq/assemble.ts:388](../lib/boq/assemble.ts) (engine) and
  [app/api/generate-boq/route.ts:671](../app/api/generate-boq/route.ts) (LLM).
- **Priced from**: no rate-book row. The figures are the code constant
  `ALUMINUM` ([lib/ground-truth/mudon-actuals.ts:107-116](../lib/ground-truth/mudon-actuals.ts)).
  That constant is the Mudon aluminium contractor's quotation (ref 3936/R1),
  transcribed line by line: location, item, qty and total. The rate is
  `total / qty`. The description is `${location} — ${item}`, so the
  **quotation's room labels become the line's description**.
- **Source label**: "aluminium & glazing reference quotation (allowance)". This
  is the I4 role label for that contractor. `rate_status` is
  `site_assessment`; there is no `rate_tier`.
- **Not a quote import, not a firm book.** Prod has 0 `firm_quotes`, 0
  `firm_quote_lines` and 0 `firm_rate_entries`. It has 1 firm, with no
  projects attached. Of its 81 `rate_book` rows (`actual_transaction` + `seed`),
  none has an aluminium, glazing or window key.
- **First appeared**: revision 1, `aacc3876…` (13 Oct 14:38:56 UTC). That is
  Jumeirah's only revision. Jumeirah's plan was created 13 Oct; the section
  has been in the code since 29 Jul (`6289d35`).

The only guard is at `joinery-aluminum.ts:194`: skip the section when **every**
room is a landscape zone (added in G3, `8779cce`). Jumeirah has 9 interior rooms,
so the whole Mudon quotation is appended. K12 (`4f8705b`, 14 Oct) ruled the
allowance whole-home and added `ALUMINUM_SCOPE_NOTE` ("Covers the whole unit —
adjust if only some rooms are in scope"). Jumeirah's revision predates K12, so
its lines don't carry that note. A regenerate today would add the note and
still print the same 8 Mudon lines.

### Classification: **(b)**, with a correction to how (b) was framed

The cause is the whole-home aluminium & glazing allowance in
`lib/boq/joinery-aluminum.ts`, applied to every project that has at least one
interior room. It is not a K12 scope bug: K12 only confirmed the existing
rule. The defect is what the allowance is made of. It is **one reference
project's quotation, reproduced per item**: Mudon's quantities (2 doors, 10 lm
of balustrade, a 1830×3750 skylight), Mudon's totals and Mudon's room labels.
It is presented as if it were this project's scope.

- (a) is ruled out: no rate-book row and no quote import exist on prod.
- (c) is ruled out: nothing is copied at project creation. The lines are
  re-emitted by code on every generation.

### Other projects carrying a quotation that isn't theirs

Checked on prod with the latest revision of every project that has a BoQ
(3 projects have one: `0089e18a`, Mudon `6b5fda9d`, Jumeirah `a7fc40cb`).

- **Jumeirah Parks Garden**: the 8 Mudon aluminium lines (above). It also has 4
  `GT/joinery/*` lines priced at the Mudon **joinery** quotation's composite
  rates (bath cabinet, vanity, door leaf, door frame). Those use Jumeirah's own
  room counts and generic descriptions. That is a reference *rate*, labelled as
  one ("joinery reference quotation (transacted composite rates)"), not a leaked
  scope. It is the same standing as the garden market-reference book. No change
  is needed beyond C1's provenance wording.
- **Mudon pilot villa**: carries the same 8 lines (rule ids null; written
  before the GT rule ids). It is the villa the quotation was for, but even there
  the quotation's labels don't match the plan. Mudon's plan has "Bedroom 3",
  "Bedroom 4", "Family Area" and "Master Bath", not "Guest bedroom", "Kids
  bedroom", "Office" or "Living area". So the C1 regression test ("no line names
  a room absent from its own plan") **fails on Mudon too**, unless the
  quotation's labels are mapped to plan rooms or dropped.
- **`0089e18a` (Untitled)**: its 2 revisions predate 29 Jul. It has no
  aluminium section.
- Every future project with at least one interior room gets the same 8 lines.

### Why the identity scan didn't flag a Mudon reference in the inspector

What the inspector shows: for any `GT/*` line, `lineTierKey` infers tier
`module_reference` ([lib/provenance/boq.ts:151](../lib/provenance/boq.ts)). The
rate chain then prints `TIER_DISPLAY.module_reference.detail` verbatim
(`boq.ts:119`, pushed at `:227`, **not** passed through `cur()`): "Transacted
reference rates from the **Mudon** ground-truth quotations, held in code
(lib/ground-truth)." The quantity chain prints the rule id, which carries the
room slug (`…/guest_bedroom_…`). So every interior project's inspector names
Mudon and Mudon's rooms.

What the scans look for today:

| Scan | Surfaces | Vocabulary |
| --- | --- | --- |
| `curateText` / `findWithheldIdentities` ([lib/identity/curation.ts:38-52](../lib/identity/curation.ts)) | every read path that calls `curateBoq` (BoQ page, PDF, pack, drawings, viewer) | contractor/supplier names and quotation numbers (KAME, Atrium, QTN…, Global Creation, 3936/R1, Laspinas, 46703), "Villa 94"/"V94", "the RAK tiles quotation", plus other firms' names. **"Mudon" alone is not on the list** (only `Mudon Villa 94`). |
| [scripts/document-identity-scan.mjs](../scripts/document-identity-scan.mjs) | **broad**: drawing sheets, render-pack pages, the BoQ page HTML + RSC payload (so the inspector and popover chains), plan page, hub, rates, revisions, documents, proposal page, proposal-setup/preview, pack-export gate, plan-editor APIs | the literal list at `:31` plus firm names — the same identity notion |
| [scripts/read-path-leak-scan.ts](../scripts/read-path-leak-scan.ts) | in-process: `rate_book.source`, reference/what-if reads, every stored BoQ as curated, catalogue, plan text | the literal list at `:41` plus `findWithheldIdentities` |
| Pack checks `printedChecks` ([lib/documents/pack-export/checks.ts:170-182](../lib/documents/pack-export/checks.ts)) | **documents only**: drawing sheets, render-pack pages, BoQ PDF pages, proposal pages, and the stored BoQ JSON ("BoQ data") | `findWithheldIdentities` + `INTERNAL_REF` tokens |

So there were three gaps, and each one alone would have let this through:

1. **Wrong question.** Every scan asks "does a contractor or supplier name
   appear?" None asks "does **another project** appear here?" That would cover
   its name, its property, its rooms, its quantities. "Mudon" is the canonical
   demo villa's name and the reference project's community, so it was never on
   a withheld list. A room label like "Office" is not an identity at all, so no
   string list can catch it. Only a check against **this project's own plan**
   can.
2. **Uncurated constant text.** The tier `detail` strings are pushed into the
   chain without `cur()`. Even a "Mudon" ruling in `curation.ts` would not have
   reached the inspector.
3. **Coverage and target.** The pack checks scan documents only, not the
   inspector, popovers, revision diff or proposal preview. The one scan that
   does read the BoQ page payload (`document-identity-scan.mjs`) is manual and
   needs a dev server. It has never run against prod Jumeirah (created 13 Oct).

What it should scan (C1 #2): every rendered surface — the BoQ & Review model
(inspector, provenance popovers, notices, Issues navigator), the revision diff
(page, JSON, PDF), the proposal + preview, the hub/overview, the documents page
and every printed document. It should check both identities **and**
cross-project scope (rooms not on this plan; another project's name).

---

## 2. Mudon export — the `map` error, and the "Ready" that was never checked

### The error

```
TypeError: Cannot read properties of undefined (reading 'map')
    at planBody         (lib/drawings/plan-sheet.ts:221:35)   ← graph.elements.map(...)
    at renderDemoSheet  (lib/drawings/demo-sheet.ts:117:11)   ← planBody(proposed, …)
    at generateDrawingSet (lib/drawings/export.ts:340)        ← sheet A-102 "Proposed / Demolition Plan"
```

Reproduced locally from the prod snapshot (`renderDemoSheet(live, snapshot, …)`
throws; the same snapshot with `elements: []` renders).

- **Undefined**: `proposed.elements`. **Sheet**: **A-102 Proposed / Demolition
  Plan**.
- `generateDrawingSet` uses the latest `plan_snapshots` row of kind `proposed`
  as the proposed graph, unchanged (`loadProposedGraph`,
  [lib/drawings/export.ts:201-221](../lib/drawings/export.ts)).
- Mudon's is `89f75f37-ac41-4db4-b90e-2d567e0c2340`, written 29 Jul 13:44 at
  design lock. Its keys are `meta, notes, rooms, walls, planId, derived,
  openings, projectId`: no `elements`, no `context`.
- G1 (`a479cfa`, merged to master in PR #57 on **20 Sep**) added
  `graph.elements.map(…)` to `planBody`. That line assumes every graph has the
  field, but stored snapshots don't.

Effect: every surface that builds Mudon's drawing set throws, and has done since
20 Sep.

- `/project/[id]/drawings` (06 Documents / Tender) catches it and shows "The
  drawings could not be generated — Cannot read properties of undefined
  (reading 'map')" (`page.tsx:70`, `:177`).
- With no set, the Export pack panel is never rendered (`page.tsx:84`), and
  `preflightChecklist` and `loadParity` never run.
- `GET /api/projects/:id/drawings` answers 500.

Prod has **0 `pack_exports` rows** for any project, so no export job was ever
created. The failure is upstream of the job. Mudon's last stored `drawing_sets`
row is `078bbb9b…` from 28 Jul.

Only Mudon is affected on prod. The other project with a proposed snapshot,
Jumeirah (`618904e0…`, 13 Oct), has both `elements` and `context`.

A second, quieter problem with the same snapshot: A-102 diffs the **live**
as-built against geometry frozen on 29 Jul. Every plan edit since (K12 scope,
R10b openings, guardrail moves) is missing from the "proposed" side. The BoQ
reads the same snapshot for demolition
(`getProposedGraph`, [lib/boq/assemble.ts:297](../lib/boq/assemble.ts)).

### Why the overview says "Ready"

"Ready" is **computed, but from proxies, never from a validation**
([lib/hub/overview-view.ts:157-163](../lib/hub/overview-view.ts)):

- Drawing set → `"Ready · rev N"` when `DRAWINGS_ENABLED === "true"` and a BoQ
  exists.
- Cost breakdown (PDF) → `"Ready · rev N"` when `packExportEnabled()`.
- Tender pack → `"Ready"` when `packExportEnabled()` and the owner rail's tender
  step isn't blocked (no unpriced lines, plan check passes).

Nothing in that path builds the drawing set, runs the export gate or reads a
`pack_exports` result. **It has never been validated.** No pack job exists on
prod, and Mudon's drawing set has not generated since 20 Sep. The badge reflects
deployment flags, not this project.

### Every status badge — computed from a validation, or not

Legend:
- **A**: computed from a gate or validation function.
- **B**: computed from a proxy that is not a validation (flag, row count, timestamp, "a row exists").
- **C**: read from a stored column, with no re-check on read.

| Surface | Badge text | Where | Decided by | Function / proxy / column | Re-checked against the current revision? |
| --- | --- | --- | --- | --- | --- |
| Owner Overview — documents | Drawing set "Ready · rev N" / "Not available yet" | `lib/hub/overview-view.ts:161` | **B** | `DRAWINGS_ENABLED`; N = `count(boqs)` | **no** (Mudon: Ready while A-102 throws) |
| Owner Overview — documents | Cost breakdown (PDF) "Ready · rev N" | `overview-view.ts:162` | **B** | `packExportEnabled()` | **no** |
| Owner Overview — documents | Tender pack "Locked" / "Ready" | `overview-view.ts:155,163` | A for Locked, **B** for Ready | Locked = rail tender blocked (unpriced count, plan check); Ready = `packExportEnabled()` | partial; the export gate is never run |
| Firm hub — documents | "Generated from the plan · rev N", "Through the export pack · rev N" | `lib/hub/hub-view.ts:216-219` | **B** | flags; N = `listRevisions().length` | **no** |
| Firm hub — proposal | "Locked · reason" / "Exported" / "Unlocked" | `hub-view.ts:226` | A for Locked (`loadProposalGate`), **B** for Exported | Exported = a passed `pack_exports` job with `created_at` > the latest revision | timestamp only |
| Rail (all steps) | done / attention / blocked + reason | `components/blueprint/shell/StepList.tsx`; `lib/journey-state.ts` | A (mostly) | `firmStepStatuses` / `ownerStepStatuses` over `lib/journey-facts.ts` | see rows below |
| Rail firm 01/02 Plan, Scope | done / attention / blocked | `journey-state.ts:128-129` | A | `regenerateReadiness` | yes |
| Rail firm 03 Specification | done | `journey-state.ts:130` | B | `count(accessory_selections) > 0` | no |
| Rail firm 04 Rates & Basis | done / attention / blocked | `journey-state.ts:80-88` | A + C | `loadProposalGate` + `referenceBasisOf`; `firm_rate_books.status` | gate yes; book status stored (reset on write) |
| Rail firm 05 BoQ & Review | done / attention "changed since rev N" | `journey-state.ts:90-95` | A | `changesSinceRevision` + plan check | yes |
| Rail firm 06 Documents | **done** / available | `journey-state.ts:97-101`, `journey-facts.ts:158-166` | **B** | a passed job created after the latest revision — **can never be true after an in-app export**, which regenerates | timestamp, not `manifest.boq.id` |
| Rail firm 07 Revisions | done / attention "awaiting approval" | `journey-state.ts:103-112` | A over C | `approvalStatus(…, latest.id)` on `boq_approvals` | yes (by boq id) |
| Rail firm 08 Proposal | blocked / **done** | `journey-state.ts:114-124` | A blocked, **B** done | `loadProposalGate`; done = the same timestamp proxy plus `options.proposal` | blocked yes, done no |
| Rail owner 01 Plan | done / attention / blocked | `journey-state.ts:159` | A | `regenerateReadiness` | yes |
| Rail owner 02 Design | attention "Add references" / done | `journey-state.ts:160-163` | B | `count(moodboard_items) ≥ 3` | n.a. |
| Rail owner 03 Renders | done / "N / M locked" | `journey-state.ts:165-170` | B + C | `renderLockProgress` over `approved_designs`, `room_anchors` | no (a lock isn't re-checked against plan or style) |
| Rail owner 04 Cost | blocked / attention "N items not priced" / done | `journey-state.ts:171-177` | A + B | plan check + `unpricedLineCount`; done = a BoQ exists | latest BoQ |
| Rail owner 06 Tender | blocked / **available** (never done) | `journey-state.ts:179-184` | A + B | unpriced count + plan check; **no export gate** | partial |
| StepFooter | Continue disabled + reason | `shell/StepFooter.tsx` | A | rail state | as rail |
| Projects home — stage | Plan / Design / Costing / Approval / Documents / … | `lib/projects/home.ts:24-33,99-120` | C + A + B | `projects.status` first, then rail; "Documents" = client-approved, not exported | partial |
| Projects home / Overview / hub — Next | "03 · RENDERS — 1 / 3 locked", "X is blocked" | `home.ts:123-132`, `overview-view.ts:74-111`, `hub-view.ts:89-126` | A | `nextFromRail` over rail statuses | yes |
| Issues navigator | "⚑ N TO FIX" | `shell/IssuesNavigator.tsx`; `lib/boq/issues.ts` | A | review model + rail StepStatus | yes |
| 06 Documents — export checks | "PASS" / "BLOCKS EXPORT" | `documents/DocumentsExport.tsx:146` | A | `preflightChecklist` → `buildChecklist` / `checklistReady` | yes on load — **except** that a blocked latest job's stored `checklist` replaces the live one (`:125`) |
| 06 Documents — reference basis | "PASS" / "BLOCKS CLIENT PROPOSAL" | `DocumentsExport.tsx:148` | A | `proposalChecklistItems` ← `loadProposalGate` | yes |
| 06 Documents — printed checks | "AT EXPORT" / **"PASS"** / "FAILED", "Last export: all N checks … passed" + downloads | `DocumentsExport.tsx:339-358, 202-219` | **C** | the latest `pack_exports` row (`status`, `manifest.checks`) | **no** — under a header "EXPORT CHECKS · REV {current}", whatever revision the job was |
| 06 Documents — header | "REV N · CHECKED {now}" | `DocumentsExport.tsx:142` | B | `count(boqs)`; request time (not when anything was checked) | n.a. |
| 06 Documents — internal pack; Revisions "Link causes to lines" | "NOT AVAILABLE YET" | `DocumentsExport.tsx:249`; `RevisionsScreen.tsx:488` | hard-coded | — | n.a. |
| Drawings page | error / "No drawings yet" | `app/project/[id]/drawings/page.tsx:69-73,172-199` | A | `generateDrawingSet` — the **only** surface that actually builds the set | yes (this is where Mudon's error shows) |
| 08 Proposal | "Locked — …" / open | `proposal/ProposalScreen.tsx:81-90` | A | `loadProposalGate` (no firm / no BoQ / pre-H7 / basis) | yes (acceptance by boq id) |
| BoQ — Regenerate | Ready / "Nothing has changed since rev N" / blocked / "Rev N created" | `RegenerateControl.tsx`, `boq/Regenerate.tsx` | A | `regenerateReadiness` + `changesSinceRevision` | yes |
| BoQ — notices | "DRAFT FOR REVIEW" | `boq/Notices.tsx:40-45` | C | `sections.garden.draft` of that revision | n.a. (a property of the revision) |
| BoQ — reference basis notice | "PRICED FROM MARKET REFERENCE" + reviewed / accepted for this revision | `Notices.tsx:107-150` | A + C | `referenceBasisOf`; `reference_basis_acceptances` by boq id; book status | acceptance yes; book status stored |
| BoQ — tier labels | Measured / **Checked** / Market reference / Estimated / To be priced | `lib/provenance/tier-vocab.ts:55`; `tier.ts:58` | A over C | `tierOf`; "Checked" only when `rate_book.qs_validated` (stored flag) | flag stored |
| Revisions — picker, trail | "· approved", "Approved by the firm · date", "Client approval recorded …" | `RevisionsScreen.tsx:164-166, 363-372` | C | `boq_approvals` for that boq id | n.a. (per revision) |
| Firm book | "Reviewed · date" / "Draft — not reviewed" | `firm-book-editor.tsx:101,291`; `RateBooksList.tsx:146` | C | `firm_rate_books.status` — returned to draft on every content write; "Mark reviewed" refused while attention is open | on write only |
| Firm book — attention | "NEEDS ATTENTION · N" | `firm-book-editor.tsx:411` | A | `book-view.ts` (unit check / outlier / conflict) | n.a. |
| Basis control | "Book reviewed" / "Accepted for rev N" / "Not accepted" | `book/BasisControl.tsx:40-62` | C | book status; acceptance by the latest boq id | yes for acceptance |
| Quote review | IN BOOK / READY / HELD · … / CONFIRM MATCH / NO MATCH | `quote-review.tsx:79-90` | C | `firm_quote_lines.status` + `hold_reason` | n.a. |
| 03 Renders — rooms | **LOCKED** / **READY** / RENDERING / FAILED / 3D VIEW | `renders/RendersStudio.tsx:54-63` | C | LOCKED = `approved_designs`; READY = latest `renders.status = succeeded` (QA outcome not required) | no |
| 03 Renders — design check | "DESIGN CHECK · PASSED / FLAGGED / NOT RUN" | `RendersStudio.tsx:330-338` | C | `renders.qa` | n.a. |
| Photo views | ANCHOR / LOCKED / READY / CHECK FAILED / TO UPDATE | `renders/PhotoViewStudio.tsx:68-79,131-143` | C + A | `room_anchors`, `room_photos.locked_render_id`, `gate.outcome`; TO UPDATE = `followsStateOf` | partly: a LOCKED view is never shown TO UPDATE |
| Specification / Suppliers | check mark; "SELECTED SUPPLIERS · N" | `spec/Specification.tsx:213`; `tender/Suppliers.tsx:282` | C | the selections | n.a. |

What this means for C2. Every "Ready" / "Done" / "PASS" that claims a document
or export is good is either a flag (B) or a stored job shown without its
revision (C):
- overview `:161-163`;
- hub `:216-219`;
- rail firm 06 / 08 done;
- DocumentsExport's printed checks.

The gates themselves (A: `preflightChecklist`, `loadProposalGate`,
`regenerateReadiness`, `changesSinceRevision`) are sound. They just aren't what
these badges read. Stored states outside documents (book reviewed, render
LOCKED/READY, `qs_validated`) are listed for completeness. They are out of C2's
scope unless the owner widens it.

---

## 3. Fix plan

### C1 — scope leak + scan (one commit)

1. **Stop printing one project's quotation as another's scope**
   (`lib/boq/joinery-aluminum.ts`, `lib/ground-truth/mudon-actuals.ts`).
   - Retire the per-item `ALUMINUM` lines from the BoQ. Keep the constant as the
     transcription, as with the garden ground truth.
   - Replace them by what **this** plan supports:
     - **Openings on the plan** (R10b `plan_openings` windows and external doors;
       derived widths stay derived): one line per opening, named by **this
       plan's room** (`room_id` on the line). The rate is a market-reference
       AED/m² of glazing derived once from the reference quotation (Σ total /
       Σ area, arithmetic in the note, never a room label). The line carries
       `qty_derived` while the width is derived.
     - **No openings on the plan**: one explicit allowance line, "Aluminium &
       glazing — allowance, no windows or doors on the plan yet". It has a
       reason the user can read, `rate_status: site_assessment`, `qty_derived`
       and no room name. Owner ruling needed: its value (a per-m²-of-floor
       figure from the reference, or 0 / QS to price).
     - **Skylight and stair balustrade**: only from this plan. The balustrade
       only with an in-scope stairs room (the Q-11 multi-level rule); a
       skylight only when drawn. Otherwise no line.
   - Stamp `rate_tier` on every `GT/*` line, so the inspector never has to
     infer `module_reference`.
   - **No migration is needed.** The leak is a code constant. Prod has no quote
     imports, and quote-import entries are already firm-scoped (`firm_id`,
     `FirmOverlay.forProject` refuses another firm's book). If the owner also
     wants imports project-scoped, that needs a ruling (a firm's book is meant
     to price all its projects). It is not this defect.
2. **Provenance wording.**
   - `TIER_DISPLAY.module_reference.detail`: "Mudon ground-truth quotations" →
     "a reference project's transacted quotation".
   - Run every `tier.detail` through `cur()`.
   - Add a NAME_RULINGS entry: a reference project's name or community is
     withheld on every other project's surfaces.
   - `Q-32/Q-33` labels: drop "first-floor".
3. **Regression tests** (pure, in-process).
   - `lib/boq/__tests__/no-foreign-rooms.test.ts`: assemble the BoQ for the
     Jumeirah plan fixture (`lib/plan/__fixtures__/jumeirah-parks-plan-15oct.json`)
     and for Mudon, Arabella and the bathroom. Every line that names a room
     names one on its own plan: a room-label vocabulary built from every
     fixture plan, with the reference quotation's labels added. Mudon must pass
     too (see §1: its labels don't match its own plan today).
   - `lib/provenance/__tests__/no-foreign-quotation.test.ts`: build the review
     model for the Jumeirah fixture. No chain step names another project
     ("Mudon", the reference rooms, rule slugs with room names).
4. **Scan every rendered surface** (`scripts/read-path-leak-scan.ts` + a new
   pure `lib/identity/surface-scan.ts`).
   - In-process, so it runs on prod read-only and in unit tests.
   - Surfaces: `buildReviewModel` (inspector, popover chains, notices, Issues
     navigator), `buildProjectRevisionDiff` (page, JSON, PDF pages), proposal
     pages + preview, hub/overview view, documents preflight, and every printed
     document.
   - Forbidden set: the withheld identities, every other project's
     name/display name, reference-project markers, and room labels not on this
     plan.
   - The pack's `printedChecks` gains the same scope check.
   - Fixture: Jumeirah's stored revision `aacc3876…` (lines + plan rooms, dumped
     read-only into `lib/boq/__fixtures__/`). The test must fail on it today and
     pass once (1) lands.
5. **Re-run Jumeirah**: regenerate on prod only on the owner's instruction.
   - Expected: the 8 `GT/aluminum/*` lines go (−AED 92,449.00 before
     contingency and VAT).
   - In their place: one line per opening on Jumeirah's plan, or the single
     labelled allowance.
   - The diff names the cause.
   - Mudon's next regenerate moves too; the owner decides when.

### C2 — computed statuses + the Mudon export (one commit)

1. **Fix the export at the source.**
   - Add `normaliseGraph` (`lib/plan/geometry.ts`): every array field a reader
     maps over (`elements`, `context`, `openings`, `walls`, `rooms`) defaults to
     `[]`.
   - Apply it wherever a stored graph is read: `loadProposedGraph`,
     `getProposedGraph`, `plan_snapshots` readers.
   - Build each sheet inside a named guard. A failing sheet fails the set with
     "A-102 Proposed / Demolition Plan could not be drawn: …", never a bare
     TypeError.
   - Test: the Mudon snapshot `89f75f37…` (geometry only — no identity) as a
     fixture → `generateDrawingSet`'s A-102 renders.
   - **Owner ruling**: a proposed snapshot older than the plan's last edit
     (Mudon: 29 Jul vs edits since). Either regenerate it from the live plan
     at the next design lock, or print "proposed as locked on 29 Jul" on A-102.
     Today it silently diffs stale geometry.
2. **One status function per document**, from the gates.
   - New `lib/documents/document-status.ts`.
   - "Ready · rev N" **only** when the last validation passed **on the current
     revision**: a `pack_exports` job with `status = passed` whose
     `manifest.boq.id` = the latest `boqs.id` (compare ids, not timestamps).
   - Otherwise "Needs check: <reason>", where the reason is one of:
     - not exported yet;
     - last check failed: <first failing check>;
     - BoQ changed since rev N;
     - the drawings could not be generated: <sheet + error>;
     - flag off → "Not available".
   - The overview's documents card, the firm hub's documents panel, the rail's
     06 Documents / 06 Tender step and the Documents page all read it. The rail
     facts already load `latestPackJobs` (`lib/journey-facts.ts:155`); add the
     drawing-set build result to those facts, so the K2 rule holds: the rule
     lives in the gate, and the badge only reads it.
   - **Fix found on the way**: `journey-facts.ts:158` marks the firm's 06
     Documents step done only for a passed job created **after** the latest
     revision. But an in-app export regenerates the BoQ inside the job
     (`DEFAULT_PACK_OPTIONS.regenerateBoq: true`; `generate-boq` always inserts
     a revision, `route.ts:557`). So that revision is always newer than its own
     job, and the step can never read done after an in-app export. Compare
     `manifest.boq.id` instead. The same applies to DocumentsExport's printed-check
     row (`DocumentsExport.tsx:339-358`): show the job's own revision, and
     "Needs check: BoQ changed since rev N" when it isn't the latest. Never use
     a blocked job's stored checklist in place of the live preflight
     (`:125`).
3. **Tests.**
   - `lib/__tests__/document-status.test.ts`: a drawing set that throws can
     never be Ready; a passed job on rev N−1 is "Needs check: BoQ changed since
     rev N−1"; a failed job names its first failing check.
   - Extend the journey state matrix the same way.
   - A static test: no `"Ready"` string in `components/blueprint/**` or
     `lib/hub/**` outside `document-status.ts`.

Order: C1 then C2, as two commits. `tsc --noEmit` before any push. No prod
write (regenerate, migration) without the owner's instruction.

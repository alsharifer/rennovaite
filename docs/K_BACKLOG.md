# K backlog — known issues parked during the Blueprint (R7) cycle

Items found while building K that are deliberately NOT fixed in the K task that
found them (design ≠ engine; Atelier pages must not regress this cycle). Each
says where it is and why it waits. Newest first.

## Plan geometry — ruled 14–15 Oct (Abdallah); parsing logic NOT changed

- **Floor coverage check (BUILT 15 Oct; the auto "Circulation (unassigned)"
  room is DROPPED).** 01 Plan's plan check warns when the rooms cover less than
  90% of the reading's own whole-floor estimate
  (`parsed_json.parse.provider_total_area_m2`): "Rooms cover 154 of ~185 m² — a
  room may be missing." (`lib/plan/coverage.ts`, `PlanCheckPanel`). Interior
  rooms only; a reading without the estimate (Mudon's predates it) gets no
  check. Measured 14 Oct: inside the rooms' OWN outline both pilot plans are
  under 1% unassigned (Mudon 1.3 m², Jumeirah Parks 1.4 m²) — the gap a missing
  room leaves is at the building's edge, so the yardstick is the drawing.
- **Backlog — outer-wall footprint from the drawing.** The better yardstick
  than the reading's estimate: the building outline from the vector wall layer
  on a cropped sheet, a traced outline otherwise.
- **Concave rooms are kept (checked 14 Oct).** Nothing in reading → repair →
  save makes a bbox or a hull (repair is a boolean difference; the editor's
  save reshapes only overlapping rooms). On prod 10 of 133 original readings
  are concave (Jumeirah Parks' Kitchen 8 vertices, Powder Room 7). Rectangles
  appear where (a) a room the sheet labels but the model missed is placed as a
  rectangle of its printed size (`placeholderPolygon`, cropped sheets only), or
  (b) the model squares off small steps (Mudon's Dress / Bath).
- **"Fix overlaps" never moves a room (FIXED 15 Oct).** The editor's fix used
  to push whole rooms apart by their bounding boxes (and flatten a room pushed
  off-canvas to its bbox) — `lib/plan/separate.ts`, deleted. It now TRIMS the
  shared floor from one room of each pair (`lib/plan/trim-overlaps.ts`; the
  surer room keeps it, then the smaller): a room only loses area, every point
  stays inside its own outline (`staysWithin`), and what it will not do — remove
  a room, cut a hole — it reports instead. The J0 worst parse: 12 pairs → 0,
  every room inside its own outline.
- **Fix overlaps review (15 Oct — owner): exact, previewed, printed-aware (DONE).**
  (a) The 108.8 m² the editor showed on J0 was not a double trim — the geometric
  trim was exact (the rooms combine to 128.6 m² at the plan's scale, and that is
  what the trim leaves); the editor re-measured trimmed rooms from their outline
  while the others kept the reading's areas, and J0's areas (145.7) do not add
  to its 166.1 total. Now a trimmed room's area drops by exactly the floor
  removed, and a trim that would split a room is tried the other way round or
  reported. Tests: total after = rooms combined ±0.1 m² (J0 at its own scale:
  166.1 → 128.6), three rooms over one corner, no split. In the editor J0 reads
  "total 145.7 → 112.8 m²" — the same exact rule over the reading's own areas.
  (b) Preview + Apply. (c) The room further over its printed size loses; the
  plan check flags a room > 10% off its printed size.
- **Mudon alignment — diagnosed 15 Oct (read-only), NOT fixed.** One raw
  reading of the sheet's crop (`lib/parse/__fixtures__/mudon-sheet-reading.json`)
  against the sheet's own data:
  - *Frame*: the parse rasterises the plan REGION (`detectPlanRegion`: ink
    components + label anchors + 8 pt margin) — on Mudon 18.8 × 35.3 m, the
    building (grid 19–25 × A–N, 12.2 × 20.1 m) only 65% × 57% of it; the region
    carries the grid bubbles, both dimension chains, the section marks and the
    notes. The model returns 0–1 over that image and the code takes them as-is.
    No x/y scale is taken from the sheet for geometry: the 1:100 off the text
    layer sizes only label-only placeholders, and buildPlanGraph derives ONE
    isotropic factor from the printed areas — so an anisotropic stretch is never
    corrected and a uniform one is hidden.
  - *What the model did*: top edge = grid A (0.280 vs 0.281); left edge 2.8 m
    left of grid 19, where the A…N bubble strip and the grid lines begin; y
    stretched from the top, bottom 6.7 m past grid N. ONE transform fits the 13
    printed tags: x' = 0.942·x + 0.146 (R² 0.985), y' = 0.636·y + 0.112
    (R² 0.919) — widths about right, height ×1.57, shifted left one strip.
    Grid lines found in the vector layer (dashed 0.24 pt; the bubbles are
    glyphs, not text), gaps checked against the printed chain.
  - *With the transform*: tags inside their own room 3 → 8 of 13; printed sizes
    within 10% 0 → 3 of 8. What stays: Toilet +88%, Bath F08 +35%, Bedroom 3
    +32% — the model draws in coarse steps (Master Bedroom and Bedroom 3 the
    same 0.28 × 0.20 box). Alignment is the main error, not the only one.
  - *Stairs / Family Area*: the model's own "Family Area" outline lies on the
    stair treads as read; with the transform it holds the FAMILY AREA tag (F01)
    and sits on the family area — the "swap" is the y-stretch. The model's
    "Stairs" outline lands on the treads in neither frame, and the sheet prints
    NO stairs tag, so nothing on the sheet checks it. Reconcile renamed neither
    (it scores name 3 · tag inside 2 · nearness 1 in the model's frame and
    renames the winner; here the model had read the tags, so names decided).
  - *Acceptance test*: `lib/parse/__tests__/mudon-alignment.test.ts` — every
    printed tag inside its own room, every printed size within 10% (`it.fails`
    today; flip with the fix). Overlay: `screenshots/plan-geometry/mudon-alignment-overlay.png`.
  - *Candidate fixes (owner's call)*: crop to the building (grid 19–25 × A–N
    from the vector layer) so the model's frame IS the building; and/or fit the
    x/y scale + offset to the printed tags and sizes after the model, before
    reconcile. Terrace accuracy waits for this.
- **Mudon (prod) — no hand fix, no restore (owner, 15 Oct); diagnosis above.** Its stored outlines
  sit off the drawn walls (the old fix pushed rooms apart and left 4 px gaps, so
  no two rooms share a wall: 0 party walls). Dry runs 15 Oct, nothing written:
  - *Restore positions from the original reading*: not viable. Mudon's reading
    IS the J0 worst parse (166.1 m², 13 rooms, 12 overlapping pairs); moved back,
    every room shifts 1.1–10.0 m, sizes and even orientations disagree with the
    stored rooms (Bedroom 3 stored 6.19 × 3.28 m, read 5.33 × 6.00), and 9
    overlaps return.
  - *Re-read with today's parser* (cropped sheet path): 14 rooms, Σ 129.3 m²,
    0 overlaps — but stretched ~1.5× vertically past the building; Bath, Toilet,
    Bedroom-4 and a Terrace land below the drawn floor. Not a basis either.
  - Openings: R10b has NOT run on prod Mudon (nobody has opened its Plan since
    the deploy). Replaying one reading: 12 placed, 0 dropped on the drifted
    rooms — but 0 of 9 room-to-room openings sit on a wall the two rooms share
    (there are none), so each door deducts from one room's wall face only.
  - The fix is a hand-corrected outline on 01 Plan (safe now that Fix overlaps
    never moves a room) or better parsing (this backlog) — the owner's call.
- **Jumeirah Parks (prod) — confirmed widths read as measured.** All 19 found
  openings were confirmed at 18:39 UTC on 14 Oct, under #109's rule, so every
  width is `derived = false` (estimated, but reads as measured). Fix once the
  follow-up (#110) is live: set `derived = true` on detected rows whose width
  was not printed. Data change — APPROVED 15 Oct, to run once #110 has merged
  (position and kind stay confirmed).

## R10c — plan-faithful renders: guards ruled 14–15 Oct (rules BUILT in `lib/render/cameras.ts`)

- **Inside the room**: every default camera is asserted inside its polygon with
  ≥ 0.4 m to every wall (`assertInside`); one that cannot be pulled in is
  dropped, never rendered from.
- **Arms**: a room splits into the fewest maximal rectangles (`roomArms`); an
  arm COUNTS only when both sides of the floor it ADDS are ≥ 1.5 m (a shallow
  bay whose rectangle runs through the room does not count). < 2 counting arms
  = a rectangle: the default 2 views from both ends of the main arm. Otherwise
  one camera per counting arm, at most **3**. Jumeirah Parks' 8-vertex Kitchen
  (a 3 cm step) → 2 cameras, tested on its prod polygon
  (`lib/render/__fixtures__/jumeirah-parks-rooms.json`).
- **Spend** (given 14 Oct): ≈ $0.38 per view → Jumeirah Parks ≈ $6.80, Mudon ≈
  $7.60 at 2 views / room.
- **Acceptance room (Jumeirah Parks): "Hall"** (`f506e79f…`, type dining,
  18 m², 2.66 × 5.84 m). Default cameras: (16.75, 8.97) m looking south and
  (16.75, 13.43) m looking north, both along its long axis. Openings on the
  plan: a 3.5 m opening to the Living Room (west wall), the Powder Room door
  (north), the Stairs door (east). Not on the plan: any window on the Hall's
  south (exterior) wall, and an opening to the Kitchen (the Powder Room lies
  between them on the stored plan). "Kitchen opening left, floor-to-ceiling
  windows right" is a view looking EAST — add those two openings (or fix the
  outline) first; the acceptance shot is then an explicit east-facing camera
  from the west side of the Hall, beside the two defaults.
  **Ruled 15 Oct**: the two defaults are the placement test (pinned in
  `lib/render/__tests__/cameras.test.ts`); the east-facing camera is HELD until
  the owner confirms where the dining area really is.

## R10b (2026-10-14) — openings found on the drawing

- **Widths are rough.** The detector reads coarse fractions of a room's side
  (0.15–0.2 typical), and a parsed plan's metre scale is isotropic over
  normalised coordinates of a non-square crop, so widths run short (a 2–3 m
  balcony glazing read as two ~0.7 m windows). Rooms, sides, kinds and what
  each opens to are what renders need first; the owner adjusts widths on the
  Openings layer. Fix candidates: ask for jamb points on the drawn wall in
  pixels of a crop around the room; carry an x/y scale per plan.
- **The app's room outlines can be far from the drawing** (Jumeirah Parks: the
  stored "Dining Room" covers the hall by the P.W.D; the dining table sits in
  "Living Room"). Detection assigns openings to the app's rooms, so an outline
  that names the wrong space gets the wrong openings. A plan-vs-drawing check
  (outline off its walls) would surface it; not built.
- **Renders: the studio label** ("detected — not yet confirmed") is unit-tested
  only; no render with `openings_basis` exists until R10c's first renders.

## K12 (2026-10-14) — rooms in this renovation

- **058 before deploy** (prod): `rooms.in_scope`. Every reader tolerates its
  absence (nothing is out of scope); the 01 Plan checklist answers 500
  `migration_required` until it runs.
- **Q-11 ruled (14 Oct)** — see CLAUDE.md K12. "Villa / multi-level" is read
  from the project's NAME (villa / townhouse / duplex): add a property type
  (villa · townhouse · apartment, levels) at intake and read that instead.
- **Aluminium & glazing: scale by in-scope openings** (ruled whole-home for now,
  with the line note). The S6 list names locations (guest bedroom, master
  bedroom, master bathroom …): drive it from the plan's openings in in-scope
  rooms instead of the fixed reference quotation.
- **Timeline reads rooms across every plan** of the project (pre-existing,
  `lib/timeline/load.ts`), not just the latest; scope is applied to the latest
  plan's rooms.
- **Scope on the phone**: the checklist sits under the canvas (the page's
  one-column layout); no separate phone design.

## K11 (2026-10-14) — from the pilot walkthrough

- **056 and 057 before deploy** (prod): `projects.draft_since` (the intake
  insert and Continue fall back without it, nothing is a draft) and the applied
  corrections (`boq-apply` answers 500 `migration_required` without it; every
  read degrades to "nothing applied").
- **A firm admin may attach / detach projects created by members of their
  firm** (approved 14 Oct as the next step after creator-only attach). Today
  attach / move is the project creator's act (`assignProjectFirm`); detach is any
  member of the current firm. Extend: an admin of the target firm may attach a
  project whose creator is a member of that firm; the preview and the 409 / 403
  wording follow.
- **Abdallah's corrections on prod** — the read-only check of which correction
  rows exist and whether they would now apply waits for his OK. A correction
  saved before 057 has no `line_key`: it applies from its own line's
  Corrections tab (the row key pins it), not blind.
- **The member name on a cause** is the account's profile name, else the
  e-mail's local part ("dev-scripts+k11-owner" on dev). A display-name field in
  Settings would make "Price added by …" read as a person.
- **Revert is whole-revision**: "Revert to rev N" restores rev N's figures and
  stops every correction applied after it. Undoing ONE of several later
  corrections (keeping the others) is not offered — it needs a per-correction
  "stop applying" + regenerate-from-stored, a small follow-up.
- **The BoQ PDF still prints a priced garden line's "(… QS to price)" aside**
  when that aside is part of the line's identity (garden labels key on the
  description) — stripping it would orphan the price on the next revision. The
  screen and the proposal drop it. Fix = write `item_key` on every unpriced
  garden line at generation.
- **Issues navigator on the phone**: the button is desk / tablet only (the
  phone top bar holds the step switcher); J / Shift+J and the inspector's
  "Next issue" work everywhere.

## K10 (2026-10-13) — from the K8/K9 QA

- **Sign-in settings are dashboard-only (Abdallah).** docs/AUTH.md → "Sign-in
  reliability" lists them: prod Site URL `https://rennovaite.fit`, Redirect URLs
  `https://rennovaite.fit/**` AND `https://www.rennovaite.fit/**` (the apex
  307s to www, and the sign-in action builds the link from the visitor's host);
  dev Site URL `http://localhost:3098`; Email OTP Length 6 on both (dev issues 8
  today — the form accepts 6–10); paste `supabase/templates/magic-link.html` into
  both projects (without it the e-mail carries no code). Prod's current values
  were not readable from this machine.
- **Live phone / laptop sign-in by code** — needs the template pasted first;
  verified headless on dev with generateLink's code (desktop + phone viewport),
  not with a real e-mail.
- **No UI to name a firm admin.** 055 makes the firm's creator its admin (else
  its earliest member); `firm_members.role` can only be changed in SQL. A
  Settings → Firm members list with a role control is the obvious home.
- **Project purge runs dry until `PROJECT_PURGE_APPLY="true"`** in Vercel — set
  it after the first dry-run logs look right (it logs ids and counts only).
- **055 before deploy**: the soft-delete columns and firm roles; the proxy and
  the access resolver tolerate their absence, but delete needs them.
- **Duplicate components — engine resolution (K10 #10 left it out of scope).**
  `findComponentDuplicates()` finds components charged by two mechanisms (an
  R-xx line and an accessory selection, a joinery lump and its own line) and the
  BoQ keeps BOTH; the owner now reads "N items may be counted twice — we'll
  confirm before tender", the firm the mechanism. Deciding which line survives
  (per component, recorded, regenerated) is an engine change with a pricing
  consequence — it needs a QS ruling per pair before it is built.

## K9 (2026-10-13) — the K8 review's follow-ups

Done: document fonts (Plex Sans / JetBrains Mono / EB Garamond, OFL), the
garden timeline from the BoQ programme, ink-only drawings + render pack, sheet
REV = the BoQ revision, the per-firm proposal reference (054).

- **Proposal prefix has no control yet.** It is derived from the brand at the
  first issue and kept on `firms.proposal_prefix`; a firm that wants another
  prefix needs it set in SQL BEFORE its first issue. A field in the proposal
  setup is the obvious home.
- **A reference is not retired.** A project that changes firm gets a new
  reference from the new firm's series; the old one survives only in pack
  manifests and the `pack_exported` event (`detail.reference`).
- **Plan revisions still have no number** (the 3D view's "from plan rev N").
  The sheet REV is the BoQ's — the K8 ruling — not a plan revision.

## Found in K8 (2026-10-13) — everything on Blueprint, Dark open

**Ruled in the K8 review (13 Oct) — #100 approved for squash-merge**

- **PDF typefaces → done in K9.** Add IBM Plex Sans, JetBrains Mono and EB Garamond
  (OFL) as TTF/OTF with their licence files; every server-rendered document
  uses them (resvg reads TTF/OTF only — today they print in Arial / Consolas /
  Georgia).
- **Terms placeholder → done in #100.** The "project fee is AED 1,000" line
  (and the line crediting that fee) is replaced by "Any fee is shown and
  agreed before you are charged." Counsel finalises. The parked, unrouted
  `components/marketing/home-landing.tsx` still prints "Project fee AED
  1,000" — fix it if that landing ever returns.
- **Garden timeline → done in K9.** Never the interior model for a garden project:
  show the BoQ programme duration with the derived mark and the basis note
  "scaled from one real Dubai garden project (~90 days)". Interior unchanged.
- **Supplier choices into the BoQ → not this cycle.** `vendor_selections` are
  saved and the Tender page's live total follows them, but `generate-boq`
  never reads them; the page keeps its "scenario" label. Revisit after the
  pilot.
- **Drawings → done in K9, ink only.** No brass / terracotta inside sheets
  (`lib/drawings/plan-sheet|demo-sheet|garden-sheets|garden-elevations.ts`,
  ~33 uses): demolition = dashed, estimated items = hatch + the derived glyph,
  symbols in ink.
- **/community and /marketplace → done in #100.** The stub pages are deleted;
  the 307 redirects to the projects home live in `next.config.ts`.
- **Also done in K9**: the proposal reference = a per-firm sequence (e.g.
  `MFO-P-0001`) stored on the proposal row; the drawing sheet's REV = the BoQ
  revision the pack was generated from (never "—").
- **Still open — headline basis.** Frames print "excl. VAT" beside headline
  totals; every K8 surface prints the stored grand total "incl. contingency
  and VAT" (the figure the BoQ pins) and says so. Not ruled; unchanged.

**Not built (shown honestly, or left out, with the reason)**

- No firm contact line, "Design" or "Acceptance" sections in the proposal
  (67:1396); no plan revision numbers (the 3D view's "from plan rev N"). (The
  proposal reference and the sheet REV landed in K9.)
- Supplier distance (60:913): the catalogue has none — the old page printed a
  hard-coded per-brand table; dropped. "Send scope to contractors" has no
  in-app sending: it explains the hand-over and links to Documents.
- Reading your plan (63:4510): "Cancel upload" (the project exists before the
  reading starts) and "you can leave this page" (a parse is tied to its
  request); "Re-run parse" past 3 min would race the first reading — the
  slow state opens the plan instead.
- Help drawer (65:1247): no reply-time promise; no in-app way to add someone
  to a project (operator script) — the article says to ask.
- E-mails (69:1422 / 69:1438): templates are in `supabase/templates/` and the
  local `config.toml`; the hosted dev + prod projects need the subject + HTML
  pasted in Auth → Email Templates (check their OTP expiry is 3600 s — the copy
  says 60 minutes). Supabase sends HTML only (no plain-text part). Nothing in
  the app sends the invite yet (membership is granted by
  `scripts/project-member-add.mjs`).
- The rate-books list (63:1094) has no "Your role" column: firms have no roles.
- The 2D plan inspector and the 3D view list a line's REF / description / qty
  but no amount — an amount needs its mark; the BoQ row carries it.

**Housekeeping**

- `29cb63d` (#15) and `f2d9e5d` (#16) each picked up staged deletions from
  the plan-editor restyle (`plot-size-fields`, `InspectPanel`,
  `AtelierCanvas`); `f8966f0` restores a building tree. Squash on merge if a
  bisectable history matters.
- `app/globals.css` K7 hit-area rule still names `[data-atelier]` (matches
  nothing now); `components/marketing/*` remain parked.
- `scripts/k6-front-door-check.mjs` and `scripts/k5-plan-check.mjs` read the
  K8 step keys now (`plan`, `cost` / `tender`).

## Front door (13 Oct, Abdallah)

No public landing during the invite-only pilot: `/` and `/rennovaite` 307 to
`/auth` (signed in: `postSignInPath()`), via `lib/auth/front-door.ts`.

- **`PROPERTY_OS_LANDING` is dead** — nothing reads it any more. Remove it from
  `.env.local.example`, the CLAUDE.md env table / flag section, the Vercel
  envs, and `FEATURE_FLAGS` + the `flagLike` pattern in
  `lib/boq/__tests__/flag-invariance.test.ts`.
- **Parked, delete or rebuild after pilot**: `app/_components/property-os-landing.tsx`
  (`PropertyOsLanding`), `components/marketing/home-landing.tsx`
  (`HomeLanding`) and `app/_components/watch-demo.tsx` — unrouted, not
  deleted. `PropertyOsLanding` still links to `/rennovaite` and HomeLanding's
  CTAs into `/project/new`; fix those if either comes back.
- **Lift the noindex** on `/auth`, `/privacy` and `/terms` (`robots` in
  `app/auth/page.tsx`, `LEGAL_ROBOTS` in `components/blueprint/legal/LegalTemplate.tsx`)
  when a public landing returns; restore the TopNav / Footer product links
  then too.
- **Supabase Site URL** still points at the root: a fallen-back magic link
  lands on `/`, which the proxy forwards (`?code=` → callback, `?error_code=`
  → /auth) before the page's redirect runs. Setting the Site URL to `/auth`
  would save a hop; not required.

## Found in K4 (2026-10-12)

- **"Link causes to lines" has no record behind it** (07 Revisions, 21:450).
  A window event (a session decision, a plan edit) can only be shown as "not
  linked to lines": nothing stores which lines an event moved. Needs a
  `cause_links (event, boq_id, line_key)` record + a route; the button is
  disabled with that reason until then.
- **Internal review pack** (06 Documents, 22:548) — a DRAFT-watermarked pack
  for the firm's own team that would leave without the client gates. Not
  built: it is a release-rule decision (T5 says every document leaves through
  the one gate) before it is a watermark. Shown disabled with its reason.
- **Reference basis locks the proposal, not the pack.** The frame says
  "BLOCKS CLIENT PACK"; today's gate (L4) refuses only the client proposal —
  drawings, render pack and BoQ PDF still export on a market basis. Extending
  the gate is a pricing-policy change; Documents labels the row truthfully
  ("BLOCKS CLIENT PROPOSAL") until it is decided.
- **Conflicts cannot occur since H8** (051's one-active-entry index); the
  conflict UI in Rates & Basis is kept for data that predates 051 and was not
  exercisable on dev. The walkthrough covers outliers and unit checks only.
- **Revisions "cause" on the hub / revisions table** shows the FIRST recorded
  cause of a revision; a revision with several causes reads "Rates · … " for
  one of them. A per-revision cause summary wants the same record as
  "Link causes".

## Found in K3 (2026-10-12)

- **"Show on plan" opens the plan, not the element.** The plan page takes no
  selection parameter; K5 (scope chrome) can add one and the inspector's link
  can carry the line's `element_refs`.
- **The four sensitivity modifiers carry no provenance** (K0.4 backlog, still
  true): +15 / −8 / +6 / −3 % are hard-coded in
  `components/blueprint/boq/WhatIfTab.tsx`.
- **A promotion request is the firm attribution**, not its own record: a rate
  correction attributed to the firm is a promotion candidate. If K4's
  "Corrections to promote" needs to tell "requested" from "attributed", that is
  an additive column (migration after 053).
- **The BoQ page is slow in dev** (7–12 s application time under load; one 64 s
  outlier right after a pack export). Its reads now run in parallel; the
  remaining cost is the provenance context and the proposal gate — measure on
  prod before optimising.
- **Section order vs the J3 frame**: canonical (H7) puts Plumbing before the
  external sections; the frame drew it after Irrigation. Code wins; the frame
  should be updated.

## Found in K2 (2026-10-12)

- **01 Project & Plan has no route of its own.** Blueprint v0.4 §7 makes it the
  intake (parse / draw / photos, client and site details); for an existing
  project there is no per-project intake page, so the step opens the plan
  (`FIRM_STEPS`, `lib/journey.ts`) and 02 Scope owns that route's active
  state. Decide in K5/K6 whether 01 gets a project-details page.
- **"Upstream change since rev" had no gate** — now ONE function,
  `changesSinceRevision` (`lib/boq/changes-since.ts`), over the recorded causes
  (plan / design edits, firm book entries created or retired, session
  decisions; corrections are not changes). **K3's Regenerate must call it** —
  the rail already does — and the runbook check (no recorded change ⇒
  regenerating leaves the BoQ unchanged) is its test.
- **Revision number = count of BoQ rows.** The rail's "rev N" counts the
  project's `boqs` rows (as the K0 ruling allowed until 053 stores
  `revision_no` — 052 went to H9's upload bucket); `listRevisions` drops rows whose sections are not a valid BoQ,
  so the two can differ on a project with a malformed row. Migration 053
  settles it.
- **Owner rail: "Intake" links to `/project/new`** (the owner list is
  untouched) — on an existing project that starts a new one. K6.
- **The phone step drawer and the rail each render a "Firm journey" nav**; the
  drawer's is inside a closed `<dialog>` (out of the accessibility tree until
  opened). Revisit in K7's audit.

## Found in K1 (2026-10-12)

- **Atelier icon sizes ignore `text-*` utilities.** Google's icon stylesheet
  set `font-size: 24px` on the icon class, unlayered, which outranks
  Tailwind v4's layered utilities — so `material-symbols-outlined text-[18px]`
  (46 files; measured: `text-[22px]` computes 24px) has always rendered at 24px. K1 kept that exactly (the
  Atelier class now carries the 24px itself, `app/globals.css`) so no Atelier
  page moved. Fix when each page is redesigned; Blueprint's `<Icon>` is layered
  and sizes correctly.
- **Counsel's legal drafts still spell the product "RennovAIte"**
  (`content/legal/*.md`, verbatim drafts). The tab title already reads
  RenovAIte (`components/legal/LegalPage.tsx`); ask counsel to use RenovAIte in
  the published text.
- **LLM system prompts still say "RennovAIte"** (`app/api/generate-boq/route.ts`,
  `lib/parse/providers/inhouse.ts`). Not user-facing; changing the parse prompt
  can change parse output, so it waits for a parse-quality pass.
- **Returning users land on new-project intake.** `/project` (the signed-in
  home for `/`, `/auth` and the auth callback) redirects to `/project/new`.
  A returning firm probably wants its project list — K2's route triage.
- **The sign-in rate-limit message says "wait a minute"**; Supabase's built-in
  mailer limits magic links per HOUR. With H9, or when custom SMTP is set up.
- **DONE in H9 (12 Oct)** — ~~Uploads over ~4.5 MB never reach the app~~ (Vercel's function body limit —
  measured 12 Oct: 4.3 MB → app, 4.7 MB → `413 FUNCTION_PAYLOAD_TOO_LARGE`).
  Floorplan PDFs and drawings are not compressed. **H9**: direct-to-storage
  signed uploads for `/api/upload`, `/api/project-asset`, quote import. K1 only
  aligned the app's own limits (plan 20 MB both sides, structured 413).
  Written up as `docs/H9_DIRECT_UPLOADS.md`.

## Ruled into the backlog at K0 (2026-10-12)

- **shadcn colour bridge disagrees with itself** (`tailwind.config.ts` vs
  `app/globals.css :root`): `bg-primary` = `#7a5518` (MD3) while `--primary` =
  brass `#a4793a`; `bg-background` `#fdf9f2` vs `--background` `#f7f3ec`;
  `bg-secondary` `#535f74` vs `--secondary` bone. Atelier only; leave until the
  last Atelier page goes.
- **`--radius-md` is undefined** (no `@theme inline` radius mapping), so the
  shadcn Button's `xs` / `sm` / `icon-*` sizes
  (`rounded-[min(var(--radius-md),…)]`, `components/ui/button.tsx`) render
  square. `--radius` itself is set but wired to nothing. Atelier only.
- **Garden "Cost sensitivity" toggles have no source**
  (`app/project/[id]/boq/_components/boq-view.tsx` `SENSITIVITY_TOGGLES`:
  +15 / −8 / +6 / −3 %) — the one number on the BoQ page with no provenance.
  K3 ships them with the engine's copy ("illustrative ±% of the project total
  — never the BoQ"); source them or hide them for firms later.
- **Dead Atelier tokens on the plan pages** (`status-error`, `status-success`,
  `bg-bg-elevated`, `text-label-sm`, `brand-hover`, a purple glow on the default
  Button) render as nothing — from the abandoned `claude/priceless-jones-bb887c`
  branch's inventory. K5 restyles that chrome.

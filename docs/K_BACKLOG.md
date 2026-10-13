# K backlog — known issues parked during the Blueprint (R7) cycle

Items found while building K that are deliberately NOT fixed in the K task that
found them (design ≠ engine; Atelier pages must not regress this cycle). Each
says where it is and why it waits. Newest first.

## Found in K8 (2026-10-13) — everything on Blueprint, Dark open

**Ruled in the K8 review (13 Oct) — #100 approved for squash-merge**

- **PDF typefaces → K9.** Add IBM Plex Sans, JetBrains Mono and EB Garamond
  (OFL) as TTF/OTF with their licence files; every server-rendered document
  uses them (resvg reads TTF/OTF only — today they print in Arial / Consolas /
  Georgia).
- **Terms placeholder → done in #100.** The "project fee is AED 1,000" line
  (and the line crediting that fee) is replaced by "Any fee is shown and
  agreed before you are charged." Counsel finalises. The parked, unrouted
  `components/marketing/home-landing.tsx` still prints "Project fee AED
  1,000" — fix it if that landing ever returns.
- **Garden timeline → K9.** Never the interior model for a garden project:
  show the BoQ programme duration with the derived mark and the basis note
  "scaled from one real Dubai garden project (~90 days)". Interior unchanged.
- **Supplier choices into the BoQ → not this cycle.** `vendor_selections` are
  saved and the Tender page's live total follows them, but `generate-boq`
  never reads them; the page keeps its "scenario" label. Revisit after the
  pilot.
- **Drawings → K9, ink only.** No brass / terracotta inside sheets
  (`lib/drawings/plan-sheet|demo-sheet|garden-sheets|garden-elevations.ts`,
  ~33 uses): demolition = dashed, estimated items = hatch + the derived glyph,
  symbols in ink.
- **/community and /marketplace → done in #100.** The stub pages are deleted;
  the 307 redirects to the projects home live in `next.config.ts`.
- **Also K9**: the proposal reference = a per-firm sequence (e.g.
  `MFO-P-0001`) stored on the proposal row; the drawing sheet's REV = the BoQ
  revision the pack was generated from (never "—").
- **Still open — headline basis.** Frames print "excl. VAT" beside headline
  totals; every K8 surface prints the stored grand total "incl. contingency
  and VAT" (the figure the BoQ pins) and says so. Not ruled; unchanged.

**Not built (shown honestly, or left out, with the reason)**

- No proposal reference number, firm contact line, "Design" or "Acceptance"
  sections in the proposal (67:1396); no plan revision numbers (the 3D view's
  "from plan rev N", the sheet's REV prints "—").
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

# K backlog — known issues parked during the Blueprint (R7) cycle

Items found while building K that are deliberately NOT fixed in the K task that
found them (design ≠ engine; Atelier pages must not regress this cycle). Each
says where it is and why it waits. Newest first.

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

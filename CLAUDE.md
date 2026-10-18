@AGENTS.md

# RenovAIte

(The product name is **RenovAIte** in every user-facing string since K1; the
repo, routes, domain, packages and env keep the lowercase `rennovaite`.)

AI-powered villa renovation platform for Dubai. Takes a homeowner from floorplan
and photos to a fully-specified renovation (moodboards, room-by-room concept
renders, material selections, and a priced Bill of Quantities) in days rather
than months.

## Canonical demo villa (pilot)

- **Location:** Mudon Al Naseem, Dubai
- **Unit:** 4-bedroom villa, first-floor refit
- **Rooms:** 1 master bedroom, 2 secondary bedrooms, 2 bathrooms, 1 central
  living area
- **Assets live in** `/assets` (before photos, labour rates CSV, first-floor
  plan PDF, moodboards). These are the inputs the pilot flow operates on —
  treat them as canonical when building or testing.

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS
- shadcn/ui components (base color: **neutral**); icons are ONE font,
  Material Symbols Sharp (no lucide — removed in K1; `components.json`
  `iconLibrary: "none"`)
- Anthropic SDK (`@anthropic-ai/sdk`) for reasoning / design generation
- Replicate SDK (`replicate`) for image generation (render rooms, moodboards)
- Supabase (`@supabase/supabase-js`) for storage + persistence
- zod for schema validation at boundaries (LLM output, API inputs, env)
- PostHog for product analytics (env var wired, client not yet added)

## Two design systems — which rules apply where (K-series)

**Since K8 (13 Oct) every routed page is Blueprint** — the route scan
(`lib/__tests__/route-scan.test.ts`) walks every page's UI module graph and
finds no Atelier class, shell or canvas; `ATELIER_PENDING` is empty and must
stay empty. Blueprint pages carry `data-system="blueprint"` on their root and
follow the R7 spec — `design-refs/r7-handoff/R7_Handoff_Specs.md` (tracked) —
and the sections below. Dark, System, IBM Plex Sans and Material Symbols Sharp
300 are live.

Atelier Precise survives only in the PARKED marketing components
(`components/marketing/*`, `app/_components/*`, unrouted — the scan skips
them) and in `tailwind.config.ts` tokens they use. Do not add Atelier to a
routed page; a new page frames itself in `ProjectShell` / `AccountShell`.
Never restyle a shared component for one surface — fork it under
`components/blueprint/`.

## Brand — Blueprint (R7; K-series)

Source of truth: Figma **RenovAIte — Blueprint Design System (R7)**
`vgibM0F9SdEQErBaTxjUqH`; spec `design-refs/r7-handoff/R7_Handoff_Specs.md`;
build order `KSeries_Build_Pack.md` (docs root). `design-refs/` is gitignored
except `design-refs/r7-handoff/`.

### Tokens

- **`design-refs/r7-handoff/tokens.css`** is GENERATED from the Figma variables
  — never hand-edit it; change Figma and re-export. It is imported once by
  `app/globals.css`, and every rule in it is scoped to
  `[data-system="blueprint"]` (so it cannot touch an Atelier page).
- **Tailwind names are the `bp-*` namespace** in `tailwind.config.ts` (each →
  a `var(--color-*)` token): `bg-bp-surface-base|raised|sunken`,
  `text-bp-ink-primary|secondary|tertiary|on-inverse`,
  `border-bp-line-hairline|strong|control`, `bp-brass` / `bp-brass-text`,
  `bp-focus-ring(-inverse)`, `text-bp-prov-{measured,validated,market,derived}-{mark,text}`,
  `text-bp-prov-unpriced-mark`, `bg-bp-alert-surface` / `text-bp-alert-ink`;
  fonts `font-bp-sans|mono|serif`. Outside a Blueprint root they are inert.
  Never add a Blueprint colour as a hex.
- **Type** is the `.t-*` classes from tokens.css (`t-heading-lg`, `t-body-sm`,
  `t-label-caps`, `t-num-md`, …). Numbers are always mono + tabular.
- **Zero radius.** No global reset (it would break Atelier and native
  controls): Blueprint components simply never use `rounded-*` other than
  `rounded-none` (a test enforces it in `components/blueprint/`). `--radius`
  is not wired in this app.
- **Colour means one thing**: brass draws LINES only (rail marker, tab
  underline, selection, focus); provenance colour draws MARKS only (the glyph
  and its tier label); numbers are ink; no status hues; every error / refusal
  is the inverse block (`.surface-inverse bg-bp-alert-surface
  text-bp-alert-ink`).

### Fonts, icons, theme

- Fonts are self-hosted `next/font/local` variables on `<html>`:
  `--font-plex-sans` (IBM Plex Sans latin 400–600, Blueprint UI),
  `--font-jetbrains-mono`, `--font-eb-garamond`; tokens.css builds
  `--font-sans/mono/serif` from them inside the Blueprint scope. Plex Sans is
  also the base face on `<html>`; Plex Sans Arabic the Arabic one. (Inter and
  Rubik were removed in K10 — nothing routed used them.)
- **One icon font**: Material Symbols **Sharp**, SELF-HOSTED since K10 — a subset
  of the icons the app draws (`public/fonts/material-symbols-sharp.woff2`,
  `lib/icons/subset.json`; regenerate with `scripts/k10-icon-subset.mjs
  <codepoints>`), weight 300–400, FILL 0, GRAD 0, opsz 20–24, ~76 KiB,
  preloaded, `font-display: block`; icons are a 1em clipped box and stay
  transparent until `<html data-icons="ready">` (`lib/icons/ready.ts`), so a
  ligature name is never visible. **A new icon name must be in the subset** —
  `lib/icons/__tests__/subset.test.ts` fails otherwise. Blueprint: `<Icon name>` (`components/blueprint/Icon.tsx`, `.bp-icon`:
  weight 300, grade 0, opsz 20, 20px, layered so size utilities work).
- **Theme**: `rv_theme` cookie = `light` (default) | `dark` | `system`
  (`lib/theme.ts`). ONLY the pre-paint inline script reads it and sets
  `<html data-theme>` (System follows the OS); the root layout never reads a
  cookie (K1 review — it made every page dynamic; spec §1.8's server-side read
  is superseded), and `<html>` carries `suppressHydrationWarning`. `<ThemeSwitch>` sets it. Dark is the
  designed palette from the tokens — never a filter. `data-skin="warm"` sits
  only on the intake (`/project/new`) root (the owner landing is unrouted —
  see "Front door" below); it does nothing until that root is Blueprint.

### Numbers + provenance primitives (K1)

- **Formatting** (`lib/format/aed.ts`, still the ONE formatter):
  `formatAED(n)` → exactly 2 dp, en-US grouping, H7 `money2` rounding first
  (`{ prefix: true }` → `AED …`); `formatQty` (integer if integral, else 2 dp);
  `formatDelta(n, "aed" | "pct")` (true minus U+2212, `+` on positives, `—`
  at zero); `formatRatio` (`×17.9`); `headlineSpokenText` (the screen-reader
  headline, never "star"). Displayed rate × displayed qty = displayed amount.
- **`tierOf(line, section, { qsValidated })`** (`lib/provenance/tier.ts`,
  SERVER-side — it reaches the I4 provenance module and identity curation)
  → `{ qty, rate, amount, qtyWhy, rateWhy }`. qty = the line's `qty_derived`;
  rate = I4's `lineTierKey` → firm tiers = measured ("Own basis"), reference =
  **validated only when `rate_book.qs_validated`**, else market; a selected
  product = market when priced (never validated), else derived; every fallback
  = derived; `site_assessment` / `indicative` / `needs_selection` cap it at
  derived; a QS-to-price line at 0 = unpriced. amount = the weaker (R1). Pinned
  by the Arabella rev-4 snapshot (6 market 21,074.00 · 9 derived 81,818.03 ·
  3 to be priced · 102,892.03 · ≈ 116,679.56).
- Components import the client-safe vocabulary
  `lib/provenance/tier-vocab.ts` (tiers, `weaker`/`weakest`, `tierLabel` firm /
  owner, `describeFigure`) and receive marks as data — never `tier.ts`.
- `components/blueprint/`: `<ProvenanceMark tier>` (the 12 px glyph, Figma
  3:29: solid / ¾ / ½ / ring / dashed, `aria-hidden`), `<Figure value tier
  …>` (ink number + mark + ONE screen-reader description WITH the currency,
  e.g. "AED 7,329.70, derived — quantity derived, rate market reference"; a
  rate is "AED 105.60 per m²"; unpriced shows "to be priced" / "—"),
  `<TierLabel>`, `<Icon name size?>` (size by prop or `text-[…]` — never the
  Atelier 24px trap), `<ThemeSwitch>`. Sandbox:
  `/dev/blueprint` (signed in, absent in production).

### Shell + journey rail (K2)

- **Two journeys, one rail.** `lib/journey.ts` keeps the owner list (untouched)
  and adds `FIRM_STEPS` — 00 Project hub · 01 Project & Plan · 02 Scope · 03
  Specification · 04 Rates & Basis · 05 BoQ & Review · 06 Documents · 07
  Revisions & Approval · 08 Proposal, fixed numbers, each on a route that
  exists (01 opens the plan until a per-project intake exists; 04 is
  `/project/[id]/rates`, the project's firm's book; 08 is
  `/project/[id]/proposal`, the gate until K4). Persona: a member of the firm a
  project is attached to → firm journey; everyone else → owner. **Persona
  invariant** (`lib/projects/firm-invariant.ts`): on a firm-attached project
  every project member is a member of that firm — `addProjectMember` refuses
  409 `not_a_firm_member`, `assignProjectFirm` refuses 409
  `project_members_outside_firm`, `scripts/project-member-add.mjs` skips with a
  message. (Production on 13 Oct: no firm-attached projects, no violations.)
  `activeStepKey(persona, pathname, …)` lights the step a page is on.
- **States are computed, never stored** (`lib/journey-state.ts`, pure):
  done / available / attention (book not reviewed, upstream change since the
  revision, approval outstanding) / blocked (plan check, the proposal gate),
  each with its reason and fix link. The facts come from the gates the app
  already runs (`lib/journey-facts.ts`: `regenerateReadiness`,
  `loadProposalGate`, `approvalStatus`, `changesSinceRevision`,
  `latestPackJobs`) — **a new gate rule belongs in the gate, never in the
  rail**. "Changed since rev N" is `changesSinceRevision`
  (`lib/boq/changes-since.ts`) and nothing else: **K3's Regenerate calls it**;
  its test is the runbook check (nothing recorded ⇒ regenerating leaves the
  BoQ unchanged). `lib/__tests__/journey-state.test.ts` is the state matrix.
- **The shell** (`components/blueprint/shell/`): `ShellFrame` (rail + top bar +
  main under one `data-system="blueprint"` root), `JourneyRail`, `TopBar`
  (breadcrumb + `<TopBarActions>` portal slot + the phone step switcher /
  bottom-sheet drawer), `HelpDrawer` (Support on every page, `?help=1`;
  `/support` redirects to it), `ProjectShell` / `AccountShell` (server: load
  the rail, frame the page). Widths are CSS in `app/globals.css`: rail 232 /
  compact 56 on tablet and on the BoQ page below 1680 (hover / focus expands it
  as an overlay) / hidden on phone; those rules are UNLAYERED on purpose.
- **Where the shell comes from**: the redesigned segments (`boq` incl.
  revisions, `plan`, `drawings`, `rates`, `proposal`, `firms/[firmId]`,
  `settings`) frame themselves in a `layout.tsx`, so their `loading.tsx` /
  `error.tsx` / `not-found.tsx` render INSIDE the shell (`SegmentLoading`,
  `SegmentError`, `SegmentNotFound`). The hub sits at the `[id]` level and
  frames itself in its page; `[id]/loading.tsx` draws `ShellSkeleton`. (The
  Atelier `AppShell` is gone since K8.) Share a page body as a component (the firm book is
  `app/firms/[firmId]/_components/firm-book.tsx`, rendered by both book
  routes), not by importing another route's `page.tsx`. **If every child of a
  route segment suddenly 404s in dev, restart `next dev` before debugging** —
  K2 saw a dev server answer HTML 404s for whole route trees
  (`/project/[id]/*`, `/api/projects/[id]/*`) that a fresh server served fine.
- **Theme gate**: OPEN since K8 Part 3 (`THEME_CHOICES_OPEN = true` in
  `lib/theme.ts`): the pre-paint script honours a stored Dark / System (System
  follows the OS, live) and Settings + the rail footer offer all three.
  `scripts/k8-dark-check.mjs` proves no flash on a cold load. Client documents
  and e-mails stay light.
- **Primitives added**: `<Button>` (Primary / Secondary / Quiet, `tone="inverse"`
  inside an error or gate block; disabled = `aria-disabled` + a visible reason),
  `<StateBlock kind>` (empty / loading / error / gate / pending) +
  `SkeletonRows`, and the `<RegenerateControl>` shell (wired in K3).
- **Route triage (spec §3.10)**: Marketplace and Community are out of every
  navigation and have no page (K8 review: 307s to `/projects` in `next.config.ts`); `/firms` goes straight to the book when the
  caller has one firm; `/settings` is Account · Appearance · Firm.

### BoQ & Review (K3)

`/project/[id]/boq` is Blueprint end to end (spec §3.2; frames 13:48 / 14:675
/ 14:890 / 17:1602 / 26:924, inspector 16:1580 / 16:1654).

- **One view model, built on the server** — `lib/boq/review-model.ts`
  (`buildReviewModel`, pure; types in `lib/boq/review-types.ts`): the STORED
  revision, identity-curated, in canonical section order (H7), with REF codes,
  every mark from `tierOf()`, weakest-link roll-ups (R1), the basis of the
  subtotal by tier, the summary chain WITH its bases, the excluded lines named
  with reasons (the description's "(… — QS to price)" aside becomes the
  reason, `splitAside`), and the I4 provenance chains. The page never
  re-prices; `lib/boq/__tests__/review-model.test.ts` pins the J3 figures.
- **The screen** `components/blueprint/boq/`: `BoqReview` (client root) ·
  `PinnedTotal` (sticky; "≈ AED N*" + weakest mark; named exclusions;
  basis of subtotal; `data-display-total`) · `Notices` (DRAFT FOR REVIEW,
  PRICED FROM MARKET REFERENCE with the L4 accept control, priced-twice,
  existing-on-site, permits) · `SectionIndex` / `SectionChips` · `BoqGrid`
  (ARIA grid, roving tabindex, §4.3) · `ProvenancePopover` (hover 250 ms AND
  keyboard focus, Escape; curated chains only) · `Inspector` (Line · What-if
  · Corrections; `InspectorSheet` on < 1024 px) · `SummaryChain` · `Extras`
  (programme, cost by room, optional furniture — all outside the total) ·
  `Regenerate` (H4 path) · `GenerateFirst` (empty state). Layout CSS is
  the `.bp-boq-*` block in `app/globals.css` (unlayered, CSS-px breakpoints).
- **No sources in rows**: `vendor_or_source` reaches the screen only through
  the curated provenance (popover, inspector).
- **What-if is a scenario, never the BoQ**: the pinned total is always the
  stored revision. The tab wraps the P5 grade engine (real scenario chain)
  when the BoQ has take-off provenance and `WHATIF_ENABLED`; otherwise the
  four sensitivity modifiers, whose engine is an illustrative ±% of the
  PROJECT TOTAL — so (K0.4) the copy says that and there are no chain rows.
  Optional furniture joins a scenario, never the headline.
- **Corrections** (K3: recorded, never applied — SUPERSEDED by K11 #4: a rate or
  quantity correction can "Apply to this BoQ now", see K11). "Promote to our
  rate book after review" attributes a RATE correction to the project's firm
  (`firm_id`) — the candidate list a member promotes from.
  `/api/boq-corrections` (= "Save for review only") is no longer behind
  `GARDEN_PILOT_ENABLED`.
- **"Add to my book"** links to `/project/[id]/rates?add=<item_key>&rate=<n>#new-entry`;
  the book's add form prefills and saves nothing until the member does.
- **Regenerate**: blocked = `regenerateReadiness`; ready / unchanged =
  `changesSinceRevision` (the rail's one function); running keeps rev N on
  screen ("Showing rev N while rev N+1 is generated"); done names the new rev,
  total and Δ and links the U4 diff. Test ids `regenerate`,
  `regenerate-button`, `regenerate-result`, `regenerate-diff-link` are kept
  for the walkthrough.
- **Checks**: `node scripts/boq-review-check.mjs [port] [--shots=dir] [ids…]`
  (stored = displayed, rate × qty = amount, page height ≤ 4,500, §4.3 keyboard,
  axe light + dark, tablet / phone) over `scripts/lib/cdp.mjs` (a signed-in
  headless Chrome); the onboarding walkthrough covers Add to my book,
  Unchanged → Ready → Running → Done and the firm-rate popovers.

### Firm surfaces (K4)

Steps 04 · 06 · 07 · 08 and quote review are Blueprint (spec §3.3–§3.7;
frames 19:48, 20:263, 21:450, 22:548, 23:689). A page's step eyebrow comes
from the journey (`lib/journey-eyebrow.ts`), never a literal.

- **04 Rates & Basis** (`/firms/[firmId]`, `/project/[id]/rates`) —
  `lib/firms/book-view.ts` (`loadBookView`, member-checked first): NEEDS
  ATTENTION (H8 unit check with the conversion offer and its project
  consequence · outlier · conflict) above IN USE, the status strip (book
  status · this project's lines · reference basis with the L4 accept control,
  anchored `#reference-basis`), Entries / Quote imports / Corrections /
  History. **Mark book reviewed is refused while attention is open** — on the
  screen and at the route (`updateFirm` → 409 `attention_open`); an outlier
  confirmed with no figure change writes `outlier_confirmed` with its
  `entry_id`, which is what clears it.
- **Quote review** — one status per line (READY · CONFIRM MATCH · HELD:
  outlier / unit check / currency / not a number · NO MATCH · REJECTED · IN
  BOOK); a foreign-currency hold takes an AED rate (`enter_rate_aed`,
  recorded as `rate_entered` with a conversion note).
- **07 Revisions & Approval** — `lib/boq/revisions-view.ts` shapes U4's ONE
  diff object: rev N labels (oldest = rev 1, Dubai time), chain A · B · Δ,
  lines with marks and RECORDED causes linked to their record ("none
  recorded" otherwise), a reconciliation sentence that names any gap, the
  window events no line names, and the later revision's approval trail.
  Client approval = name + date + how it was given + reference (kept in the
  approval's note — no migration). **"Link causes to lines" is shown disabled
  with its reason: there is no record behind it** (backlog). Compact rail
  like the BoQ page.
- **06 Documents** — `components/blueprint/documents/DocumentsExport.tsx`:
  EXPORT CHECKS (the run's gate, server-computed; PASS / BLOCKS EXPORT), the
  reference basis on a firm project (BLOCKS CLIENT PROPOSAL — the gate locks
  the proposal, not the pack), and the printed-page checks from the latest
  IN-APP run. Run export is disabled with the number of blocking checks. The
  **internal review pack is NOT built** — shown disabled with its reason (it
  needs a watermark and a release rule; a decision, not a build).
- **08 Proposal** (`/project/[id]/proposal`) — the gate first (same verdict
  as the export), then SETUP (migration **053**: firm defaults
  `proposal_validity_days` / `proposal_payment_terms` /
  `proposal_show_line_rates`, and `project_proposals` per project — client,
  validity, payment terms, cover note, line rates), saved on leaving each
  field via `PUT /api/projects/:id/proposal-setup`; validity, payment terms
  and the line-rate choice also become the firm's defaults. **Line rates
  default OFF**: the client reads quantities and section totals. The document
  gains client, validity, cover note, payment terms, EXCLUSIONS & TO BE
  PRICED and ASSUMPTIONS (`lib/documents/proposal.ts`; an L4 caller that
  passes no setup gets the L4 document). **Preview as client** =
  `GET /api/projects/:id/proposal-preview` → SVG pages with `PREVIEW · NOT
  ISSUED` on every page, firm members only, identity-scanned — never a PDF,
  never a release. **Generate proposal** opens 06 Documents with the proposal
  included (`?export=1&proposal=1`): the proposal still leaves only through
  the gated export. One loader for both: `lib/documents/proposal-load.ts`.
- **Checks**: `node scripts/k-page-check.mjs [port] --shots=dir --projects=<ids>
  name=/path …` (axe + shots, light/dark, desktop/tablet/phone); the onboarding
  walkthrough runs the K4 loop (quote → pergola held → convert → reviewed →
  04 clears → 08 locked/unlocked → regenerate → diff with cause → approvals →
  setup → preview → Documents with the proposal) and scans every K4 payload
  for withheld identities with the member's session;
  `scripts/document-identity-scan.mjs` scans them too.
- **Gotcha (K4)**: an `sr-only` span inside an `overflow-x-auto` region
  escapes it (absolute, no positioned ancestor) and widens the phone page —
  give every scroll region `relative`.

### Hub, scope, front door, a11y (K5a · K5 · K6 · K7)

- **00 Project hub** (`/project/[id]`, §3.1 / 11:48) is Blueprint for BOTH
  journeys — `lib/hub/hub-view.ts` + `components/blueprint/hub/`. Headline =
  the stored grand total (≈ … * + weakest mark + the lines to be priced named);
  "Basis of this number" = counted lines by amount mark, and the chain line
  under it carries the counted total to the headline to the fil (Arabella:
  6 · 21,074.00 / 9 · 81,818.03 / 3 TBP → 102,892.03 → ≈ 116,679.56). Next =
  `nextFromRail` over the rail's OWN statuses (persona's journey, max 3; else
  the first step not done) — no rule of its own. Revisions = the diff's counts
  + recorded causes; documents = the gates' answers. The rail facts are loaded
  once per request: `loadProjectRail` (React `cache`, in `ProjectShell.tsx`)
  is shared by the shell and the page. The old Atelier hub, `ApprovalsCard` and
  `PermitsCard` are gone; project files are `HubFiles` (Blueprint).
- **02 Scope / Layout** (`/project/[id]/plan`, §3.8 / 24:814) — chrome only:
  Blueprint page, layer tabs with the brass underline, Undo + Save changes in
  the TOP BAR (Save disabled with its reason until something changed; a save
  `router.refresh()`es the server panel), and the **Plan check** panel
  (`components/blueprint/plan/PlanCheckPanel.tsx` over `lib/plan/plan-check.ts`
  → THE detector `findOverlaps`): the inverse block (pairs, share counted
  twice, parser total, consequence) with Fix overlaps · N / Re-run parse, the
  pairs largest first (a row selects BOTH rooms), and what the rail blocks
  downstream. The panel drives the editor through window events
  `rv:plan-fix-overlaps` and `rv:plan-select-rooms`. Canvas: handles ink; with
  overlaps rooms ink 5% and the shared floor ink 30% dashed, plus a legend.
  Fixture: `lib/plan/__fixtures__/j0-bad-parse.json` (the J0 worst pre-repair
  parse, polygons only — 12 pairs, 23.6%); live: `scripts/k5-bad-parse.mjs
  seed|teardown` + `scripts/k5-plan-check.mjs`.
- **Sign in** (`/auth`, §3.9a / 35:1152) is Dark Blueprint
  (`data-system="blueprint" data-theme="dark"` on the page root) —
  `components/blueprint/auth/`. The design view is a FICTIONAL villa from our
  own three.js stage `/dev/villa-orbit` (dev only), captured by
  `scripts/k6-capture-villa.mjs` (MediaRecorder; no ffmpeg) into
  `public/design-view/` — WebM + MP4 ≤ 2 MB and a poster. Poster first; the
  video plays only without reduced motion / Save-Data / 2G-3G; decorative
  (`aria-hidden`, muted, no controls); no live WebGL on the page. Never a
  client project, never stock or AI imagery.
- **01 Intake** (`/project/new`, §3.9 / 29:1016): `AccountShell
  content="blueprint" skin="warm"` (the rail draws the owner steps with 01
  active, `railSteps(..., pathname)`); three ways in as one radio group (Draw /
  Photos need the garden pilot), a too-large plan is the inverse block,
  queued photos/drawings are uploaded BEFORE leaving on the draw path, and
  Continue is disabled with its reason. The owner landing stays parked.
- **K7 (§4.2)**: on a coarse pointer every Blueprint control gets a centred
  ≥ 44 px hit area (`app/globals.css`, unlayered; `[data-atelier]` — the
  `AtelierCanvas` body — is excluded so Atelier pages do not move); every
  disabled control's `aria-describedby` resolves; the quote summary is
  `aria-live`. `scripts/k-page-check.mjs` checks axe light/dark, a 320 px
  reflow, horizontal overflow and dangling describedby (`--who=`, `--anon`).
- **KV checks**: `scripts/kv-keyboard-k4.mjs` (the K4 loop by keyboard, on the
  walkthrough's scratch state), `scripts/kv-atelier-unchanged.mjs <base>
  <head> <project>` (pixel-compares the out-of-scope Atelier pages against a
  baseline server — run the baseline from a worktree with `next dev --webpack`:
  Turbopack refuses a junctioned node_modules), `scripts/k6-front-door-check.mjs`.
  **If a dev server starts 404ing whole route trees mid-session (it did in KV,
  after many edits and a second server), restart it** — K2's note holds.

### Everything on Blueprint (K8 · 13 Oct)

Every screen of the J6 / J2–J4 frames (Figma `vgibM0F9SdEQErBaTxjUqH`; spec
§5/§6) is built; screenshots beside their frames in `screenshots/k8/` (light),
`screenshots/k8/dark/` (dark), `screenshots/k8/before/` (the old bodies). Open
items and rulings needed: `docs/K_BACKLOG.md` → "Found in K8".

- **Owner journey 00–06** (K8.1, above) with computed states:
  02 Design attention "Add references" (< 3 pinned), 04 Cost attention
  "N items not priced", 06 Tender blocked "Price N items first" or by the
  plan check (`lib/journey-state.ts ownerStepStatuses`).
- **One shell** (K8.2): Sidebar / old TopBar / JourneyChrome / AppShell /
  AtelierCanvas are deleted; `/projects` is the signed-in home
  (`SIGNED_IN_HOME`); `/dashboard`, `/my-projects`, `/project` redirect there.
- **Screens**: Projects home (`components/blueprint/home`), owner Overview
  (`hub/OwnerOverview` over `lib/hub/overview-view.ts`; the firm keeps
  `HubScreen`), Design (`design/`), Renders studio (`renders/`),
  Specification (`spec/`), Timeline (`timeline/`), Contractors & suppliers
  (`tender/Suppliers` — a scenario on the stored BoQ, distances dropped),
  3D view (`viewer/`: token colours read at runtime, room labels are buttons,
  inspector over `lib/viewer/room-facts.ts`), Rate books list
  (`book/RateBooksList`), Not found / error (`shell/PageMessage` — ONE
  message for missing and no-access), Reading your plan
  (`intake/ReadingPlan`; `/api/parse-plan` returns rooms / stated_areas /
  overlap_pairs; sandbox `/dev/reading-plan`), Help drawer
  (`shell/HelpDrawer` + `lib/help/articles.ts`; the `?` key), Legal
  (`legal/LegalTemplate` — H6's draft rule unchanged), the plan editor's
  internals (`app/project/[id]/plan/_components/editor-chrome.ts`,
  `plan/PlanInspector`).
- **Client documents on Blueprint paper** (`lib/documents/doc-style.ts`,
  always light): the proposal (cover + numbered sections + price summary to
  the fil — no marks, no line rates unless ticked), the BoQ PDF (A4 LANDSCAPE,
  `boq-pdf-pages.ts`: Q/R marks per line from `tierOf()`, section weakest mark,
  legend in every footer), the drawing sheet frame + title block + inverse
  "FOR REVIEW — NOT FOR CONSTRUCTION" strip (`lib/drawings/sheet.ts`). The
  draft statement is the inverse band everywhere (no terracotta).
  `scripts/k8-doc-shots.ts` renders them from the Arabella fixture.
- **E-mails**: `supabase/templates/magic-link.html` / `invite.html` (wired in
  `supabase/config.toml` locally; the hosted projects take them in the
  dashboard). A test pins their rules.
- **Type gotcha**: `.t-*` classes are unlayered and beat utilities on the same
  element — `t-body-sm font-semibold` is NOT bold; strong 14 px text is
  `t-nav-item-active`. Variant prefixes (`md:t-…`) do not work.
- **Checks**: `scripts/k8-dark-check.mjs` (cookie-driven dark, no flash, axe
  in dark, System), `k8-keyboard-walk.mjs` (home → tender by keyboard, both
  themes), `k8-tender-check.mjs`, `k8-viewer-check.mjs`, `k8-help-check.mjs`,
  `k8-design-check.mjs`, `k8-journey-check.mjs`; scratch state via
  `k8-firm-scratch.mjs` / `k8-firms-scratch.mjs`; `k-page-check.mjs` gained
  `--sizes=laptop` (1280).

### K9 — the K8 review's follow-ups (13 Oct)

- **Document fonts** (`lib/documents/doc-fonts.ts`, `lib/documents/fonts/`):
  IBM Plex Sans (300–600), JetBrains Mono (400–600) and EB Garamond (400–500)
  as TTF — resvg reads TTF/OTF only — with their OFL licences and
  `SOURCES.json` (url + sha256 per file; `.gitattributes` keeps them
  byte-exact). EVERY `new Resvg(` passes `font: documentFontOptions()` (a test
  greps for it); `next.config.ts` `outputFileTracingIncludes` ships the folder
  into the five document routes' functions.
- **Garden timeline** (`lib/timeline/garden.ts`): a project whose every room
  is an outdoor zone (balcony / terrace are interior) never runs the interior
  phase model — 05 Timeline and the Overview show the BoQ's stored
  `programme` (re-derived for an older revision), "≈ N days" with the derived
  mark and `GARDEN_TIMELINE_BASIS` ("Scaled from one real Dubai garden project
  (~90 days) …"). No week conversion (the reference days are mobilisation →
  handover). Interior unchanged.
- **Drawings are ink only** (`lib/drawings/*` and the render pack): no brass,
  terracotta or hue. Demolition = dashed ink; an estimated zone
  (`isEstimatedZone`: `dims_derived` or a derived area) = the `pat-derived`
  hatch (`HATCH_DEFS`) + the derived ring (`derivedRing`) beside its ref;
  notes carry `DERIVED_GLYPH` (○); the draft stamp / L-000 cover / pack cover
  are the inverse band; runs are `RUN_INK` tones told apart by their code —
  `LINEAR_ELEMENT_META.color` is the EDITOR's hue and never reaches paper.
  `lib/drawings/__tests__/ink-only.test.ts` scans every sheet module's source
  AND the printed Villa 94 sheets (measured + all-derived draft) against the
  ink / paper / grey list. Shots: `scripts/k9-sheet-shots.ts`.
- **Sheet REV = the BoQ revision** the set was generated from (`sheetRev`:
  rev N = the project's N-th BoQ, 0 before the first) — never "—".
  `SheetMeta.rev` is REQUIRED. A pack export regenerates the BoQ before it
  asks for the drawings, so the latest revision is the pack's.
- **Proposal reference** (migration **054**, `lib/documents/proposal-reference.ts`):
  a per-firm sequence `<PREFIX>-P-0001` on `project_proposals.reference`
  (+ `reference_firm_id`, `reference_assigned_at`), assigned ONCE by
  `assign_proposal_reference()` (one transaction; the firm row's update
  serialises concurrent issues) when the gated `/proposal` route issues
  (`loadProposalInput(…, { issue: true })`), reused by every later export of
  that project. The prefix is derived from the brand at the first issue
  (`defaultProposalPrefix`: initials, legal forms skipped) and kept on
  `firms.proposal_prefix`; `proposal_seq` is the last number. The preview
  never assigns ("Reference assigned on issue"). Printed top right on the
  cover, as a cover fact and in every page header; the pack's printed checks
  require it. Without 054 the route answers 500 `migration_required`.
  Live: `node --env-file=.env.local scripts/k9-proposal-ref-check.mjs`
  (scratch firms + projects, deleted after).

### K10 — the K8/K9 QA (13 Oct)

- **Project actions + safe delete** (§6.12, frames 76:2719 · 76:2981 ·
  77:2905; migration **055**; `lib/projects/lifecycle.ts`,
  `components/blueprint/projects/ProjectActions.tsx`). A "⋯" on every
  Projects-home row and in the Overview / hub top bar: Open · Rename ·
  Archive/Unarchive · Delete project… (menu-button keyboard pattern). **Who**:
  rename / archive / restore = any member; delete and "Delete now" = an owner
  project's `created_by` or a firm **admin** (`firm_members.role`; the firm's
  creator, backfilled — else its earliest member); everyone else sees Delete
  disabled with "Only a firm admin can delete this project". **Delete is SOFT**
  (`projects.deleted_at` / `deleted_by`): `authorizeProject` answers any
  reference into a deleted project 404 `project_not_found`,
  `isProjectMember` / `memberProjectIds` leave it out, `proxy.ts` 404s its
  pages (join filter, plain-read fallback before 055). Only lifecycle.ts sees
  one (`requireMember` / `requireDeleter`: 401 → 404 → 403) — the routes
  `DELETE /api/projects/:id { confirm_name }`, `POST …/restore`,
  `POST …/delete-now { confirm_name }` (only from Recently deleted), `GET
  …/delete-preview` (real counts, issued-proposal warning, the caller's
  permission). Name gate: case-insensitive, trimmed. Restore = clear the mark
  (rows untouched → exactly as it was). **Purge** removes the project's Storage
  objects (`projectStoragePrefixes`: plan-uploads `<id>/`, renders / packs /
  drawings `projects/<id>/`, packs `downloads/<id>/`, uploads
  `pending/<kind>/<id>/`) then the row (FK cascade); the daily
  `/api/cron/projects-purge` (CRON_SECRET, dry-run until
  `PROJECT_PURGE_APPLY="true"`) takes projects deleted > 30 days, logging ids
  and counts only. The rail footer says "Firm admin". Checks:
  `lib/projects/__tests__/lifecycle.test.ts`, `scripts/k10-purge-check.mjs`
  (synthetic files, live), the isolation sweep's phase 6 (every route + page
  404 for a deleted project, restore round-trip byte-identical),
  `scripts/k10-actions-shots.mjs` (keyboard, axe, light + dark).
- **Sign in with the e-mailed code** (`app/_actions/verify-email-code.ts`,
  `lib/auth/email-code.ts`; docs/AUTH.md → "Sign-in reliability"). The
  magic-link e-mail shows `{{ .Token }}` under its button; `/auth` takes it
  under the sent state or via "I have a code from the email" and verifies it
  server-side (`verifyOtp({ email, token, type: "email" })`) — any device,
  survives mail scanners and the PKCE same-browser rule. One answer for wrong /
  expired / replaced / no account (no enumeration). 6–10 digits accepted, no
  number stated on screen (dev issues 8 until "Email OTP Length" is set to 6).
  The hosted projects need the template pasted and the URL settings in the
  dashboard — dev's Site URL is `http://localhost:3000`
  (`scripts/auth-url-probe.mjs`, dev only); prod is read in the dashboard.
  Live: `scripts/k10-signin-code-check.mjs`.
- **The proposal reconciles to the fil** (`lib/boq/totals.ts summaryChainOf`, `lib/documents/__tests__/proposal-chain.test.ts`). QA saw the proposal at 102,892.07 / 8,231.00 / 5,556.00 / 116,679.07 beside a BoQ page at 102,892.03 / 8,231.36 / 5,556.17 / 116,679.56: two revisions of one project — a pre-H7 one (engine 0.2.0, whole-dirham contingency and VAT; every Arabella fixture revision, which the doc shots rendered) and the regenerated H7 one. Now the proposal and the BoQ page's review model read ONE chain (`summaryChainOf`) of the same revision, and the proposal gate refuses a pre-H7 revision first — `predatesRounding(engine.version)` → "Regenerate first — this revision predates the rounding fix." (`PRE_ROUNDING_REFUSAL`; 08 Proposal shows it with Open BoQ & Review; the export checklist item `proposal_rounding`). `reroundRevision` reproduces H7 regeneration on a stored revision for fixtures and shots (stage 7 → 116,679.56). Live: `scripts/k10-proposal-chain-shots.mjs`.
- **Plan page gate** (`lib/plan/plan-gate.ts planGate`): the editor opens whenever the plan has rooms — counted from the same `roomList` the header counts — or is authored; the not-analysed card ("No drawing attached") only with truly no rooms. A parse record is no longer required: the dev Demo villa (13 rooms, `parsed_json` NULL, no drawing; snapshot `lib/plan/__fixtures__/demo-villa-plan.json`) showed the card under a 13-room header. The header says "no drawing attached" instead of "parsed from the drawing" when there is none. Live: `scripts/k10-plan-gate-shots.mjs` (scratch copies — the Demo villa itself is never opened).
- **03 Renders = locked, not rendered** (`lib/render-lock-progress.ts`): one lockable view per renderable room or zone (`roomTypeFromDb`; a design is locked per room); the owner step is Done only when all are locked, else Available with "N / M locked" (fix: Open renders). The rail now prints an available step's reason; Projects home `homeNext`, the Overview's `overviewNext` and `nextFromRail` take, in journey order, the first step that is attention, blocked or available-with-a-reason — so all three say "03 · RENDERS — 1 / 3 locked". Live: `scripts/k10-renders-rail-shots.mjs`.
- **Icon font self-hosted** (see "Fonts, icons, theme"): the Google stylesheet is gone; a cold load on throttled Slow 4G never shows an icon name (`scripts/k10-icons-cold-shots.mjs` samples every 250 ms; light + dark). Inter and Rubik are removed (files, `SOURCES.json`, the Tailwind stacks now point at Plex — an undefined `var()` would void the whole declaration).
- **Specification options**: three equal cells (`min-[1100px]:grid-cols-3`) down to 1100 px, then one column (`data-spec-options`; `scripts/k10-spec-grid-shots.mjs` measures 1440 / 1280 / 1100 / 1099 / 390 read-only on the dev Demo villa).
- **Client documents hide zero-value sections** (`clientSections` in `lib/documents/proposal.ts`, also the 08 Proposal screen's preview): a section totals 0 only when every line is still to be priced — those lines stay named under Exclusions & to be priced and in the total's sentence; the printed section totals still add up to the subtotal. The BoQ PDF (internal) is unchanged.
- **Project files on the Overview body grid** (`components/blueprint/hub/HubFiles.tsx`, client): the screens' `files` slot puts it in the main column (owner: under Your design; firm hub: under Documents) instead of a full-width block below the page — the first 5 (`FILES_SHOWN`) and "Show all N" / "Show fewer". Kept on the Overview, not moved to 06 Documents: the owner's uploads are the project's, not the tender's. Live: `scripts/k10-hub-files-shots.mjs`.
- **Duplicate-component notice, owner copy** (`components/blueprint/boq/Notices.tsx`): the owner reads "N items may be counted twice — we'll confirm before tender" with the item names only; the firm keeps "N components priced twice" with the mechanism and the QS-ruling sentence. Engine resolution is in K_BACKLOG → K10.
- **A BoQ with no plan** (`lib/boq/regenerate.ts PLAN_MISSING_REASON`): when a revision exists and the plan does not, the refusal the rail, the hub's Next ("The plan is missing") and the BoQ top bar show is "BoQ exists; the plan is missing." with "Add the plan" — not "no plan to price yet".

### K11 — product fixes from Abdallah's pilot walkthrough (13–14 Oct)

Spec §7 (J7, Figma "J7 · Product fixes (13 Oct)"; dark twins 82:1304 …). One
commit per item; shots in `screenshots/k11/` (light + dark).

- **The uploaded project keeps its typed name** (#1, migration **056**
  `projects.draft_since`, `lib/projects/intake.ts`). The intake's plan upload
  creates the project (the parse needs a row) — now with the name and city
  typed so far (`insertIntakeProject`) and as a DRAFT. Continue posts
  `POST /api/projects/:id/intake { name, city }` (members) — the name the form
  holds at that moment, the draft ends — before "Reading your plan". Drafts are
  left out of Projects, the switcher and Recently deleted (`withoutDrafts`); the
  daily purge job soft-deletes drafts older than 24 h (`sweepIntakeDrafts`,
  always applied — reversible; the 30-day purge and `PROJECT_PURGE_APPLY`
  decide the rest). A swept draft is NEVER listed in Recently deleted (nobody
  saw it) but leaves by the same 30-day purge (`lifecycle.test.ts`). Live: `scripts/k11-intake-name-check.mjs`.
- **Step footer** (#2, component 80:944, `shell/StepFooter.tsx`): ShellFrame
  draws "← PREVIOUS <step>" · "NEXT <step>" + Secondary "Continue to <step>"
  under every project step page (owner 00–06, firm 00–08; not a side surface,
  not the intake). A Blocked next step disables Continue with the RAIL's reason
  and fix (the same StepStatus). 05 Timeline's top-bar Continue gives the same
  answer. Live: `scripts/k11-step-footer-shots.mjs`.
- **Issues navigator** (#3, 80:49): `lib/boq/issues.ts` (pure) builds the list
  from the BoQ & Review model and the rail's StepStatus — NOT PRICED — LEFT OUT
  OF THE TOTAL (every isUnpricedLine line, the rail's own count), POSSIBLY
  COUNTED TWICE (dedupe findings carry their row keys), DERIVED — CONFIRM ON SITE
  (one row), RATE BASIS (gate open), the step's own attention/blocked reason.
  `shell/IssuesNavigator.tsx` = the top-bar "⚑ N TO FIX" + 400 px popover
  (hidden at 0). On the BoQ page a row scrolls to its line, selects it and opens
  the inspector on the right action (Add a price); "Show only these lines"
  filters the grid; J / Shift+J cycle (also "Next issue J" in the inspector).
  Other step pages get the shell's one-row version (`stepIssues`). Live:
  `scripts/k11-issues-shots.mjs`.
- **Add a price + corrections that apply** (#4, 80:9042 · 80:9088, migration
  **057**). SUPERSEDES "a correction never changes this BoQ". `boq_corrections`
  gains origin (correction | add_price), basis_kind (supplier_quote |
  contractor_price | own_estimate), `line_key` (the STABLE line identity), the
  application record (applied_boq_id / applied_from_boq_id / applied_at /
  applied_by / applied_by_name) and the revert record. `lib/boq/own-basis.ts`
  `applyOwnBasis` (pure) lays every applied, un-reverted correction over a
  document: a rate makes the line YOUR PRICE (`rate_tier: "own_price"` → tierOf
  measured / "own basis", rate_status priced, `price_basis`), a quantity sets it
  as measured (`qty_basis`); then `rechain` — the subtotal moves by exactly the
  line's change, the chain to the fil. A QS aside leaves the description only
  when the line keeps its identity without it. `POST /api/projects/:id/boq-apply`
  (new or saved correction; 409 `stale_revision` unless `boq_id` is the latest)
  stores the NEXT revision; `POST /api/projects/:id/boq-revert { to_boq_id }`
  stores an earlier revision's figures as the next one and marks later
  corrections reverted (kept). **Every regeneration re-applies the applied
  corrections** (`lib/boq/assemble.ts`, before OH&P) — a price is never silently
  dropped. Own price counts as the project's own basis in the reference-basis
  gate. Inspector: Add a price on an unpriced line; Capture correction opens in
  the Line tab with "Apply to this BoQ now" (owner default) / "Save for review
  only" (firm default); a saved one applies later from the Corrections tab. The
  diff's causes: "Price added by <name>" / "Correction by <name>" / reverted
  (`line_keys` match exactly); Revisions offers "Revert to rev N". Live:
  `scripts/k11-add-price-shots.mjs`.
  **Matching (approval check, 14 Oct)**: a price follows its LINE — section +
  item_key (+ the room when a line carries `room_id`; today's lines are
  aggregated, none do) — never its REF or position. A key not on exactly ONE
  line (gone from the scope, or a repeated identity — `#n` is positional) is
  UNMATCHED: it prices nothing, is never attached elsewhere, and the document
  records it (`own_basis.unmatched`); the Issues navigator leads with "YOUR
  PRICES — NO LONGER MATCHED · Your price for <item> no longer matches a line"
  → **Remove** (`POST …/boq-release`: stops applying, kept on record, no
  revision) or **Re-apply to…** (the member picks the line; `boq-apply {
  correction_id, row_key, retarget: true }` → the next revision). Tests: the
  scope change that renumbers REFs in `own-basis.test.ts`; live:
  `scripts/k11-unmatched-price-shots.mjs`.
- **Move to firm…** (#5): in the project ⋯ menu (home row + Overview / hub),
  the Delete dialog's layout. `assignProjectFirm` holds the rules: attach / move
  = the project's CREATOR (403 `not_project_creator`) who is in the target firm;
  every project member in it (409 names who is not); detach = a member of the
  current firm. `GET /api/projects/:id/move-preview` (`lib/projects/move-firm.ts`)
  answers the same per option. Dev checks that attach a firm act as the
  project's creator. Live: `scripts/k11-move-firm-shots.mjs`.
- **Walkthrough**: `scripts/k11-walkthrough.mjs` (Cost → navigator → Add a price
  → total updates → Continue to timeline). Scratch fixture for all K11 checks:
  `scripts/lib/k11-scratch.mjs` (Arabella stage 7, H7: ≈ 116,679.56, 3 TBP).

### K12 — rooms in this renovation (14 Oct)

Spec §7.4, Figma 81:716 / dark 82:2244; migration **058** `rooms.in_scope`
(boolean, default true). Scope is EXPLICIT — never inferred from renders.

- **01 Plan**: the right panel's "Rooms in this renovation" checklist
  (`components/blueprint/plan/RoomsInScope.tsx`: "11 of 13", Select all /
  Clear, the note). A tick saves at once (`PATCH /api/plan-scope { plan_id,
  rooms: [{ id, in_scope }] }` — rooms of that plan only; a tick never waits
  for another) and tells the canvas (`rv:plan-scope`): out-of-scope rooms are
  dashed, unfilled, "NOT IN THIS RENOVATION". The editor's save never sends
  `in_scope`, so the column survives every plan save.
- **The rule** (`lib/plan/scope.ts`, `scope-load.ts outOfScopeRoomIds`): an
  out-of-scope room STAYS on the plan graph (its metric scale is derived from
  every room's area; the overlap check needs its floor) but contributes nothing
  room-level: `loadPriceablePlan` hands the engine and joinery only in-scope
  rooms (none in scope → refused "No room is in this renovation");
  `quantifyPlan` skips its floor / ceiling / tiling and a wall only when no room
  beside it is in scope; fixtures placed in it and garden zones / their
  fixtures go with it; the timeline, Renders (list "N not in this renovation",
  Generate all, the single render route 422 `room_not_in_scope`, 03 lock
  progress) and the Overview / hub ("11 of 13 rooms in scope") follow.
- **Whole-home (kept)**: project lumps Q-05 civil alterations, Q-32 site set-up,
  Q-33 DM/DEWA permits, Q-36 scaffold, Q-37 handover clean (garden GL-01–03);
  demolition from the proposed plan; the aluminium & glazing allowance (ruled
  whole-home, 14 Oct — every line notes "Covers the whole unit — adjust if only
  some rooms are in scope"); fixtures in no room. Area-driven prelims (soft
  strip, floor removal, floor protection, skips — ceil'd) follow the rooms.
- **Q-11 staircase renovation (ruled 14 Oct)**: priced when an in-scope stairs
  room exists; none when the stairs room is out of scope; with NO stairs room
  on the plan, a villa / multi-level project (`isMultiLevelProject` — the
  project's name until a property type exists) keeps it as a DERIVED line
  (`qty_derived`) and the Issues navigator asks "Staircase assumed — confirm the
  villa has stairs"; otherwise no allowance. The rule needs `EngineInput.stairs`
  (`StairsContext`, built in `loadPriceablePlan`); without it (the timeline,
  older callers) the pre-K12 rule stands. Stored revisions are untouched — only
  a regenerate changes.
- **Takes effect on regenerate** (a new revision). A scope edit is a
  `design_edit` event on layer "scope" with the rooms added / removed;
  `revision-causes` turns the window's NET change into `scope_change` ("Scope:
  2 rooms removed"), `changes-since` into "Scope changed since rev N".
- **Tests**: `lib/boq/__tests__/scope.test.ts` (every room-level line drops by
  exactly that room's own quantity; whole-home lines unchanged; totals to the
  fil; re-adding restores byte for byte; per-room element take-off; fixtures;
  renders). Live: `scripts/k12-scope-shots.mjs` (Demo villa copy: 13 → 11,
  regenerate, diff cause, Overview, Renders, timeline, back to 13 = rev 1).

### R10a — "Ask for a change" that tells the truth (14 Oct)

Spec §7.5; the walkthrough's dining room (R10 step 0: "Move the kitchen to the
left …" came back SSIM 0.992 — the same image — and was saved as a version).

- **Unchanged edits are not versions** (`lib/render/similarity.ts`, sharp):
  `/api/render/status` compares a finished `tweak` with its parent (SSIM on 8×8
  windows of a 256² greyscale view, % of pixels moved > 10%, mean diff);
  `isUnchangedEdit` = SSIM ≥ 0.985 AND < 0.5% of pixels changed → the row is
  kept as `status: "unchanged"` (scores in `qa.similarity`), never rehosted,
  never in a chain (the renders page filters it), and the studio says "That
  change didn't come through — the image is the same. Try being more
  specific." (`RenderNotice`, lib/render-batch/client.ts; the typed request
  stays in the box). A real edit stores its scores too.
- **Structural requests go to the plan** (`lib/render/change-request.ts`, pure,
  deterministic): a structural verb whose object is a wall / window / door /
  opening / kitchen / partition / stairs, a resize ("bigger windows",
  "floor-to-ceiling"), or a placement ("kitchen on the left") → `/api/render-iterate`
  answers 422 `structural_change` BEFORE any model call: "Walls and windows come
  from your plan — adjust them there" + `/project/:id/plan?layer=openings` (the
  plan page opens on that layer). Finish requests ("add curtains to the
  window", "make the window frames black") still edit.
- **Dining, majlis and kitchen are their own prompt types** (`InteriorRoomType`;
  kitchens were not renderable at all). Their edit prompt adds a furnishing cue
  ("Furnish it as a dining room: …"); the four existing rooms' prompts — the
  render cache keys — are byte-identical. They borrow the style's living-room
  moodboard art.
- **Tests**: `lib/__tests__/r10a-ask-for-a-change.test.ts`; live (no model
  call): `scripts/r10a-ask-shots.mjs`.

### R10b — windows, doors and openings found on the drawing (14 Oct)

Spec §7.5. 1 of 10 production plans had any opening (5, drawn by hand) and the
parser extracts none, so every off-plan render was told "a single window on one
side wall". Migrations **059** (`plan_openings.source = 'detected'`,
`confirmed_at` / `confirmed_by`, `detection` jsonb; `plans.openings_detected_at`
/ `openings_detection`) and **060** (`renders.openings_basis`).

- **The detector** (`lib/plan/openings-detect.ts`, server; one `claude-opus-5`
  call, thinking off, streamed, ~15–25 s): the drawing is rasterised in the frame
  its rooms were traced in (the parser's crop, the whole PDF page, or the image),
  and the model sees it clean AND with the app's rooms outlined + labelled R1…Rn.
  It answers per opening: room, **side** of the room (top/bottom/left/right as
  drawn) and start/end along that side (0–1) — relative to the room, because the
  app's outlines often sit 0.5–1.5 m off the drawn walls and a sheet point would
  miss them. `snapProposals` / `sidePlacement` (pure) put each on the room's
  outermost wall on that side that covers it (`deriveWallSegments` — the take-off's
  walls), size it as its share of the room's side at the plan's metre scale (not
  clipped to one wall segment), clamp implausible widths, and merge the same
  opening seen from both rooms. **Split glazing** (follow-up): readings of the
  same kind end to end on one side across a ≤ 0.4 m gap (`MULLION_GAP_M`) are
  ONE opening (`mergeAdjacentProposals`, `detection.merged_from`) — the dev
  Mudon reading's Bedroom-4 balcony went 0.44 + 0.66 m → 1.53 m. A width
  PRINTED on the drawing (`printed_width_mm`, plausible for the kind) is the only
  measured one (`detection.width_source: "printed"`, `derived: false`). **The frame**: a parsed plan saved from
  the editor stores polygons in the 1000 × 600 viewBox; `drawingFrame` relates
  them to the drawing by fitting the editor's uniform scale + offset on the rooms
  the plan and `parsed_json.rooms` share by name (outliers = rooms the owner
  moved), else the two extents; nothing to relate → `no_frame` (never guessed).
- **When it runs**: once per plan, claimed atomically (`openings_detected_at`) —
  right after the reading (`ReadingPlan` → `startOpeningsDetection`), or lazily
  the first time 01 Plan (`OpeningsCheckPanel`) or Renders (`OpeningsAutoDetect`)
  opens; no bulk backfill. Non-blocking: the page renders at once with
  "Finding windows and doors…" in the panel and fills in when the run ends (the
  rows are re-read BEFORE the state flips, so "none found" never flashes). **Re-detect** on demand replaces only unconfirmed
  finds; a confirmed or hand-drawn opening is never touched and a find on one is
  dropped. A re-parse resets both (`resetOpeningsDetection`). Routes:
  `GET/POST /api/plan-openings/detect`, `POST /api/plan-openings/confirm
  { plan_id, ids | all }`.
- **Derived until confirmed.** An unconfirmed find is DERIVED (dashed, "found ·
  to confirm"): `derivePlanGraph` leaves it out by default, so no BoQ, drawing,
  schedule or viewer counts it (`{ includeUnconfirmed: true }` adds it, flagged
  `unconfirmed`). **Confirm = position + kind** (follow-up, ruled 14 Oct):
  Confirm / Confirm all / adjusting it on the Openings layer sets `confirmed_at`
  and NEVER clears `derived` — the WIDTH stays derived until entered on the plan
  (both dimensions → measured, the A5 rule) or printed on the drawing. The panel
  shows "≈ 1.80 m — check" (`openingWidthLabel`) and a "WIDTHS TO CHECK · N"
  list (`widthsToCheck`); a wall / paint / wet-tiling line net of a derived
  opening size carries `qty_derived` (the derived mark) and says so in its notes
  (`TakeoffItem.derived_opening_refs`). Confirming writes a `design_edit` event `layer: "openings_confirmed"` is the revision cause
  **"Openings confirmed"** (item keys `wall_plaster`, `wall_paint`, `wet_tiling` —
  the lines net of openings); `changesSinceRevision` counts it, so the rail and
  Regenerate say the BoQ moved. Edits to a counted opening are `layer: "openings"`
  plan edits. Live on the canonical plan: 16 found → plaster/paint 399.96 →
  377.38 m², wet tiling 93.4 → 87.39 m², only after confirming.
- **01 Plan** (`components/blueprint/plan/OpeningsCheckPanel.tsx`, the
  PlanCheckPanel pattern): "We found 2 windows, a door and an opening to the
  kitchen — correct?" (`openingsSentence`), the list (derived mark), choosing a
  row opens the Openings layer on it (`rv:openings-focus`), Confirm / Remove per
  row, Confirm all, Re-detect; panel and editor keep each other fresh
  (`rv:openings-changed`).
- **Renders use them at once, labelled**: an off-plan render's base shell and
  restyle prompt name the room's openings ("two floor-to-ceiling windows and a
  wide open passage to the kitchen", `lib/render/openings-prompt.ts`) instead of
  the invented single window — a room with none keeps its prompt (cache key)
  byte-identical. `renders.openings_basis` records confirmed vs detected (an edit
  inherits its parent's); the studio shows "Windows and doors detected from your
  drawing — not yet confirmed · Check them on the plan".
- **Checks**: `lib/plan/__tests__/openings-detect.test.ts`; live (dev, scratch
  project, one parse + detection calls, no renders):
  `node scripts/r10b-openings-check.mjs [port] [--keep]`; accuracy over a
  read-only plan dump: `scripts/r10b-detect-accuracy.ts <dump.json> <outDir>`.

### Plan geometry guards (15 Oct)

- **"Fix overlaps" never moves a room** (`lib/plan/trim-overlaps.ts`, the
  editor's toolbar and the plan check's "Fix overlaps · N"): the shared floor
  is TRIMMED from one room of each pair (the surer room keeps it, then the
  smaller — the parse repair's rule); a room only loses area and stays inside
  its own outline (`staysWithin`); a room it would remove or a hole it would cut
  is reported, not done. The old rigid push (`lib/plan/separate.ts`) is deleted
  — it walked prod Mudon's rooms off the drawing. **Exactly the overlap**
  (review, 15 Oct): a trim that would split a room is tried the other way round,
  else reported (`would_split_room`); a trimmed room's `area_m2` drops by
  exactly the floor removed (`m2PerUnit2`), so the total falls by exactly the
  floor counted twice (J0 at the plan's scale: 166.1 → 128.6 m² = the rooms
  combined; the first version mixed re-measured and read areas → 108.8).
  **Preview first**: the editor shows "trims N rooms · total X → Y m²" with
  the trimmed outlines drawn, and changes nothing until **Apply**
  (`data-trim-preview`, `trim-apply` / `trim-cancel`). **Printed sizes**: the
  room further OVER its printed size loses the shared floor.
- **Printed-size check** (`lib/plan/printed-sizes.ts`): 01 Plan flags a room
  whose outline, at the plan's own scale (buildPlanGraph's total ÷ Σ outline),
  is > 10% off the size the sheet prints (`parsed_json.rooms[].area_source =
  "measured"`, matched by name; a name printed twice or a renamed room gets
  none) — "Bedroom 3 is drawn at 28.4 m² — the sheet prints 19.9 m² (43% over)."
- **Mudon alignment — diagnosed, NOT fixed** (owner ruling: no parsing change
  until reviewed). `lib/parse/__tests__/mudon-alignment.test.ts` over
  `lib/parse/__fixtures__/mudon-sheet-reading.json` (the sheet's labels, region,
  scale + one raw model reading): its two `it.fails` are the acceptance criteria
  (every printed tag inside its own room; every printed size within 10%) — flip
  them to `it` with the fix. K_BACKLOG → "Mudon alignment".
- **Floor coverage** (`lib/plan/coverage.ts`): the plan check warns "Rooms cover
  X of ~Y m² — a room may be missing" below 90% of the reading's whole-floor
  estimate (`parse.provider_total_area_m2`); no estimate, no check.
- **R10c cameras** (`lib/render/cameras.ts`, pure): arms = the fewest maximal
  rectangles; an arm counts when both sides of the floor it adds are ≥ 1.5 m;
  < 2 counting arms → 2 views from the main arm's ends, else one per arm, max
  3; every camera inside its room with ≥ 0.4 m to every wall, else dropped.
  K_BACKLOG → "Plan geometry" / "R10c" has the measurements and open items.

### Plan editor guardrails (15 Oct)

ONE rule set, `lib/plan/plan-rules.ts` (pure): the editor refuses on it, 01
Plan lists it, the BoQ and the renders follow it. Tests:
`lib/plan/__tests__/plan-rules.test.ts` (a test per rule + the Jumeirah Parks
fixture `lib/plan/__fixtures__/jumeirah-parks-plan-15oct.json`); live:
`node --env-file=.env.local scripts/plan-rules-check.mjs [port] [--shots=dir]`
(scratch copy on dev, removed after).

- **An opening sits on a room EDGE, by position** (`placeOpening`, ≤ 0.15 m),
  never by its stored `wall_ref` — derived wall ids renumber with every outline
  edit, and the Openings editor drew 12 of Jumeirah Parks' 16 openings along
  the wrong wall (4 across theirs) and dragged them onto it. What is on each
  side is probed 0.3 m out (`sides`), not matched edge for edge (hand-drawn
  edges rarely agree to 0.0025 units). The editor draws an opening on
  `wallAt(walls, position)` and derives walls with room types (an open garden
  edge is not a wall).
- **Hard** (the editor refuses an add / drop / resize with the reason inline —
  `hardProblemFor`): 1 on a wall (snaps to the wall under the pointer); 2 its
  wall shorter than it; 3 0.1 m clear each end, no overlap on one wall, height
  ≤ ceiling (2.9 m), sill + height ≤ ceiling; 4 an archway between two rooms (a
  terrace counts, a lawn does not), an outside door/window with nothing / a
  terrace / a garden beyond. **"Needs a wall"** (rules 1–2): `derivePlanGraph`
  and the render loader leave it out (`openingsOnWalls`); the editor draws a
  dashed "!" marker that drags back onto a wall. Each revision records the ids
  (`openings_need_wall` on the BoQ document, absent when none) and the diff
  names the change on the lines net of openings: **"N openings need a wall"** /
  "N openings back on a wall" (`needsWallCause`).
- **Gardens are exempt** (ruled 15 Oct, `inGarden`): a gate, anything in a
  garden wall (`context_id`), on a garden zone's edge or inside a garden zone —
  no rule, never "Needs a wall", a plain marker in the editor. And
  `buildPlanGraph` snaps an opening to a wall only within 0.15 m (before: any
  distance — a door on a lawn's edge came off the nearest house wall).
- **Openings move with their wall** (`lib/plan/opening-anchor.ts`):
  `/api/update-plan` reads the old outlines and openings, fits the frame change
  (one scale + offset over rooms that kept their corner count — a save can re-fit
  the plan), and moves each opening to the same fraction along its edge's new
  position (`openings_moved` in the response); an edge that is gone leaves it
  off every wall.
- **Soft** (listed; "Keep anyway" → `POST /api/plan-rules/keep` → the subject's
  `spec.kept_rules`, Undo takes it back): 5 an archway / no door into a wet
  room; 6 a window between two rooms; 7 no way into a room; 8 sizes (inside door
  0.7–1.2 m, window ≤ 80% of its wall, archway ≥ 0.9 m); 9 edges off square
  (the editor snaps a dragged corner square within 5° — `snapVertexSquare`);
  11 the Arabic label naming another room (`lib/plan/room-names.ts`, flagged
  only when both are recognised; the editor gained an Arabic name field, and a
  rename in English flags it until updated).
- **10 unnamed rooms block regenerate**: `loadPriceablePlan` refuses 409
  `rooms_unnamed` for an in-scope "New room" — the rail, the button and the
  route say the same.
- **12 labels fit their room** (`lib/plan/label-fit.ts`): measured against the
  room's box and reduced — area only, smaller type, an abbreviated name, no
  Arabic, the area alone; the full name in a tooltip. Every layer.
- **Where it shows**: the "PLAN RULES" block under the plan check
  (`components/blueprint/plan/PlanRules.tsx`) and the top bar's "⚑ N TO FIX"
  (`lib/plan/plan-issues.ts` → the K11 navigator, the step's own reason merged
  in; the shell's one-row version is off on /plan as on /boq). A row selects its
  room (switching to the Plan layer) or opening (the Openings layer).

### Bathroom pilot B1 — one room from its dimensions (18 Oct)

`data/Bathroom Pilot/` (gitignored): the prompt pack, the room sheet (THE
fixture: 266 × 263 × 280, openings §2, fixtures §3, acceptance §8), photos,
references. Pre-flight: `BATHROOM_PILOT_PREFLIGHT.md`. One flag for the pack:
`MULTIVIEW_RENDERS_ENABLED`. Migration **061**.

- **Intake** "One room from its dimensions" (`villa-intake.tsx`, flag-gated —
  NOT the garden pilot, no plot to type): room type (bathroom / ensuite / powder
  / kitchen / bedroom / living / other), L × W × H to 2 dp →
  `POST /api/room-from-dimensions` (`lib/plan/room-intake.ts`, pure). An
  authored plan whose plot IS the room (`plot_width_m` = L, a measured scale),
  `plans.intake = 'room_dimensions'`, one rectangular room, every entered value
  measured (`dims_derived` false, `ceiling_h_source` measured). Continue opens
  01 Plan on the Openings layer. Nothing bathroom-specific in the schema.
- **Ceiling height** (061 `rooms.ceiling_h_m` + `ceiling_h_source`
  measured | derived): `buildPlanGraph` uses a roofed room's stored value
  (`storedCeiling`; `Room.ceiling_h_source` set only then; out of
  `derived_fields`), else 2.9 derived exactly as before; an unroofed zone ignores
  it. The element take-off already read `ceiling_h_m`; the engine's C-01 / C-04
  (`WALL_HEIGHT_M`, `BATH_TILE_HEIGHT_M`) now read `EngineRoom.ceiling_h_m` too
  (`assemble.ts` loads it best-effort; the measurement text is unchanged unless
  a bath stores one). The plan rules' door/window height check uses the lower
  ceiling either side. Editable for ANY room on 01 Plan (`CeilingHeights` panel
  → `PATCH /api/plan-ceiling`, saves at once, a `design_edit` on layer
  "ceiling" with from → to) → revision cause **"Ceiling height — Bathroom 2.90
  (default) → 2.80 m"** on the wall-area lines and "Ceiling height changed since
  rev N" (`lib/plan/ceiling.ts`). The editor's plan save never sends it.
- **Openings**: the A5 editor as is (click a wall, Add, drag along it); on a
  room-intake plan a door starts 0.8 × 2.1 m and a window 0.6 × 1.2 m on a 1.2 m
  sill (`ROOM_INTAKE_OPENING_DIMS`, route + editor), derived until both
  dimensions are entered.
- **Fixtures with a footprint** (`lib/overlays/footprint.ts`, pure; no
  migration): `wc_point`, `bidet_point` (new), `basin_point` (vanity),
  `shower_mixer`, `bath_point` (new; bidet / bath are QS-to-price lines until
  B5). `spec` = width_mm (along the wall) · depth_mm (into the room) ·
  rotation_deg (compass heading it FACES, 0 = plan up, clockwise) · wall_gap_mm
  · footprint default | entered. Defaults WC 400 × 700, bidet 400 × 550, vanity
  900 × 600, shower 900 × 900, bath 1700 × 750. `/api/plan-fixtures` SNAPS
  every add / move / resize to the nearest wall of its room (back flush + gap,
  kept on the wall) and fills `plan_fixtures.wall_id` — a HINT like an
  opening's `wall_ref` (re-find by position). `snap: false` opts out. The
  plumbing layer draws the footprint (dashed while default) and previews the
  snap while dragging. The BoQ still counts points.
- **Invariant**: no existing BoQ moves — `lib/boq/__tests__/ceiling-height.test.ts`
  (Mudon's mapped BoQ with 061's columns null = the P4 golden file; graphs and
  take-offs identical; Arabella identical) and the dev dry-run diffs of Arabella
  and the demo villa byte-identical between master and B1.
- **Checks**: `lib/plan/__tests__/room-intake.test.ts` (the sheet: floor 7.00,
  wet tiling 27.53 = 10.58 × 2.80 − 0.87 × 2.10 − 0.45 × 0.60, plan rules green,
  fixtures at the sheet's centres); live `node --env-file=.env.local
  scripts/b1-room-check.mjs [port] [--keep]` (the `bathroom` launch entry, port
  3096: intake form → door + window → fixtures → reload → BoQ; shots in
  `screenshots/bathroom-pilot/b1/`).

### Bathroom pilot B2 — photo views that keep the layout (18 Oct)

- **Every photo of a room is a view** (migration **062**): `room_photos` always
  held many rows per room but the render route reads only the latest; the
  studio's "Your photos" (`components/blueprint/renders/PhotoViews.tsx`, behind
  `MULTIVIEW_RENDERS_ENABLED`) lists ALL of them, oldest first, as "Photo N ·
  your photo" (`lib/render/photo-views.ts`, pure; the same file assigned twice
  is one view). Add photos takes several at once (the H9 direct upload, client
  compression keeps the portrait frame). Each photo is placed on the room plan —
  press where it was taken, drag toward what it shows, or type X / Y (m) and the
  heading — → `PATCH /api/room-photos` (`camera_position` in normalised plan
  space, `camera_heading_deg` compass, 0 = plan up, clockwise; a camera outside
  the room is 422 `outside_room`). Placing a photo is not a plan edit (no
  `design_edit`; the BoQ is not stale). `renders.room_photo_id` links a render to
  its photo view. `room_photo_id` is a project reference kind
  (`lib/projects/access.ts`).
- **Checks**: `lib/render/__tests__/photo-views.test.ts` (the sheet's §4
  cameras); live `node --env-file=.env.local scripts/b2-photo-views-check.mjs
  [port]` on the dev test project a2661f34 (five photos through the real file
  input, P1 by drag, P2 by keyboard, P1–P5 at §4, axe light + dark, phone).
- **Restyle with the layout held** (migration **063**; report
  `docs/BATHROOM_PILOT_B2.md`): `POST /api/render/photo-view { room_photo_id }`
  → `lib/render/photo-view-run.ts` → `photo-restyle.ts restyleWithCheck`:
  `google/nano-banana` edits the photo (`PHOTO_VIEW_ARM = "edit"` — chosen by
  measured pass rate over depth / canny / kontext / nano-banana-pro: the
  conditioned paths kept the layout by keeping the OLD finishes, or invented
  detail), prompted PER VIEW: the fixtures the photo shows with where they are,
  the ones it does not ("This photo shows no vanity — do not add any"), and only
  the style elements in view (`styleElementsFor` — a brief that mentions a vanity
  gets one painted into the window wall). Then the **placement check**
  (`lib/render/photo-check.ts`, pure `judgePhotoPlacement`; vision reads by
  `claude-opus-5-5` with structured output): the room's door / window /
  sanitary fixtures from the plan, read in the BEFORE photo once
  (`room_photos.before_detection`, keyed by `CHECK_VERSION`) and in the render
  beside it; every item the photo shows must be there, centre within max(12%,
  60% of its extent), once, same left/right order, nothing added. One
  re-render with the findings, then the honest failure "The render moved the
  vanity — see what differs." (the studio draws both readings). A passed view
  also gets the **style check** (`checkStyle` v2 — the render BESIDE its photo;
  an old finish still showing counts "no"; ≥ 0.75 → "Style follows your
  references ✓", else which elements do not; a layout failure reads "Style not
  checked — the layout check comes first"). Size and fittings are not checked
  yet. Live, one render per photo: layout 5/5, style 2/5 — nano-banana holds the
  layout partly by restyling too little. `PHOTO_VIEW_MAX_ATTEMPTS=1` caps a
  deployment at one paid render per view (default: re-render once). Photo-view
  renders are `mode "photo_view"`, `room_photo_id` set, **`room_id` NULL** — so
  no room-level reader (chains, Generate all, lock progress) mistakes one for the
  room's day render.
- **Style from references, text first**: `POST /api/projects/:id/reference-style`
  reads the project's References (02 Design board images) into one style brief —
  style only, never layout — on `project_briefs.reference_style`
  (`lib/render/reference-style.ts`; screenshots are cropped to their photo by
  `referenceCropBox` in the eval). The first three reference images also go to
  the edit model after the photo: `PHOTO_VIEW_IMAGE_REFS = true` (ruled 18 Oct —
  R5 measured style 4/5 vs 5/15 text-only at layout 4/5 vs 13/15; the style gain
  is worth the possible one-in-five layout cost; docs/BATHROOM_PILOT_B2.md).
- **B2b — frame-pinned pro, size check** (SUPERSEDES "`PHOTO_VIEW_ARM = "edit"`"
  and "size not checked"): the model is `photoViewArm()` —
  `PHOTO_VIEW_MODEL` = `pro` (default, `google/nano-banana-pro`) | `edit`
  (nano-banana, the fallback). Pro takes only an aspect enum, so
  `lib/render/frame-pin.ts` pads the photo to 9 : 16 with mirrored edges
  (`padToAspect`), and cuts the output back to the photo's frame. The cut uses
  the pad geometry, refined from the fixtures read in both images (`fitMap`):
  one scale + offset, accepted only within `FIT_BOUNDS` (15 % / 10 %), so a
  recomposition fails instead of being cropped into passing. The placement
  check and the style check run on the cut-back image. **Size**: every item's
  box area must stay within ±`SIZE_TOLERANCE` (25 %) of the photo's ("the render
  shrank the WC (−59 % of its area)"). Every photo view's check line ends
  "· fittings may differ" (`FITTINGS_NOTE`, `photo-check-vocab.ts` — the
  client-safe strings). Small fittings (taps, rails, hooks, riser) stay
  unchecked: stated, not fixed. Live (P1–P5, refs on, 2 attempts):
  - pro: layout + style **3/5** at ≈ US$0.21 per render;
  - nano-banana under the size rule: 2/5 at ≈ US$0.09 per render;
  - P2 and P3 still recompose (the vanity grows to the references' size).

  ±25 % is near the reading noise. `scripts/b2b-rejudge.ts` re-judges eval
  images without rendering.
- **Cost guard**: every paid call a photo view makes (image model per image,
  each vision reading per token) is a `render_spend` row (model, size,
  cost_usd/aed; `lib/render/render-spend.ts`, prices from the Replicate model
  pages); `projectRenderSpend` = render_spend_aed, shown in the studio.
- **Checks**: `lib/render/__tests__/photo-check.test.ts`; the eval
  `scripts/b2-restyle-eval.ts` + `scripts/b2-style-rescore.ts`; live
  `scripts/b2-photo-view-check.mjs` (studio, five views) and
  `scripts/b2-deliberate-failure.ts` (a moved vanity must fail honestly).

## Brand — Atelier Precise (parked marketing only since K8)

The visual system is **Atelier Precise**: an editorial, paper-on-paper aesthetic
for the luxury Dubai market. Calm, exclusive, meticulous — a private
architectural atelier, never a construction tool. Replaces the old Dark Silk
(dark + neomorphic) system entirely. The reference materials live in
`design-refs/stitch_rennovaite_design_system/` (gitignored, local-only); the
spec is `atelier_precise/DESIGN.md` and the canonical shell wiring is
`landing_page/code.html` / `project_dashboard/code.html`.

**Atelier pages are light-only.** (Dark mode exists only on Blueprint pages —
see above.)

### Where tokens live

- **`tailwind.config.ts`** holds every Atelier design token (colors, fonts,
  fontSize scale, spacing, borderRadius, boxShadow). It is loaded by
  `app/globals.css` via `@config "../tailwind.config.ts";` — Tailwind v4's
  legacy-config bridge. **Add/adjust design tokens there, not in `@theme`.**
- **`app/globals.css`** holds only: the `@config` line, the shadcn CSS
  variables (`:root`) mapped to Atelier tokens, the four utility classes, the
  base layer, and the Material Symbols class. No `@theme` blocks, no
  neomorphic utilities (they were deleted with Dark Silk).

### Color tokens

Editorial (semantic) aliases — reach for these first:

| Token       | Hex       | Use                                  |
| ----------- | --------- | ------------------------------------ |
| `canvas`    | `#F7F3EC` | app base background (`bg-canvas`)    |
| `paper`     | `#FFFFFF` | cards, panels, interactive surfaces  |
| `bone`      | `#EDE6D8` | matte borders, dividers              |
| `ink-900`   | `#0F1B2D` | primary headlines / text             |
| `ink-700`   | `#334155` | long-form body text                  |
| `ink-500`   | `#64748b` | captions, table headings             |
| `ink-100`   | `#e2e8f0` | hairline border color                |
| `brass-600` | `#A4793A` | primary actions + active states      |

The full Material Design 3 set also exists (`surface`, `surface-container*`,
`on-surface`, `on-surface-variant`, `primary`, `secondary`, `tertiary`,
`outline`, `outline-variant`, `error`, the `*-fixed*` ramp, etc.) — Stitch
shipped both; both are valid. The standard Tailwind `slate` scale is also
available.

### Typography rules

- **Always use EB Garamond for display, Inter for UI, JetBrains Mono for
  numerics — never hard-code other families.** Use `font-display`/`font-serif`
  (EB Garamond), `font-sans`/`font-body` (Inter), `font-mono`/`font-data`
  (JetBrains Mono). All three are **self-hosted** via `next/font/local` in
  `app/layout.tsx` from `app/fonts/` (the exact woff2 files Google served for
  the declared subsets — `app/fonts/SOURCES.json` records each file's origin
  URL; no build-time fetch from Google Fonts) and exposed as CSS variables;
  Arabic fallbacks (IBM Plex Sans Arabic for body, Rubik for display) are
  appended to each stack so RTL works without rework. Material Symbols is the
  one remaining Google Fonts reference: a runtime `<link>` in the browser,
  not a build-time fetch.
- Use the type scale tokens, not raw sizes: `text-display-hero` (64/72),
  `text-headline-lg` (40/48), `text-headline-lg-mobile` (32/40),
  `text-headline-md` (24/32), `text-body-lg` (18/28), `text-body-md` (16/24),
  `text-body-sm` (14/20), `text-data-mono` (14/20), `text-label-caps`
  (12/16, +0.05em).
- **Numeric cells in tables always use `font-mono tabular-nums`** (AED
  amounts, m², measurements) so figures align.

### Iconography

- **Always use Material Symbols via the global font** — on Atelier pages
  render `<span className="material-symbols-outlined">icon_name</span>`. The
  class name is historical: since K1 it draws the ONE icon font, Material
  Symbols **Sharp**, at weight 400 / opsz 24 / 24px (the size is unlayered, so
  `text-*` utilities do not resize it — use an inline `fontSize`). Loaded once
  via a `<link>` in `app/layout.tsx`. Blueprint pages use `<Icon>`. **No inline SVG icon imports** and no
  lucide-react in new code. (DESIGN.md mentions Phosphor — ignore that; Stitch
  shipped Material Symbols and we match what Stitch shipped.)

### Imagery, elevation, shape

- **Always wrap photographic images in the `matte-image` utility** (8px Bone
  padding, `rounded-lg`) — mimics framed architectural blueprints.
- **Hairlines over shadows.** Use the `hairline` utility or
  `border border-ink-100`; never reach for Tailwind's heavy `shadow-lg`. The
  sanctioned depth tokens are `shadow-hairline`, `shadow-level-1` (hover
  lift), `shadow-level-2` (modals / render focus).
- Radius scale: inputs `rounded` (4px), buttons `rounded-lg` (8px), cards
  `rounded-md` (12px) / `rounded-xl` for large panels. Focus uses the
  `focus-ring` utility (2px brass outline, 2px offset).

### Shell

Every in-app page is wrapped in `<AppShell pageName="…">` from
`components/app/AppShell.tsx`, which composes:

- `<Sidebar />` (`components/app/Sidebar.tsx`) — fixed 240px (`w-60`) left
  rail, `#FBF7EE` bg. Wordmark + "Pro Plan" caption, primary nav (Dashboard,
  AI Designer, My Projects, Marketplace, Community), secondary nav (Settings,
  Support). Active item: 4px `brass-600` leading bar + `ink-900` weight-600.
  Client component (`usePathname`).
- `<TopBar pageName />` (`components/app/TopBar.tsx`) — fixed 64px (`h-16`)
  bar: wordmark · bone divider · page name on the left; search pill,
  notifications, avatar on the right.
- Main column offset `ml-60 pt-16`, `bg-canvas`, `p-12`, scrolls
  independently.

Marketing surfaces use `components/marketing/TopNav.tsx` (transparent over
hero → paper bg + hairline on scroll past 80px) and
`components/marketing/Footer.tsx` (4-col, `ink-900` bg).

### Floorplan SVG

`editable-plan-viewer.tsx` was repainted to Atelier in the parsed-plan
rebuild (B4): rooms fill bone (`#EDE6D8`) at 50%, walls stroke `ink-900`
1.5 px, EN label Inter 13/500, AR label Rubik 13/500, area in JetBrains
Mono 11. Hover swaps the polygon to `primary-fixed` and lifts the label
2 px.

(The legacy `plan-canvas.tsx` thumbnail with the sand + terracotta
palette was deleted in B11 once `/my-projects` was rebuilt. There is
now no sanctioned non-Atelier palette anywhere in the app.)

### Don't

- Don't add dark styles to Atelier pages. Dark mode is Blueprint-only (signed
  off with R7 / Gate 3) and comes from its tokens.
- Don't put design tokens in `@theme` — they live in `tailwind.config.ts`.
- Don't hard-code font families, use heavy `shadow-lg`, or import SVG icon
  components — use the tokens/utilities above.
- Don't reach for the deleted Dark Silk / neomorphic utilities (`neo-raised`,
  `glow-indigo`, etc.) — they no longer exist.

## Conventions

- **BoQ output must use POMI work-section names.** When Claude or any agent
  emits a Bill of Quantities, group line items by POMI (Principles of
  Measurement International) work sections — not by room, not by trade, not by
  free-form headings. Downstream pricing and QS review depend on this.
- Keep secrets in `.env.local` (already gitignored). The six expected env vars
  are listed in that file — add new ones there AND document them here.
- Prefer server components and server actions; only drop to `"use client"`
  when a component genuinely needs interactivity.
- Validate every LLM or external-API payload with a zod schema before trusting
  it. Never pass raw model output into a render or a DB write.

## Render pipeline

(G1b extends this to EXTERIOR zones — two garden directions, a ground-plane
off-plan shell, and no bare 400 for an unrenderable type. See "Exterior
rendering" below.)

Room renders are **photo-first, image-edit based** — the old synthetic
control-image path (`flux-canny-pro` / `flux-depth-pro` + `lib/control-image.ts`)
was deleted. `app/api/render/route.ts` restyles an image with an edit model
(`RENDER_MODEL`, default `google/nano-banana`) rather than generating from
scratch:

- **Photo path** (`mode="photo"`): if the room has an uploaded `room_photos`
  row, its photo is the edit source — the render reads as the owner's real room.
- **Off-plan path** (`mode="offplan"`): no photo → `flux-1.1-pro` first
  synthesises an empty-room shell from the parsed-plan dimensions
  (`lib/room-geometry.ts` + `buildOffplanBasePrompt`), then the same edit pass
  restyles it.
- **Tweak path** (`mode="tweak"`, `app/api/render-iterate/route.ts`): Claude
  rewrites the tweak into a concrete prompt, then the edit model edits the
  **parent render's image** so changes stay localized.

**Material grounding**: the chosen style's moodboard
(`public/moodboards/<style-key>-<room>.png`, sent as a base64 data URI) is
passed as a second image input to nano-banana, and the user's selected vendor
SKUs (`vendor_selections` → `pricing_skus`) are appended as a `Materials:`
clause. Prompt builders live in `lib/render-prompts.ts`; shared Replicate
helpers (model selection, input shaping per model family, timeout) in
`lib/render-image.ts`; grounding helpers in `lib/render-grounding.ts`.
`renders` rows record `source_image_url`, `model`, and `mode` for A/B and
tracing.

### Room-photo uploads (client compression)

The photo path's source image is uploaded from the render page's
`RoomPhotoPanel` through the asset library (since H9 a direct-to-storage
upload — see "Direct-to-storage uploads (H9)"). Raw phone photos (8–15 MB / 12 MP) used to hit an upstream
body-cap and fail with a raw **HTTP 413** before ever reaching the route. So the
client **compresses first** (`lib/image/compress.ts`): decode with EXIF
orientation baked in, downscale to long edge ≤ **2048 px**, re-encode JPEG
**q0.85** — a typical upload lands at ~0.5–2 MB. Small in-dimension JPEG/PNG
originals (≤ 1 MB) pass through **byte-identical**. HEIC is converted where the
browser can decode it, otherwise the user gets a friendly "use JPG/PNG" message
(never a raw 413). The pure decision logic (`fitWithin`, `planImageProcessing`,
`isHeic`) is unit-tested in `lib/image/__tests__`.

Server limits: the one table, `lib/uploads/limits.ts` (H9) — compression keeps
photos far under it, and an over-limit file gets the structured
`{ code: "payload_too_large", kind }` rendered as an Atelier error state.

## Project asset library (A3/A4/C2)

One catalogue for every document a project accumulates, so a photo uploaded at
intake is **reusable at the render step** instead of being re-uploaded per room
(intake photos used to be preview-only and discarded).

- **Table** `project_assets` (migration `024`): `kind` (`floorplan |
  drawing_mep | drawing_electrical | drawing_hvac | photo | reference_image |
  other`), nullable `room_id`, `storage_path`, `filename`, `mime`, `bytes`,
  `source` (`intake | render | moodboard`). RLS disabled like every table.
- **Storage**: reuses the existing public `plan-uploads` bucket at
  `<projectId>/assets/<uuid>.<ext>` (the floorplan keeps its
  `<projectId>/<uuid>.<ext>` path); public URLs are derived at read time, so no
  url column. Vocabulary + validation are pure in `lib/assets/types.ts`
  (unit-tested); server reads/paths in `lib/assets/load.ts` (degrade to `[]`
  when the table is absent).
- **Route** `POST /api/project-asset` (since H9 JSON `{ path, kind, source?,
  room_id?, filename? }` — the file was uploaded straight to Storage first)
  verifies the upload against `lib/uploads/limits.ts` (per asset kind: images =
  PNG/JPG; drawings = PDF/DWG/DXF/images, by magic bytes), stores + inserts, and
  rolls back storage on failure. `PATCH` assigns an existing photo asset to a
  room. Images are compressed client-side (the S1 pipeline) before upload.
- **Intake** (`/project/new`): the floorplan (recorded from `/api/upload`) and
  site photos both land in the library; an optional **"Existing drawings
  (MEP · Electrical · HVAC)"** card files uploads under the selected discipline.
  Assets dropped before the plan exists are **queued** and flushed once the
  project is created. Drawings are **stored/listed only — not parsed** (later
  scope; no viewers).
- **Render** (`RoomPhotoPanel`): the per-room dead-end uploader is replaced by
  the reusable **`components/assets/AssetPicker`** — a thumbnail grid of the
  project's photo assets (assign to the current room) plus an "upload new" path
  into the library. Assigning a photo mirrors a `room_photos` row so the
  **render pipeline is unchanged** (it still reads the latest `room_photos` per
  room). The same picker is the pattern for the future moodboard step (B2).
- **Hub** (`/project/[id]`): a **"Project files"** panel
  (`components/assets/ProjectFilesPanel`) lists all assets grouped by kind with
  download links; it renders nothing when the library is empty.
- **DB step**: `supabase db push` (see `docs/MIGRATIONS.md`). Everything
  degrades gracefully until the migration runs —
  intake still works, the render picker shows the upload path, and the hub panel
  is hidden.

## Drawings — geometry contract + 2D drawing engine (P1)

Auto-generated, **deterministic** (no LLM) A3 drawing set: dimensioned as-built
plan, proposed/demolition plan, and finish schedule. Gated by `DRAWINGS_ENABLED`
— when unset/false the `/project/[id]/drawings` route 404s and the plan page is
unchanged.

- **Geometry contract** lives in `lib/plan/geometry.ts` — `PlanGraph` (rooms /
  walls / openings / meta) is the single source of truth for the drawings, the
  future 3D viewer, and permit checks. `buildPlanGraph` is pure/unit-tested;
  `derivePlanGraph(projectId)` (`lib/plan/derive.ts`) reads it from the DB.
  Today we persist **room polygons only** (normalised `[0,1]`), so walls are
  **derived** from shared polygon edges (default 200 mm, `is_structural: null`),
  metres are derived from `total_area_m2`, ceilings default to 2.9 m. Every
  derived value is flagged (`derived: true` / `derived_fields`) and surfaced in
  the UI + `derivedNotes`.
- **Openings (doors/windows/archways — A5 plumbing)**: `plan_openings`
  (migration `026`) persists openings as first-class children of **walls**
  (`kind` door|window|archway, `source` parsed|user_drawn, `position` normalised,
  `along_offset`, dims in mm, `derived: true` when dimensions are DEFAULTED —
  a defaulted opening never silently reads as measured). `buildPlanGraph`
  ingests them and **snaps each to its nearest derived wall** (derived wall ids
  are volatile), so `quantify.ts` already deducts opening area from
  `wall_plaster`/`wall_paint` net. `derivePlanGraph` reads the table best-effort
  (empty before 026). Providers may supply openings via `RawParseResult.openings`
  (the in-house Claude provider does not — forward-looking for a hosted / vector
  provider); the R2 2D editor writes via `POST/DELETE /api/plan-openings`
  (`source: user_drawn`). The door/window schedule view is the remaining A5
  consumer (R2).
- **Snapshots**: `plan_snapshots` (migration `013`) stores as-built (at
  parse-confirm) and proposed (at design lock) graphs; diffing them drives the
  demolition sheet (and later P2/P6). Writing is best-effort in
  `lib/plan/snapshots.ts` and never touches the parse flow / `EditablePlanViewer`.
- **Drawing engine** in `lib/drawings/`: `sheet.ts` (A3 template, title block,
  north arrow, scale bar; Inter / JetBrains Mono / EB Garamond), `plan-sheet.ts`
  (double-line walls, room labels, dimension chains — offset 600 mm, values in
  mm, closure unit-tested), `demo-sheet.ts` (as-built▵proposed demolition
  marking), `finish-schedule.ts` (table), `export.ts`
  (`generateDrawingSet(projectId)` + PDF). Sheets are authored at true A3 size so
  they print **1:100**.
- **PDF export uses `@resvg/resvg-js` → PNG → `pdf-lib`** placed on a true-size
  A3 page (chosen over `svg2pdf`, which needs a DOM server-side). DXF is deferred
  (`TODO(P-later): DXF via dxf-writer`).
- **Persistence** (`drawing_sets`, migration `014`) is best-effort in
  `lib/drawings/persist.ts`, regenerated on design lock (`approve-design`). It
  uploads to a **private** Storage bucket named **`drawings`** and stores
  long-lived **signed** URLs in `sheet_urls` (the bucket is private, so public
  URLs would not resolve).
- **DB steps** (`npm run db:push` — see `docs/MIGRATIONS.md`): apply the
  migrations, and create a **private** Storage bucket named `drawings`. Live
  generation + PDF download work without them.

## Overlays — electrical + plumbing (P2)

Point-based electrical + plumbing layers on the 2D plan whose **counts** feed
two new BoQ sections deterministically. `OVERLAYS_ENABLED` gates the overlay
UI, rule seeding and the services sheets — since H3, NOT the BoQ feed.

- **Fixtures** live in `plan_fixtures` (migration `015`): `layer`
  (electrical|plumbing), `type`, `room_id`, `position` ([x,y] in **normalised**
  plan space, like `rooms.polygon`), `source` (rule|user). Types are listed in
  `lib/overlays/types.ts`.
- **Rule seeding** (`lib/overlays/seed.ts` + `rules.ts`): `seedOverlays(planGraph)`
  places DEFAULTS per room type (a plain data table with a rationale per rule —
  these are defaults, **not** code-compliance rules; P6 owns code checks). Pure
  + unit-tested. Seeded fixtures are `source: 'rule'`; the server seeds on first
  `GET /api/plan-fixtures`.
- **2D editing** is the only editing surface: the plan page's `PlanLayers`
  toggle (Plan / Electrical / Plumbing) swaps `EditablePlanViewer` for
  `OverlayEditor` (drag / palette-add / delete → `POST`/`DELETE`
  `/api/plan-fixtures`, always `source: 'user'`). Flag off → no toggle, plan
  unchanged.
- **BoQ feed** (`lib/overlays/boq.ts` + `boq-feed.ts`): `appendOverlaySections`
  (unconditional since H3 — a flag-off deploy used to drop both sections) adds **"Electrical Installations"** + **"Plumbing & Sanitary"** POMI sections
  to the generated BoQ (both engine + LLM paths) with quantities = fixture
  counts (never the LLM). Each line records `element_refs` (fixture ids) and
  `rate_status`; where the catalog has no default point rate the line is
  `rate_status: 'needs_qs'` (rate 0) and renders with a terracotta dot in the
  BoQ table. `element_refs`/`rate_status` are additive optional fields on the
  jsonb BoQ line (P4/P5 build on `element_refs`). Existing sections / zod / KG
  are untouched.
- **Drawings**: `lib/drawings/electrical-sheet.ts` + `plumbing-sheet.ts` add
  services sheets (symbols + legend + count table) to the drawing set when
  fixtures exist (needs `DRAWINGS_ENABLED` too).
- **DB step**: `supabase db push` (see `docs/MIGRATIONS.md`). The unit tests +
  flag-off behaviour work without it; seeding/editing/BoQ-feed activate once it
  has run.

## 3D viewer — walkthrough from the plan graph (P3)

A **view-only** 3D walkthrough built from the P1 `PlanGraph`. Hard constraint
(Way Forward): orbit / walk / measure / inspect only — **no** transform gizmos,
drag handles, or geometry mutation anywhere. Edits live in the 2D plan.
Gated by `VIEWER_3D_ENABLED`.

- **Deps** (added in P3): `three` 0.185, `@react-three/fiber` 9 (React 19),
  `@react-three/drei` 10, `@types/three` (dev).
- **Scene builder** `lib/viewer/scene.ts`: pure `buildScene(planGraph, finishes?)`
  → plain geometry data (wall boxes extruded to `ceiling_h_m` at true
  `thickness_mm`, floor slabs per room, world-centred bounds, wall centre-lines
  for collision). Imports no three.js → SSR-safe + unit-tested (wall count,
  metric dimensions). Openings are cut where the graph has them (centred, since
  the P1 contract has no along-wall offset yet — Mudon has none). Walls flagged
  `derived: true` render at 60% opacity with a hairline edge. Floors tint from
  the locked style via `lib/viewer/finishes.ts`.
- **Component** `components/viewer/Villa3D.tsx` (client, react-three-fiber) on
  route `app/project/[id]/viewer` (AppShell, `pageName="3D Viewer"`), loaded via
  `Villa3DLoader` (`next/dynamic` `ssr:false` — three must not run in SSR).
  Orbit (`OrbitControls`, clamped above the floor) / Walk (`PointerLockControls`,
  1.6 m eye height, WASD+arrows, axis-separated wall collision). Measure tool
  (click two points → Mono metre label), toggleable room-area labels, and brass
  render anchors at room centroids that open the room's latest render in a
  `matte-image` overlay. Empty state (EB Garamond italic) when the plan has no
  walls.
- **Panorama (stretch)**: `renders.kind` (migration `016`, default `'still'`)
  lets the viewer branch to an inverted-sphere 360° view for `'pano'` renders.
  Pano *generation* is NOT built — `// TODO(P-later): pano generation via render
  pipeline` marks where it would branch.
- **Entry**: "Walk your villa in 3D" (`view_in_ar`) on the plan page + project
  hub, shown only when the flag is on and a confirmed plan exists.
- **DB step**: `supabase db push` (see `docs/MIGRATIONS.md`). The viewer works
  without it (defaults `kind` to `'still'`).

## Furniture staging — style-consistent renders + optional priced section (P7)

Two compounding pieces off one staging vocabulary, gated by `STAGING_ENABLED`.

- **Vocabulary** `lib/staging/sets.ts`: per style key × `StagingRoomType`
  (living / majlis / master-bed / kids-bed / dining / kitchen-adjacent) a
  style-consistent set of 4–6 GCC-appropriate pieces (traditional directions get
  majlis floor seating; contemporary ones get raised majlis sofas). Each item's
  `key` is a generic priceable `FurnitureKey`; its `label` carries the per-style
  flavour. `stagingRoomTypeFromDb` maps DB room types (wet rooms / circulation →
  null). Pure + unit-tested.
- **Render enrichment** `lib/staging/prompt.ts` → `buildStagingBlock`: in
  `app/api/render/route.ts` the STAGING block is appended **after** the KG
  context (so real KG fixtures keep precedence for fixed elements) — staging only
  dresses movable furniture and pins the architecture. It only appends to the
  prompt (the cache key), so caching + the tweak/iterate flow are untouched: flag
  off vs on are just two distinct prompts → two cache entries. The set used is
  persisted best-effort to `renders.staging_set`.
- **Prices** `lib/staging/prices.ts`: indicative Dubai retail per `FurnitureKey`
  at three tiers (IKEA / Home Centre / Danube Home); each style maps to a tier.
  The module is the source of truth; `loadFurniturePrices` prefers the optional
  `furniture_prices` DB table and falls back to the module (works before the
  migration). **All furniture rates are `rate_status: 'indicative'`.**
- **Opt-in** — after a render is locked, a ghost "Add furniture to your budget?"
  (`components/staging/FurnitureOptIn.tsx`, once per room) POSTs to
  `/api/furniture-opt-in` → `furniture_opt_ins`.
- **Optional BoQ section** `lib/staging/furniture-boq.ts` +
  `collect.ts`: at BoQ read-time `collectFurnitureSection` builds ONE
  **"Furniture (optional)"** section from opted-in rooms' staging sets. It is
  passed to `BoqView` as a **separate prop — never written into `boqs.sections`**,
  so every contractor-facing surface that reads the stored jsonb excludes it by
  construction. Rendered visually apart with an `OPTIONAL — NOT IN CONTRACTOR
  SCOPE` eyebrow; toggling it off (what-if panel or the section header) subtracts
  its total exactly, restoring the prior figure.
- **DB step** (`npm run db:push` — see `docs/MIGRATIONS.md`): the staging
  migration adds `renders.staging_set`, `furniture_opt_ins`, and the optional
  `furniture_prices` table. Unit tests + flag-off/degraded behaviour work without
  it; opt-in persistence + the live BoQ section + `staging_set` tracing activate
  once it's applied. Optional: `node scripts/seed-furniture-prices.ts` to seed
  DB-editable price overrides.

## Authored plans + outdoor zones (garden pilot G1)

A project can start with **no drawing to parse**, and the plan model carries
**outdoor zones** alongside interior rooms. Gated by `GARDEN_PILOT_ENABLED` —
off = a project still needs an uploaded floorplan and the room vocabulary is
exactly the parser's.

- **Authored plans** (`plans.source = 'user_drawn'`, migration `031`).
  `POST /api/draw-plan` creates a project with no upload; `PATCH` takes over an
  existing plan whose parse found nothing. Until G1 `/api/upload` was the only
  code path that inserted a project.
  **The plot is the scale**: `plans.plot_width_m` / `plot_depth_m` are measured,
  and normalised space runs x ∈ [0,1] across the plot width, so
  `unit_to_m === plot_width_m`. `buildPlanGraph` uses it verbatim and sets
  `derived.metric_scale: false` — a typed dimension is a measurement. This is
  not cosmetic: the area-derived scale assumes rooms **tile** the plan, which
  interior floors do and a garden does not, so inferring it would inflate every
  zone to fill the plot.
- **No spinner is reachable.** `parsedComplete` used to gate the whole editor on
  `parsed_json !== null`, so a plan without rooms rendered `ParseLoading`
  forever — and an authored plan can never satisfy it. The gate is now
  `authored || (parsed_json && rooms > 0)`, and the else branch is
  `PlanNotAnalysed`: an actionable card (re-run the analysis / take the plan
  over by hand) instead of a spinner.
- **Zone vocabulary** `lib/plan/zones.ts` (pure, unit-tested). Interior tokens
  mirror the parser prompt exactly; outdoor tokens are `paving`,
  `artificial_grass`, `planting_bed`, `deck`, `path`, `structure`, `pool`
  (`pool` is stored but not priced). `balcony`/`terrace` stay **interior** —
  reclassifying them would change every villa already parsed. The editor's
  hard-coded `room_type: "other"` is gone: there is a type picker, and the
  type's default drives `unroofed`.
- **Enclosure model.** `rooms.unroofed` (default false). An unroofed zone has
  `ceiling_h_m: 0`, and **a wall interval whose every covering room is unroofed
  is not emitted** — a lawn meeting a paved area is a change of surface, not a
  wall. A wall on a garden edge exists only where a `boundary_wall` element was
  drawn (those append to `walls[]` as `source: 'drawn'`, `derived: false`).
  A shared edge between an unroofed zone and a roofed room still emits its wall.
- **Linear elements** `lib/plan/elements.ts` + `plan_elements` (031) +
  `/api/plan-elements`: `boundary_wall | bench_run | planter_run | counter_run`,
  polylines in normalised space, length derived in metres at graph-build time
  (never stored, so it cannot drift). Defaulted cross-sections are flagged
  `derived`, same rule as openings. Editing surface is the **Elements** layer in
  `PlanLayers`. Lighting and drainage **points** needed no schema: they are two
  new `plan_fixtures` types (`garden_light`, `drainage_point`) in a new
  `garden` overlay rule category, kept separate from `outdoor` so Mudon's
  terraces seed exactly what they always did.
- **Consumers.** `quantify.ts` emits no `ceiling_finish` for an unroofed zone;
  the finish schedule drops its Wall/Ceiling rows and keeps a surface row;
  dimension chains anchor on zone edges and drawn walls (`gridLines` reads both,
  so the chain still closes); the 3D scene renders open zones as ground slabs
  and gives a `structure` zone an explicit canopy height. `lib/boq/rules.ts`
  gains `LANDSCAPE_TYPES`, excluded from **both** the interior and the
  terrace/external buckets — folding a lawn into `EXTERNAL_TYPES` would have
  priced it as waterproofed porcelain. Landscape quantities are G2's; until then
  a drawn garden reports its area (`takeoff.summary.landscapeAreaM2`) and prices
  nothing, which is a visible gap rather than a silent wrong number.
- **DB step**: `supabase db push` (see `docs/MIGRATIONS.md`) for `031`.
  Everything degrades gracefully until it runs — `derivePlanGraph` falls back to
  the pre-031 selects, the plan page still renders, and `/api/update-plan`
  retries the room upsert without `unroofed`.

## Exterior rendering — garden styles (garden pilot G1b)

Zones render. Before G1b `roomTypeFromDb` mapped eight interior tokens onto four
prompt types and everything else was a **bare 400** — every terrace, every
balcony and every garden zone was simply unrenderable.

- **Two exterior prompt types**: `garden-zone` (paving, artificial grass,
  planting bed, deck, path, pool — and `terrace` / `balcony`, which were the
  clearest casualties of the old hard stop) and `outdoor-structure`
  (`structure`). `isExteriorRoomType` is the branch every builder keys off.
- **No bare 400.** A type that genuinely has nothing to photograph (stairs,
  closets, circulation) returns a structured **422** — `{ error, code:
  "room_type_unsupported", room_type, supported }` — naming the type and
  listing what is renderable, instead of a sentence about the first-floor scope.
- **Two exterior directions** in `lib/garden-styles.ts`: **Desert Modern**
  (`desert-modern`) and **Courtyard Majlis** (`courtyard-majlis`). Deliberately
  a separate module from `lib/styles.ts` — `STYLES` is not just a list, it is
  what `lib/ideation/questionnaire` scores and what the moodboard and style
  pages render, so two more entries there would have changed the ideation
  recommendation for every interior villa. `GardenStyle extends Style`, so any
  surface that shows "the project's direction" takes either (`resolveAnyStyle`).
- **Moodboard art**: four 1024×1024 PNGs at the same path and naming as the
  interior 24 (`public/moodboards/<style-key>-<garden|structure>.png`), so
  `loadMoodboardDataUri` needs no special case. Generated once by
  `scripts/generate-garden-moodboards.mjs` (flux-1.1-pro, idempotent, not wired
  into any build — regenerating on deploy would quietly change what every
  garden render is grounded against).
- **Style pairing, never silent.** A project locks ONE direction. An exterior
  zone renders in that direction's companion exterior style (`gardenStyleFor`)
  and an interior room on a garden-led project in the companion interior one
  (`interiorStyleFor`); the render response carries `style_key` and, when it
  substituted, `style_substituted_from`. Garden keys are lockable via
  `/api/style-choice` too.
- **Photo mode is the pilot path.** A client photo of a zone edits exactly like
  a room photo — same `room_photos` row, same edit model, same cache rules.
- **Off-plan shells are ground, not rooms.** `buildOffplanBasePrompt` branches
  for exterior: flat level ground inside a ~1.8 m blockwork boundary under open
  sky (a bare base slab for a structure), never a ceiling and primed walls. The
  edit prompt likewise asks the model to keep the **site's shape, boundary wall
  positions and levels** rather than wall, window and door positions.
- **Staging stays interior.** `lib/staging` now keys on `InteriorStyleKey`, and
  the render route skips the staging block for exterior zones — there is no
  movable furniture in a lawn to dress.
- **Interiors are untouched**: all 24 edit prompts, all 24 text-to-image
  prompts, all 8 off-plan prompts and all 12 interior classifications are
  byte-identical to the pre-G1b commit. The prompt is the render cache key, so
  that is what stops every cached interior render being invalidated.

## Landscape rate book + garden takeoff (garden pilot G2)

Ground-truth project **#2**: a real Dubai garden renovation, ingested from
`data/garden pilot/Garden_Ground_Truth_Villa94.xlsx`. Not flag-gated — a rate
book and a set of pure rules change nothing until something calls them.

- **Identity is a hard rule, not a preference.** The contractor is an
  independent firm with no relationship to the client this pilot serves, and
  these are their negotiated prices. Their name appears in exactly one place:
  `INTERNAL_REF` in `lib/ground-truth/villa94-garden.ts`, written to
  `rate_book.internal_ref` (migration `032`) and rendered nowhere.
  `rate_book.source` — which reaches the what-if engine, the BoQ line and
  therefore the client — carries `PUBLIC_SOURCE_LABEL`
  (*"market reference — Dubai garden 2026"*) instead. A test asserts the name is
  absent from every rendered string.
- **`lib/ground-truth/villa94-garden.ts`** is the transcription (read by
  unzipping the workbook and parsing sheet XML, never retyped): 20 contract
  lines, the 20-item rate calibration, totals, the timeline, and the
  invariants. **Three rates arrive ALREADY NET** — client-purchased tile, the
  boundary-light variation, the client-supplied grill — and re-applying the 12%
  to them would understate every future garden on exactly the lines a client
  pays directly. `ratesAreConsistent()` is the guard; the seeder refuses to run
  if it trips.
- **`scripts/seed-rate-book-garden.ts`** upserts the 20 rows as
  `provenance: 'actual_transaction'`, `qs_validated: false`, net in `rate_aed`
  and pre-discount in `list_rate_aed` (null where the rate was already net, so
  it cannot read as discounted). Idempotent and narrow: it deletes only
  `item_key LIKE 'garden.%'`, so a re-run cannot reach the Mudon interior
  actuals.
- **`lib/boq/garden-takeoff.ts`** is a SEPARATE take-off from
  `lib/boq/takeoff.ts`, and its rates come from a `GardenRateBook` rather
  than `lib/boq/rates.ts`. **Since T1.0 that book is read from `rate_book`**
  (`loadGardenRateBook`, `lib/boq/garden-rates.ts`) and a missing landscape
  book is a hard error, never a fallback to the constants; the ground-truth
  module keeps only the vocabulary (labels, units, inclusion rules) and the
  transcription the seeder writes (`transcriptionGardenRows`), which the pure
  dry-run and unit tests price from (`transcriptionGardenBook`). Pricing paths
  select `rate_book` through `REFERENCE_COLUMNS` (`lib/rates/reference.ts`),
  which never includes `source` or `internal_ref`. The interior `RateResolver` is driven by `RATE_RULES`
  over `labour_rates` + `pricing_skus` and throws on an unknown key, so routing
  garden keys through it would have meant inventing labour rows or editing
  interior rules. Rules **GL-01…GL-19** cover project lumps, hardscape
  (PCC + install + tile supply), softscape, runs per lm, discrete units,
  pergola by plan area, irrigation, lighting and boundary lights.
- **Two kinds of inclusion, and the distinction is load-bearing.**
  `INCLUSIVE_SCOPE` suppresses a LINE (a BBQ counter's sockets: there is no such
  thing as "the sockets the counter doesn't cover"). `QUANTITY_INCLUSIONS`
  reduces a QUANTITY (a pergola carries eight downlights, not every light in the
  garden). The first version listed the lighting keys as line-level, which would
  have zeroed a garden's entire lighting the moment somebody drew a pergola —
  the test caught it. `findDoubleCounts()` enforces the line-level rule plus
  `ABSORBED_SCOPE` (manhole covers, drainage points, sweet soil, edging,
  fertilizer were quoted at zero and absorbed; a line for any of them invents a
  cost).
- **Honesty flags.** Tile supply carries `rate_status: 'site_assessment'`
  because the rate is per m² PURCHASED and the reference order covered all
  paving *and* cladding from 66.24 m² against 87 m² of quoted paving. The
  irrigation lump carries the new `ScopeItem.qty_derived` — its rate is a
  transacted actual but its quantity is scaled from one reference project, and
  the scale is clamped to 0.5–2.0 because a lump stretched five times over is
  not a lump.
- **Sections**: `External Works`, `Landscape Structures`, `Irrigation`,
  `External Lighting` are added to `POMI_SECTIONS` and `SECTION_ORDER`. Purely
  additive — the engine emits a section only when a take-off item lands in it.
- **`scripts/record-garden-outcome.ts`** writes delta-log entry **#2** against a
  `Villa 94 garden (ground truth)` project: `actual_total` 152,059.44
  (contractor 138,146.44 + client-supplied 13,913), per-section net, and the
  90-day duration anchor. The platform side is left **null** — that BoQ does not
  exist until the G3 dry-run, and a fabricated figure would be worse than none.
  Unlike Mudon's flat AED 36,500, this 12% was applied uniformly to the quoted
  subtotal, so distributing it per section is exact; the script asserts the
  split reconciles to the project total before writing.
- **DB step**: `supabase db push` for `032`, then
  `node --import ./scripts/_alias-hook.mjs scripts/seed-rate-book-garden.ts` and
  the same for `scripts/record-garden-outcome.ts`.

## Garden BoQ + the calibration dry-run (garden pilot G3)

G1's drawn zones wired to G2's rules, and the result checked line by line
against the project that produced those rates.

- **Sections** (POMI-style): Preliminaries · Demolition · Hardscape &
  Structures · Soft Landscaping · Irrigation · Electrical & Lighting. Garden
  work reuses the first two rather than duplicating them;
  `appendGardenSections` merges into an existing section when a project has
  both.
- **`lib/boq/garden-boq-feed.ts`** reads the drawn garden — zones from `rooms`,
  runs from `plan_elements`, discrete items and points from `plan_fixtures` —
  runs the take-off, prices it, appends the sections and recomputes the
  contingency/VAT chain. Called from BOTH BoQ paths, exactly like the P2
  overlay feed. A project with no outdoor zones gets its BoQ back unchanged.
- **`takeoff_items` per zone × work item**: every area- and length-driven rule
  records a per-element row, so an aggregated line is the Σ of the zones that
  produced it and `element_refs` traces it back to the drawing. Lumps emit no
  element rows — a lump has nothing to attribute.
- **Counter variant picker** (migration `033`): one control in the elements
  editor, `bar | bbq`. `null` is the unanswered state, priced at the cheaper bar
  rate and flagged **`needs_selection`** — a new `rate_status` with the
  terracotta dot, because a real rate that is the default of an unmade choice is
  not the same thing as a rate nobody has. It matters twice over: AED 968/lm,
  and the BBQ rate is what carries the MEP inclusion that stops its sockets
  being counted again.
- **Irrigation is an allowance, not a formula.** One comparable project cannot
  support a per-metre driver, and dressing it as one would make the line look
  measured. It is a lump at three coarse size bands, carrying `site_assessment`
  (confirm the rate against this garden) **and** `qty_derived` (the band is
  inferred). It earns a real driver at n ≥ 3.
- **Discrete landscape items** (migration `034`) are `plan_fixtures` on a new
  `landscape` layer: a planter box, a wall feature and a BBQ grill are not
  surfaces and not linear metres, and a fourth shape would have been one too
  many.

### What the dry-run found

Villa 94's garden traced from the setting-out drawing at 1:50 (PDF → SVG path
extraction, not eyeballed), priced, compared against the actuals:
**AED 148,202.60 against 152,059.44 — −2.5%**, with 10 of 14 quantity-driven
lines inside ±10% and every delta classified. `scripts/garden-dry-run.ts` prints
the table; `scripts/garden-dry-run-live.ts` runs the same garden through the
real routes and records the platform side of delta-log entry #2.

**The pre-registered expectation was falsified, in the more useful direction.**
It said PCC measured off geometry would land ~12 m² ABOVE the contracted 75 m²,
on the premise that the drawing supports the contract's own 87 m² of paving. It
does not: the drawn paved surface is **64.27 m²**. The corroboration is the tile
actually bought — **66.24 m², within 3% of what we measure and 31% below what
was quoted**. The contract over-measured both lines, and the contract's own
quantities (87 m² paving + 71 m² grass = 158 m²) exceed the drawn open garden
(~136 m²). No rate was touched to close any of it.

Three rule bugs the dry-run caught, all fixed in the rules rather than tuned
away:

1. **A structure does not remove the paving beneath it.** Hardscape was
   measured as "paved zones minus structures", which under-measured PCC, paving
   install and tile supply by the pergola footprint. The paved *surface*
   includes it; only the superstructure is in the pergola's all-in rate.
2. **Interior preliminaries on a garden-only project.** `computeTakeoff` emitted
   project-level prelims — the scaffold and floor protection of an interior
   fit-out — with zero interior rooms, charging site establishment twice. It now
   returns nothing when there are no costable interior rooms.
3. **Interior floor finishes and the aluminum allowance on outdoor zones.**
   `quantifyPlan` now skips outdoor zones entirely (their surface is priced as
   PCC + paving + tile, or as grass), and `buildAluminumSection` returns null
   when every room is a landscape zone. `terrace` and `balcony` are untouched —
   they are interior rooms and stay that way.

Mudon's quantities, take-off and priced BoQ across three styles are
byte-identical to the pre-G3 commit. What-if works and deliberately does not
regrade landscape lines: the landscape rate book has one grade, so garden lines
count toward the scenario total but cannot be swapped.

## Garden documents — drawings, overlays, batch render, render pack (garden pilot G4)

Four deliverables, every one assembled from the same `PlanGraph`, built first
against Villa 94 (the client garden follows once its measurements land).

- **Villa 94 at its true geometry.** `lib/ground-truth/villa94-garden-geometry.ts`
  holds the traced polygons (the lawn residual via `polygon-clipping`, the bench
  court's curved edge as an elliptical quarter), runs, units and lighting points.
  G3's zones were areas laid out as squares; since G4 every zone area is computed
  from its polygon, so the BoQ, the dry-run and the drawings cannot disagree. That
  refinement moved the platform total by **+AED 2.41** (148,202.60 → 148,205.01,
  still −2.5%, still 10/14), and the curved cut came out at **1.8 m²** where G3's
  arithmetic said 1.9.
- **Derived area on the zone** (migration `035`): `rooms.area_derived_m2` +
  `derived_note`. The lawn carries its 1.8 m² approximation as a flag, so every
  document that prints the area prints the `*` and the reason. `buildPlanGraph`
  adds `area_m2` to `derived_fields` when it is set.
- **Dimension drawings** `lib/drawings/garden-sheets.ts`: L-100 site plan (zone
  schedule, runs, plot extents, levels legend — "no levels are carried by this
  plan" rather than an invented FFL), one L-1xx sheet per zone (every straight
  edge dimensioned in mm between real vertices, overall extents, facts panel; a
  curved edge is marked rather than dimensioned by its chords). A 26 m garden
  does not fit A3 at 1:100, so each sheet picks the largest standard scale that
  fits (`fitScale`) and prints it, with a true scale bar — the interior engine
  and its fixed 1:100 are untouched. Every dimension carries `data-dim`/`data-mm`
  so tests (and the live dry-run) check printed figures against the graph to
  the millimetre.
- **Overlays**: L-401 lighting & electrical (fitting codes, schedule, an
  indicative cable route as the minimum spanning tree — labelled *derived, not
  designed*) and L-402 irrigation & drainage (drip zones, planter runs, an
  indicative line, drainage points or an explicit statement that none are
  placed). **No HVAC.** Lighting is **as designed, never as surveyed**: point
  positions come from the design session, `plan_fixtures.spec.source =
  'as_designed'`, and the sheet states `LIGHTING_SOURCE_STATEMENT`.
- **Set PDF**: a garden-only plan gets the garden set instead of the interior
  sheets (mixed plans get both); `?format=pdf&sheet=all` returns the whole set as
  one multi-page PDF; a sheet is addressable by its number.
- **Batch render** ("Generate all", Newspace ask #2). `lib/render-batch/plan.ts`
  is a pure planner: a day view per renderable zone, plus an **evening** view for
  exterior zones with lighting on the plan (or a structure, whose downlights are
  part of it). `POST /api/render/batch` plans and prepares; it holds no queue.
  The client runner (`lib/render-batch/client.ts`) runs jobs through the existing
  single-render routes, so the cache, the per-project in-flight cap of 3, the QA
  gate and rehosting all apply; done jobs are skipped, so pressing twice costs
  nothing. `POST /api/render/evening` is an **edit of the zone's current day
  render** with a deterministic prompt naming only the designed fittings
  (`renders.view = 'evening'`, migration 035); it is kept out of the iteration
  chain and goes stale when the day view is tweaked.
- **Exterior style preset.** With `TASTE_SEED_ENABLED`, the batch seeds a garden
  project's EMPTY moodboard with its direction's garden + structure art
  (`gardenPresetItems`, new `EXTERIOR_STYLE_ROOMS`, deterministic descriptors), so
  every zone is conditioned on the same references. Never onto a board the user
  built, never onto a project with interior rooms (the seed is project-wide).
  The interior style-library catalogue is unchanged.
- **Render pack** (E1-lite) `lib/documents/render-pack.ts` (pure pages) +
  `render-pack-pdf.ts` + `GET /api/projects/[id]/render-pack` (gated with
  `DRAWINGS_ENABLED`; `?format=json` for a manifest): cover (direction, palette,
  hero render), plan overview (the L-100 sheet itself), a page per zone (day +
  evening where lighting exists, a stated placeholder where a view is missing),
  materials & finishes (zone schedule with the derived flag, built features with
  counter variants, lighting as designed). Chrome is rasterised like a drawing
  sheet; photographs are embedded at their own resolution. No price, rate, rate
  source or contractor appears in it.
- **Delta-log reasoning survives.** `lib/ground-truth/villa94-garden-dryrun.ts`
  is the one comparison both the printed report and the stored record use;
  `boq_outcomes.delta_lines` (035) stores every line's class and reason, and the
  four over-measured lines (PCC, paving install, grass supply + install) carry the
  client tile-purchase corroboration (`direct` for paving, `indirect` for grass).
- **A save-route bug the live run caught.** `/api/update-plan` ran overlap repair
  over every room, and clipping snaps vertices to 1 mm and inserts a vertex wherever
  a neighbour's corner touches an edge — so an abutting garden was reshaped on
  every save and the drawings dimensioned the extra vertices. `repairForSave`
  (`lib/plan/save-repair.ts`) now reshapes only rooms that actually overlap.

Interior output is unchanged: Mudon's graph (bar the additive null fields), as-built
and demolition sheet SVGs, quantities and priced BoQ across styles are
byte-identical to the pre-G4 commit.

**DB step**: `supabase db push` for `035`, then
`node --import ./scripts/_alias-hook.mjs scripts/garden-dry-run-live.ts [port]`
against a dev server started with `GARDEN_PILOT_ENABLED=true DRAWINGS_ENABLED=true`.

## Plan-faithful renders, elevations + levels, project isolation (garden pilot G4b)

G4 was not client-ready: text-prompted off-plan renders invented layouts (a
pergola render with no pergola in it) and the drawings had no eye-level
information. Both are fixed at the root.

- **Levels, heights and context on the graph** (migration `036`):
  `rooms.level_mm` (finished level vs ±000 FFL; null = not stated, never read
  as ±000), `rooms.height_mm` + `rooms.spec` (a structure's top and member
  sizes), `plan_elements.spec` (a run's build-up and `band_mm` — where its width
  sits across the traced reference line), `plan_fixtures.spec` (unit sizes),
  and **`plan_context`** — existing villa, garage, pergola, steps and boundary
  walls: never a zone, never priced. `PlanGraph.context` carries them. Every
  value records its source; assumed or scaled ones are `derived` and say so.
- **Villa 94 heights and levels are read from the KAME sections** (A-A-001,
  B-A-001/002, C-A-001, GL-PS-001): pergola TRL +2800 (150 mm members, posts at
  1000/3350), BBQ counter +900 × 900, bar +1000 × 450, bench +350 with a +600
  kerb, wall feature 2500 × 300 × 1800 with its arch, planter box +450, courtyard
  +300, front approach +150/±000, steps +150/+300. The boundary wall (~2000,
  scaled) and the villa/garage heights are not dimensioned and are flagged.
  Tracing the villa outline exposed three G4 zone-trace errors, corrected
  (courtyard L +1.26 m², front approach −2.76 m² and split into two levels,
  courtyard-mouth step −0.72 m² of lawn): the dry-run is now **AED 147,679.18,
  −2.9%, still 10/14**.
- **Sectional elevations** `lib/drawings/garden-elevations.ts`: L-301…L-307, one
  per structure (pergola, BBQ counter, bar counter, bench, planter run, wall
  feature, planter box), each view at a fitted KAME scale (main views 1:20) with
  heights, build-up and FFL/TRL/CTL/TOS/TOC level tags; L-501 whole-garden
  boundary elevation strips. **Level tags** on the site plan and zone sheets
  wherever the plan's levels differ, plus structure tops; existing context is
  drawn on the plans. Every dimension and level carries `data-src` — an
  expression over graph fields — and a test resolves it independently against
  the traced records. The live dry-run compares every printed figure (h, v and
  level) on the live set against the pure sheets. Elevation sheet numbers are
  ordered by content, never by database id.
- **The 3D scene** `lib/scene/*`: `buildGardenScene` turns the graph into
  triangles (zones at their levels, structures at their heights, context);
  `renderScene` is a deterministic software rasteriser (z-buffer, id buffer,
  outlines, evening glows at the designed light points); `chooseCameras` picks
  one camera per zone and up to three whole-garden views by scoring id-buffer
  probes; `buildManifest` lists what each camera actually sees.
- **The pipeline** `lib/scene-render/pipeline.ts` (+ `POST/GET
  /api/render/scene`): scene image → `google/nano-banana-pro` restyle (the style
  only paints) → **faithfulness gate** (`lib/scene-render/gate.ts`,
  `claude-opus-5` observes both images against the manifest; the pass rule is
  deterministic code) → one tightened retry (the gate's findings, surface
  regions, exact framing) → otherwise the **raw 3D design view** ships, labelled
  as such. The gate fails closed. Evening views relight a passed day render and
  are gated again; without one, the 3D night view ships. Calibration: the raw
  view passes, G4's pergola render fails with exact reasons; `nano-banana`
  reframed, `flux-depth-pro` invented buildings, `flux-canny-pro` paved lawns.
  **Text-prompted off-plan generation is retired for gardens**: `/api/render`
  delegates an exterior zone with no photo to the scene pipeline. An evening
  is also checked against the **night design model**: a lit fitting or wall
  where no light was designed fails it (lighting is as designed). A run whose
  every attempt died before producing an image (no credit, an outage) is an
  infrastructure fault — never saved or cached as a substitution. "Generate
  all" shows each garden view as *Checked* or *3D view* (render withheld).
- **The pack uses gated scene renders only**: `assertPackable` refuses an
  ungated render; every image is captioned "render · faithfulness check passed"
  or "3D design view"; whole-garden pages follow the plan overview; the JSON
  summary carries the gate table. "Generate all" plans a garden by camera
  (`planSceneBatch`).
- **Project isolation**: the scene cache key starts with the project id
  (`sceneCacheKey`, regression-tested with two projects seeded from identical
  records); render rows, camera manifests, storage paths
  (`projects/<id>/scene/…`), garden drawing sheets (`data-project-id`) and BoQ
  `element_refs` all resolve to their own project.
  `scripts/garden-isolation-check.ts` regenerates each project's full pack and
  asserts the other's rows, assets and cached images are untouched, both
  directions, against a stand-in seeded from the same records
  (`scripts/lib/garden-seed.ts`).

**DB step**: `supabase db push` for `036`; the `renders` public bucket must exist.

## Client garden on derived dimensions (garden pilot G5, draft stage)

The first real client garden ("Arabella Garden — Draft for Review", corner plot)
is drafted before anyone has measured it. The derived/measured distinction is the
mechanism, not a workaround.

- **Derived vs measured, per dimension** (migration `037`): `plans.dims_derived` +
  `dims_note`, and `dims_derived` on `rooms`, `plan_elements` (+ `derived_note`),
  `plan_fixtures` (+ `derived_note`) and `plan_context` (whose existing `derived`
  still means "height assumed"). `graphDraftStatus` (`lib/plan/geometry.ts`, over
  `lib/plan/site-reference.ts`) makes a plan a DRAFT while any boundary-critical
  dimension — plot, zone outline, run, context footprint — is derived. Every
  garden sheet then carries a terracotta stamp above the title block
  (`SheetMeta.draft`, `data-draft-statement`), the set gains an **L-000 cover**,
  the render-pack cover and header carry it, and the BoQ page header and every BoQ
  PDF page carry `DRAFT_STATEMENT` verbatim. Interior sheets are unchanged.
- **Site reference** (037): existing features photographed on site are placed as
  what they are (a `structure` zone with `spec.form: "gazebo"`, `counter_run`,
  `planter_run`, new run kinds `stepping_path` and `string_light_run`, landscape
  fixture `tree`, context boundary walls) and tagged `site_reference` with a
  `disposition` ∈ keep | remove | replace (null = undecided). One vocabulary
  decides everything: keep → excluded from demolition AND new work; remove →
  demolition only; replace → both; undecided → neither, and the pack refuses to
  export. The take-off writes `garden.removal` take-off rows and the demolition
  lump's `element_refs`; the 3D scene and drawings use `designGraph` (removed
  items out; kept ones drawn as existing, dashed, never detailed in an elevation).
- **Unpriced work is visible**: a deck, pool, stepping path, string lights or new
  tree has no reference rate — it is a `needs_qs` line at rate 0 under
  `UNPRICED_SOURCE_LABEL`, never silently dropped and never under the
  market-reference label. Quantities off derived geometry carry `qty_derived` +
  `DERIVED_QTY_NOTE`; the BoQ total prints `≈ AED 46,800*` with a footnote
  (`lib/documents/boq-derived.ts`, shared by page, PDF and pack).
- **Readiness gate** (`lib/documents/pack-readiness.ts`): `render-pack` and the new
  `GET /api/projects/[id]/boq-pdf` return 409 `pack_not_ready` while a NEW-work
  counter is untyped, an existing item is undecided, or the latest BoQ still has a
  `needs_selection` line (`?format=json` stays available with the verdict).
- **Editor (Step 2 support)**: the plan page's `GardenSitePanel` (draft banner,
  keep/remove/replace for every existing item, levels/heights via
  `PATCH /api/plan-zones`, pack readiness, friction log); context footprints drawn
  under every layer (`POST/PATCH/DELETE /api/plan-context`); a **Landscape** layer
  (planter box, wall feature, grill, tree — `/api/plan-fixtures` now accepts
  them, and an authored garden is never rule-seeded with lights); every canvas
  fits the PLOT, snaps to 5 cm; numeric X/Y/W/D, add/remove vertex; run and
  fixture inspectors (cross-section, size, light fitting).
- **Before/after photo pairs** (`lib/scene-render/photo-pair.ts` +
  `photo-pair-run.ts`, `POST/GET /api/render/photo-pair`): a client photo
  restyled with the design's decisions on the existing items in view, checked by
  a pair gate (kept items stay, removed go, replaced stay in place, house and
  viewpoint unchanged, nothing major invented; deterministic judge). Fails twice →
  WITHHELD (no substitute). `renders.mode = "photo_pair"`, project-first cache key.
- **Narrow-plot cameras** (`lib/scene/cameras.ts`, pipeline `g5-1`): a
  standpoint with under `NARROW_M` (6 m) of clear width to a building, wall or
  plot edge is cramped and gets no eye-level camera; zones in a corridor are seen
  from ELEVATED three-quarter views (4.2/5.6 m up, FOV 70, aimed at eye height,
  looking along the corridor axis — allowed up to 3 m beyond the plot line, kept
  2.2 m off buildings), and a narrow garden's whole-garden views look along two
  DIFFERENT corridors from 6.5 m. Every camera gets a clean-view verdict (zone ≥
  10% of frame, no solid mass within 2.2 m of the lens, a horizon, walls ≤ 45%,
  no structure > 40%); an unclean camera never spends a render attempt
  (`shouldAttemptRender`) — the labelled 3D design view ships with
  `design_view_reason: "no_clean_camera"` ("3D view · by choice" in Generate
  all). Cameras are memoised per scene hash in `loadGardenSceneContext`.
- **Pack backbone**: cover → plan → before/after pairs → whole-garden views →
  zones → materials. 3D design views fill every slot no render passed (by-choice
  views captioned as such); a passed day render carries its design view as an
  inset; the cover and `summary.mix` state the mix (pairs, design views by choice
  / after the gate, styled renders).
- **Metrics** (037): `pilot_events` (plan_started, plan_saved, design_edit,
  boq_generated with `full`, pack_exported, friction) written best-effort by the
  routes for authored plans; `computePilotMetrics` (`GET /api/pilot-events`) —
  time to draw (design session only; `stage: reference_layout|verification`
  events excluded), active minutes, time to first FULL BoQ, gate pass rate,
  friction list, corrections by type. `boq_corrections` (typed rate | quantity |
  scope | design, `market_fair` provenance, never applied to the rate book) via
  `ReviewCorrections` on the garden BoQ page.
- **Scripts**: `scripts/arabella-draft-plan.ts` (Step 1 through the authored
  routes; refuses to re-run; `--name` for a scratch rehearsal),
  `scripts/garden-draft-pack.ts <project>` (Step 3/4: readiness, BoQ, renders,
  photo pairs, three PDFs into `data/garden pilot/g5-draft-pack/` — gitignored,
  they contain client photos — and assertions on what is printed: watermark,
  derived total, needs_selection, elevations, overlays, zero contractor-identity
  leakage; gate table; metrics; Step-5 baseline),
  `scripts/garden-change-report.ts <project>` (Step 5 receipt: every quantity
  that moved, BoQ delta, whether the watermark drops),
  `scripts/garden-isolation-check.ts --client <id>` (now also snapshots photo
  assets, room photos, plan-uploads storage, pilot events, corrections).
- **Reference layout**: `lib/client-garden/arabella-reference.ts` — plot 26.7 ×
  10.5, garage/drive 6.3 + house 14.8 + side garden 5.6 (deck 2.1 + lawn 3.5),
  rear strip 4.3, the 0.1 m depth residual stated; existing features from the 14
  client photos; `PHOTO_COVERAGE` maps photos to zones and visible items. No client
  personal name anywhere.
- **Replaced by a different element** (`spec.replaced_by`, G5 design seed):
  replace used to mean like-for-like. When the replacement is ANOTHER design
  element (stepping path → porcelain paving zones, sink counter → a BBQ counter
  under the pergola, string lights → designed lighting) the old item counts toward
  demolition only, is out of the design (`isInDesign`), and the replacing element
  carries the new work — never both priced. `replaced_in_place` tells a photo pair
  whether the replacement stands where the old item did (otherwise it is simply
  gone from that camera). API only (no editor control yet).
- **Design assumptions page** (`lib/documents/design-assumptions.ts`): after the
  plan overview, a draft pack lists every existing item's proposal (REPLACE →
  what it becomes, REMOVE, KEEP), built from the same dispositions the take-off
  priced, plus layout assumptions (`spec.assumption`, context notes) and "Design
  direction … proposed, to confirm with the client". Absent when nothing is
  proposed (a completed garden).
- **Document names** (migration `038`): `projects.display_name`, set via
  `PATCH /api/projects/[id]`; every client-facing document (drawing set, render
  pack, BoQ PDF) reads the project through `loadDocumentProject`, so a working
  name like "…(ground truth)" never reaches a cover.
- **The gate checks what the client was promised, not just "a structure"**: a
  louvred pergola is named `louvred pergola` in the scene manifest and the gate is
  told shade sails / fabric / timber rafters are a different structure (a
  shade-sail render had passed as "a pergola" and become the cover); an existing
  tree the design KEEPS is `existing tree (kept)`, on the gate's list once ≥ 1% of
  the frame and in the render prompt's keep line (a render that dropped all six
  kept trees had passed). Both apply only where such items exist — other prompts
  are byte-identical.
- **Pair gate robustness**: the reply schema takes whatever the model names the
  extra-structure text field and treats an unsure `null` as "no" (a reply with
  `"what"` instead of `"description"` had made the gate "unavailable"); a withheld
  pair with no verdict (`isVerdictless`: every attempt a render error or an
  unavailable gate) is neither cached nor trusted from cache. The draft-pack
  script tries a zone's second photo when its first pair is withheld.
- **Seeding and reference packs are not the pilot**:
  `scripts/arabella-design-seed.ts` applies a design proposal through the authored
  routes and tags its events `stage: design_seed` (excluded from design-session
  minutes); `scripts/garden-reference-pack.ts` sets the reference project's
  display name, renders every camera, exports the render pack + drawing set (no
  BoQ — negotiated prices) and asserts no "ground truth", no house number, no
  contractor identity, no price and no draft watermark; its events are
  `stage: reference_pack` (excluded from metrics like `verification`).

**DB step**: `supabase db push` for `037` and `038`.

## Pack defects found in review, fixed at the root (garden pilot G5c)

The G5 draft pack went to review and came back with defects in three places: the
geometry was mirrored, the BoQ was incomplete, and the renders were not
client-viable. Each is fixed where it was wrong, not papered over.

- **Handedness** (`HANDEDNESS`/`toSite` in `lib/client-garden/arabella-reference.ts`,
  `scripts/garden-mirror-plan.ts`). The developer type plan depicts the unit's
  HANDED TWIN: on site the garden entrance and path are on the RIGHT facing the
  villa, then the rear strip, the pergola corner, the side garden on the LEFT.
  Established from the photos, not assumed — walking in from the front passage
  (WA0084–0086) the villa is on the LEFT and the rear wall's trees on the RIGHT
  (WA0077, WA0082), which the type-plan frame reverses. The fix is ONE reflection
  x → W − x applied to zones, runs, fixtures, context and openings through the
  editing routes, with polygons and polylines reversed so winding (and a run's
  band side) keeps its orientation. A reflection preserves area and length, so
  the script asserts the BoQ and every take-off row are byte-identical across it
  (they were: AED 116,942.01, 15 lines, 28 rows) and refuses to run twice.
- **The separator wall and its gate** (migration `039`): a garden's walls are
  `plan_context` footprints, not walls derived from room edges, so an opening
  could never attach to one. `plan_openings` gains `kind = 'gate'`, `context_id`
  (the wall it is in, never re-snapped), `spec` and the 037 site-reference
  columns. Gates are drawn on the site plan and zone sheets (clear opening,
  jambs, leaf and swing, `GT` tag), built in the 3D scene (posts + leaf), decided
  in `GardenSitePanel` like every other existing item, and listed on the cover
  and in the Design assumptions. The existing shed is a `landscape` fixture type
  with a footprint on the plans and a volume in the scene.
- **Scene = graph, proven.** The pergola was reported as "in the corner on the
  drawings, mid-pathway in the 3D". The scene builder was reading the same
  coordinates all along (x 23.2–26.7 in both); what misled was an oblique
  eye-level camera down a 4 m strip, where the far rear wall itself projects to
  the middle of the frame. `lib/scene/__tests__/scene-graph-parity.test.ts`
  pins it: every structure's scene bounds equal its plan bounds, and the id
  buffer at each structure's projected centre is that structure.
- **BoQ completeness**: planting beds carry a soil-preparation and planting line
  (GL-25, QS-to-price — they were measured for irrigation but never priced);
  outdoor taps are a placeable `water_tap` fixture on the irrigation/drainage
  overlay with a line under Plumbing (GL-26); the irrigation allowance is ONE
  lump at quantity 1 priced at the band factor (`ScopeItem.rate_factor`), so the
  BoQ reads "1 lump, AED 17,600" with the band explained, not "1.6 lump".
- **Textured conditioning image** (`lib/scene/textures.ts`, `renderScene({ textured })`):
  the walkthrough's procedural finish recipes (tile with grout, wood boards,
  stone veining, plaster mottle, at their true repeat lengths) ported to the
  server rasteriser as pure functions of world metres, plus garden families
  (grass blades, mulch, foliage, louvre blades), world-planar UVs and a sun
  shadow map. Paving tiles at 1200 × 600 — the size the BoQ prices. The flat line
  model still decides the manifest (identical ids and depth, asserted) and is
  demoted to a small inset beside a passed render; a substitution ships the
  TEXTURED model, never the flat one.
- **Cameras**: every zone attempts a render (`shouldAttemptRender` no longer
  refuses an unclean camera — a pack of design views is not client-viable);
  standpoints stay INSIDE the plot (G5's over-the-wall views looked across empty
  neighbouring land); a structure is photographed from 1.5–2.1 × its extent back;
  tree canopies are camera obstacles; thin strips (< 1.5 m) get a lower
  frame-share threshold; and `aerialCamera` adds a plan-aligned bird's-eye of the
  whole garden. The scene also carries the NEIGHBOURHOOD — a pale two-storey
  volume beyond every plot edge that has a boundary wall — because a model
  looking over a wall at nothing invents gardens there.
- **One garden, not three** (`lib/scene-render/design-spec.ts`,
  `consistency.ts`): every view shares one deterministic design specification
  (pergola design, paving size and colour, planting palette, counter with grill
  and sink, wall finish, kept trees), which also replaces the style's own feature
  list — Desert Modern's "linear corten planters" and "sandstone paving" argued
  with the design and appeared in view after view. After the renders, a
  consistency gate compares each passed view against the ANCHOR view (the first
  of pergola → aerial → whole-garden → biggest clean zone to pass its own gate);
  a view that differs on pergola design, paving, planting or wall finish does not
  enter the pack as a render. **Conditioning on the anchor IMAGE was tried and
  rejected on measurement**: it moved the client garden from 10/13 to 4/13 passes
  (a second image pulls composition, exactly as the G4b style-image calibration
  found), so the shared reference is the text and the gate enforces the rest.
- **Photo pairs**: the gate adds `house_side_matches` (a mirrored garden is not a
  render of this one) and `visible_change` 0–3 (an "after" that changes almost
  nothing is not a before/after; below 2 is withheld), the prompt carries the
  design specification, and the pack takes ONE pair per zone.
- **Parity gate** (`lib/documents/parity.ts` + `parity-load.ts`, on every pack
  export and `GET /api/projects/[id]/parity`): every BoQ line maps to an element
  visible on ≥ 1 drawing sheet AND in ≥ 1 render/scene view; every drawn element
  with a cost impact maps to a line. Lines with nothing to point at
  (preliminaries) and elements the rate book absorbs (drainage points) are
  EXEMPT with the reason. It caught the L-bench (priced, drawn, in no view) and
  the 6 boundary wall lights, whose fittings sat inside the wall geometry where
  no camera could see them (they are now mounted on the garden-facing face).
  Runs, fixtures, gates and removed zones carry their ids on the sheets so the
  check can see them; light fittings and taps are `fixture`-category scene
  objects, listed in a manifest but never on the faithfulness gate's list.

**DB step**: `supabase db push` for `039`.

## The design session, applied (garden pilot G5d)

The first working session with a landscape firm (Newspace) came back as a filled
workbook, `data/garden pilot/Arabella_Session_Capture.xlsx`, and a list of pack
comments. `scripts/arabella-session-apply.ts` applies it through the authored
routes — the workbook is unzipped and parsed, never retyped, and every value it
applies is asserted against it.

- **Measurements, honestly** (`lib/client-garden/arabella-session.ts`). Five
  point measures (path from the garden gate 12.2 m, entrance area 5.85 m,
  separator → end-of-pathway wall 6.0 m, front border 5.3 m, door landing
  1.20 × 1.30 m) and two AGGREGATES (grass ≈ 50 m², tiled ≈ 69.4 m²). The refit
  rule: every cross-section the draft designed stays as designed; the measured
  runs set lengths; the aggregates are met by sizing the only surfaces the draft
  never designed — the new entrance area's paved depth and the front lawn patch —
  whose sizes are derived and noted "sized to measured aggregate". Only zones with
  a measured boundary-critical dimension flip to measured (the path, the landing);
  a zone with one measured and one aggregate-sized extent stays derived. The
  2.35 m of the (derived) 26.7 m plot the measured runs do not reach is left
  UNALLOCATED at the garage end and stated — never spread across zones. The plot
  is unmeasured, so the DRAFT watermark stays. The door landing is a typed paving
  zone (priced as paving). `reconciliation()` prints every zone draft → point
  measures → aggregate refit with its driver(s).
- **Staged, so every movement has one cause.** The script regenerates the BoQ
  after each stage — fix → design decision → dimension update → aggregate refit →
  correction — and attributes each stage's diff to that cause
  (`screenshots/garden-pilot/g5d-session.json`). Result: grass 76.9 → 50.0 m²,
  tiled 62.95 → 69.41 m², AED 116,942 → 116,217.
- **Session data** (migration `040`): `boq_corrections` gains `confirm` ("the BoQ
  looks right" is a milestone), `attributed_to` (the firm — on its own
  corrections, nowhere else), `confidence` and `session_ref`; every correction
  also writes a `correction` pilot event, and a Sheet B/C answer applied is a
  `session_decision` event, both tagged `stage: design_session` with the
  instrumentation record ("three-firms #1"). `computePilotMetrics` reports
  corrections by type (confirms included) and per session record. A rate
  correction is captured, never applied to the `actual_transaction` rate book.
- **Built-feature placement gate** (pipeline `g5d-2`). Three passed renders had
  shown three arrangements of the same pergola, counter and bench. The gate now
  asks the vision model WHERE each built feature is (a box) and how many copies
  there are; `judgePlacement` (pure) fails a feature that is not located, moved
  (centre off by more than max(12% of the frame, 60% of its extent)), duplicated,
  or on the wrong side left/right of another feature or a landmark wall (a wall
  seen end-on — the separator). The restyle prompt states the arrangement left
  to right, each exactly once. `assertPackable` refuses a passed render whose
  placement was never checked, so two passed renders cannot disagree
  (`lib/scene-render/__tests__/placement.test.ts`, on the real client scene).
  The model answers in PIXELS about one reply in eight despite being asked for
  percent; `normalisePlacements` converts with the candidate's real size
  (`imageSize`, from the header) before judging — g5d-1 had failed correct renders
  as "moved" on exactly that.
- **A measure that cannot be mapped is held, not applied.** The front / street
  border measured 5.3 m; mapped onto the front garden it left the drive ~1.0 m
  wide, so the measurement and the type plan disagree about which edge "the front
  border" is. It is recorded in `UNMAPPED_MEASURES` with the reason, printed on the
  pack's Design assumptions page, and logged as pilot friction ("a measured figure
  that cannot be mapped"); the front garden keeps its type-plan derived footprint
  (2.2 × 4.0 m, drive 4.1 m) and the other six measures stand. The grass aggregate
  is then met over the zones it can cover — rear + side = 47.82 m² against ≈ 50 —
  and the front garden's 6.40 m² is stated as outside it rather than quietly
  resized to make the arithmetic close (AED 116,217 → 116,679).
- **A render is stale only when its own view changed** (`lib/scene/view-hash.ts`).
  The cache key carries the whole scene's hash, so a change at one end of the plot
  invalidated all 30 renders of it and made a small amendment expensive enough to
  discourage making it. A render is now carried forward when the camera's manifest
  is IDENTICAL to the one it was gated against and every object whose geometry
  changed is at least 12 m from the lens (so it cannot have cast a shadow into a
  frame it is not in). It fails closed — no fingerprint, no exact manifest match,
  no reuse — and the carried-forward row records `reused_from` with the reasons,
  so no pack shows an image nobody can trace. Reverting the front border re-rendered
  the views that see the front garden or the garage's notch and reused the rest.
- **Photo pairs** (`g5d-1`): a structure replaced in place carries what the plan
  builds inside it — the BBQ counter under the pergola is an `add` item that must
  show, or the gate reports it out of crop and the caption says so.
- **Surroundings from the graph** (`plan_context.spec.beyond` = neighbour |
  street | open). The G5c neighbourhood volume stood behind every walled edge,
  and the aerial painted a neighbouring villa over the client's own entrance.
  Where the plan declares what is beyond a wall, the scene follows it (only a
  wall that RUNS along an edge speaks for it); undeclared gardens are unchanged.
  The design specification names the surroundings and the gate; the aerial
  camera prefers a view that shows the garden entrance.
- **BoQ**: drainage points on L-402 are a QS-to-price line (GL-28, rate 0 — the
  reference contract absorbed them at no charge, so a visible line invents no
  cost; the double-count guard ignores rate-0 lines). The parity gate now counts
  overlay SYMBOLS (lights, boundary lights, taps, drainage) against their line's
  quantity. An **indicative delivery programme** (`lib/boq/programme.ts`) is
  stored on the BoQ — the reference 90 days scaled by value, clamped 0.5–1.5×,
  phases split by the value of their work, labelled indicative / derived — and
  shown on the BoQ page and PDF. It is never a line.
- **Pack fixes**: body/caption sizes raised (render pack ≥ 3.1 mm, BoQ PDF ≥ 2.6
  mm; paragraphs re-wrap); the facts band sits below the tallest caption; a view
  that is not a passed render carries ONE neutral line ("Visualisation pending —
  …, see L-100 / L-401") — the gate's findings stay in the run report; an evening
  that did not pass is DROPPED (the day view says "lighting as designed, see
  L-401"); a zone whose own camera failed shows the passed view that shows it best
  (a structure ≥ 12% of the frame), captioned with where it is from. L-201 prints
  "Ground (external works)"; the pergola elevation falls back to the scene's
  corner posts, and the client pergola now carries its four posts.
- **Pricing question for the firm's written review** (not changed): the reference
  pergola line (E1.1, "3.5 × 3.5 × 2.8 m, alum 150 × 150 structure, 8 downlights,
  coating") names no slab, and the G3 dry-run showed the paving under it was
  bought separately (66.24 m² of tile against 64.27 m² drawn INCLUDING the
  footprint) — so the rate excludes its base and the 12.25 m² stays in the paving
  lines. Were it included, the deduction would be 12.25 × (105.6 + 70.4 + 128.1) =
  AED 3,725 before contingency and VAT.

**DB step**: `supabase db push` for `040`.

## Rate resolution + private firm rate books (T1.0 / L1)

**One resolution order for every pricing path** (`lib/rates/tiers.ts`, first
answer wins): **1** `firm_private` (the project's firm's own entry) → **2**
`firm_correction` (that firm's market_fair correction, *explicitly promoted*) →
**3** `reference` (`rate_book`, `actual_transaction`) → **4** the interior R-xx
fallbacks: `catalog` (pricing_skus tier pick) / `allowance` / `labour_book` →
**5** `indicative` (`rate_book` seed/indicative rows, only when 4 cannot
answer). `unpriced` (a garden QS-to-price line at 0) and `selection` (a D1
accessory laid over whichever tier answered) complete the vocabulary. Every
resolved line carries **`rate_tier`**.

- **Hooks** — at the accessory layer: `RateResolver.resolveBase`
  (`lib/boq/rates.ts`), the garden `rate()` / `priceGardenTakeoff`
  (`lib/boq/garden-takeoff.ts`, via `withFirmOverlay`), and — since T3b — the
  six P4 element sections (Demolition, Plaster, Floor / Wall Finishes,
  Ceilings, Painting), rebuilt from the element take-off **whenever the
  plan yields one — no longer behind `VIEWER_3D_ENABLED` (U7: the flag had
  decided a pricing path; with it off a firm's `wall_plaster` rate was
  ignored)**: `elementPricer(firm, tier)` → `applyElementMapping` /
  `roomRollup`. Firm tiers answer there; otherwise the `WORK_ITEM_DEF`
  constant (byte-identical, `element-mapping.golden.json`). The reference
  book is deliberately NOT consulted for element keys — production
  `rate_book` holds what-if grade cells under the same keys. A firm prices
  plaster on this path as `wall_plaster` (the element keys are in the
  firm-entry vocabulary). No interior `rate_book`
  row shares a key with a `RATE_RULES` item today, so tier 3 answers only for
  garden keys and every pre-L1 BoQ regenerates unchanged
  (`lib/boq/__tests__/pricing-golden.test.ts` + `scripts/boq-regen-check.mjs`).
- **T1.0** moved the landscape rates into `rate_book` first (see G2 above):
  an overlay needs a store to shadow.
- **Firms** (migration `041`): `firms` (name, `private` default true,
  `created_by`), `firm_rate_books` (one per firm, `ohp_pct` 0–50),
  `firm_rate_entries` (`item_key`, `grade` null = all grades, `unit`,
  `rate_aed`, `kind` labour|supply|supply_and_install|lump, `origin`
  firm_entry|promoted_correction, `correction_id`), `projects.firm_id`,
  `boq_corrections.firm_id` / `promoted_at` / `promoted_entry_id`. 041
  backfilled one firm per distinct `attributed_to` (Newspace) and created no
  books. Entries are validated against the take-off vocabulary
  (`lib/firms/vocabulary.ts`: known key, its unit, a kind that cannot change
  what the line contains).
- **Isolation.** `FirmOverlay.forProject` refuses any book or entry that is not
  the project's firm's (`FirmIsolationError`); every store query is scoped by
  `firm_id` (another firm's entry is 404 through your path); a firm entry in
  the wrong unit throws at pricing time.
- **Ownership (U1, migration `043`).** `firm_members (firm_id, user_id)` — no
  teams, no roles: creating a firm makes you a member, and membership is
  required for every `/api/firms/:id/*` route, `GET /api/firms` (the caller's
  firms only), attaching/detaching a firm on a project, and attributing a
  correction to a firm. `requireFirm(db, firmId, caller)` answers **401
  `unauthenticated` → 404 `firm_not_found` → 403 `not_a_member`** in that
  order; the caller comes from `lib/auth/caller.ts` (`Authorization: Bearer
  <Supabase JWT>` for scripts, the magic-link cookie session for the browser)
  and never from a request body. Enforced in application code because the
  routes run on the service role, which RLS never sees. Scripts authenticate
  through `scripts/lib/dev-auth.mjs` (a real dev account's real session — no
  bypass); `scripts/firm-member-add.mjs` grants membership with the service
  role. Sign-out exists (`app/_actions/sign-out.ts`, top bar). Since H1 every
  other route needs a signed-in caller too (see "Route auth" below), and since
  H5 every project route and page needs project membership.
- **Identity.** A firm's rate reaches a line as the constant
  "contractor rate book" — never its name. Pricing paths read `rate_book`
  only through `REFERENCE_COLUMNS` (no `source`, no `internal_ref`) and
  `toReferenceRow` copies whitelisted fields only. Nothing under `app/` or
  `lib/` writes `rate_book` (static test).
- **Corrections** stay recorded-never-applied until
  `POST /api/firms/:firmId/promote` (own firm only, `rate` type with an
  item_key, once). `POST /api/boq-corrections` now normalises `attributed_to`
  (or takes `firm_id`).
- **OH&P** (`lib/rates/ohp.ts`): applied LAST at assembly as `ohp_pct` /
  `ohp_aed` — subtotal → + OH&P → contingency on both → VAT → total. Never in
  a rate. Shown as its own row on the BoQ page and PDF. 0% / no firm adds no
  field.
- **Routes**: `GET/POST /api/firms`, `GET/PATCH/DELETE /api/firms/:firmId`
  (PATCH takes `status` too), `GET/POST /api/firms/:firmId/rates`,
  `PATCH/DELETE /api/firms/:firmId/rates/:entryId`,
  `POST /api/firms/:firmId/promote`, `PATCH /api/projects/:id { firm_id }`,
  and **`GET /api/rate-vocabulary`** (U2, signed-in): every priceable
  `item_key` with label, unit, section, kinds and what an entry shadows
  (`market` reference rate for garden keys; `builtin` interior pricing
  otherwise — interior keys have no single reference figure).
- **UI (U2)**: `/firms` (the caller's firms, create) and `/firms/:firmId`
  (the book: OH&P, status, entries beside what they shadow). The client
  validates with `lib/firms/vocabulary-client.ts` — the same four rules as
  `validateEntry`, held equal by test — and fetches only this firm's routes
  and the vocabulary (`page-privacy.test.ts`).
- **Book status (U2, migration `044`)**: `firm_rate_books.status` draft |
  reviewed + `reviewed_at`. Marked reviewed by a member; any content change
  (entry, OH&P, promotion, quote accept) returns it to draft. Resolution
  ignores it; the export gate (U5) reads it.
- **Quote import (L2 / U3, migration `045`)** — `lib/quotes/`. Template
  (`GET /api/firms/:id/quotes/template`, xlsx: Quote · How to fill ·
  Vocabulary) → upload (direct to Storage, then `POST /api/firms/:id/quotes` `{ path, … }` + the quote's
  terms: supplier label/role, ref, dates, currency, VAT treatment, net|list,
  discount) → `firm_quotes` record + one `firm_quote_lines` row per sheet row
  with a **suggested** item_key (`lib/quotes/match.ts`, idf-weighted; never
  auto-confirmed) and the rate derived to net-excl-VAT AED
  (`lib/quotes/derive.ts`, arithmetic shown) → review (`/firms/:id/quotes/:q`;
  confirm/reject per line, "confirm suggestions ≥ 0.5" as one explicit act; a
  line is `matched` only if the entry it would create passes `validateEntry`)
  → `accept` creates entries with **`origin = 'quote_import'` + `quote_id`**.
  **Additive by construction**: no delete anywhere in `lib/quotes` (static
  test); an earlier quote_import entry for the same key/grade is
  **superseded** (`superseded_at` / `superseded_by`, kept), the unique index
  is partial on active rows, and `loadFirmBook` / `listEntries` read active
  rows only. A re-import of the same reference (or same file sha256) is a new
  **version** naming the one it replaces. Held lines (no match, foreign
  currency, unreadable rate, VAT unknown) stay on the record with a reason.
  Overlay precedence within tier 1: typed `firm_entry` > `quote_import`; the
  line label is `FIRM_QUOTE_LABEL`. xlsx read/write is `lib/quotes/xlsx.ts`
  on `fflate` (no SheetJS). One synthetic fixture only (`docs/AUTH.md` →
  Quotes). **U6's migration is 046.**
- **`generate-boq { dry_run: true }`** assembles the BoQ through the real
  pipeline and writes nothing (no boqs row, takeoff_items or pilot event).
  `scripts/firm-overlay-check.mjs [port]` runs the whole L1 flow live on scratch
  firms + the isolation stand-in and cleans up.

**DB step**: `npm run db:push` for `041`.

## Revision diff, approval trail, promotion history (U4 / L3)

- **Every `generate-boq` is a revision** (a `boqs` row; none is ever deleted).
  `lib/boq/revisions.ts` reads them: `listRevisions` (newest first, with
  approval status) and **`buildProjectRevisionDiff`** — ONE object the in-app
  view (`/project/[id]/boq/revisions?from&to`), the JSON route
  (`GET /api/projects/:id/boq-diff?from&to`) and the PDF (`&format=pdf`,
  `lib/documents/revision-diff-pdf.ts`) all render. Signed-in callers only.
- **Stable line identity** (`lib/boq/line-identity.ts`): `item_key` (now
  written on every engine + garden line — the one additive field the pricing
  goldens strip) → the item the rule id / description names (`lineItemKey`,
  shared with the provenance popover, so a pre-U4 BoQ keys the same) → the
  rule id without the engine's rate-note suffix (`R-12/Catalogue` → `R-12`,
  the old change-report key, which moved with the tier) → description; repeats
  numbered `#n`. **Never REF codes** (positional). `lib/pilot/change-report.ts`
  keys on it too.
- **`lib/boq/revision-diff.ts`** (pure): classes quantity | rate | both | added
  | removed, Δ qty / rate / total, the summary chain old → new, and a **cause
  only where a record names the line** — a `boq_corrections` row, a
  `firm_rate_entries` row of the project's firm (created or retired), or a
  pilot event in the (from, to] window (`lib/boq/revision-causes.ts`). A line
  with none says "no cause recorded"; it is never given a story. Reproduces
  the Arabella G5d change report stage by stage (fixture
  `lib/boq/__fixtures__/arabella-g5d-revisions.json`, exported from dev; the
  live check diffs the real rows).
- **Approvals** (`boq_approvals`, migration 046; `lib/boq/approvals.ts`):
  append-only. `firm` = a signed-in MEMBER of the project's firm (any signed-in
  account when the project has no firm); `client` = an EVENT the firm records
  with the name + date the client gave. Labels never carry a member identity
  ("Approved by the firm · date", "Client approval recorded by the firm ·
  name · date"). Shown on the hub (`components/boq/ApprovalsCard`), the
  revisions page and the diff PDF. `GET/POST /api/projects/:id/boq-approvals`.
- **Promotion supersede-with-history** (046): `promote_correction()` is ONE SQL
  transaction — lock the correction, refuse (not this firm's / not a rate /
  already promoted), retire the active promotion for the same key/grade
  (`superseded_at` / `superseded_by` / `retired_by` / `retire_reason` — kept),
  insert (`created_by`), link the correction, return the book to draft.
  **Retire, never delete**: `DELETE /rates/:id` sets the retire columns and,
  for a promotion, clears the correction's `promoted_at` so it is
  re-promotable; no code path deletes a `firm_rate_entries` row (static
  test). **Origin guard**: a promoted or imported rate's figures are locked
  (409 `entry_locked`; only the note may change). **A figure edit on a typed
  entry supersedes too (UV)**: `PATCH` with a changed rate / unit / kind /
  grade retires the old row (`retire_reason: "edited by a member — was N per
  unit"`, `superseded_by`), inserts the new one (a new id — the editor
  reloads) and writes a `rate_book_change` event with `action: "edit"`; a
  note-only patch stays in place. Editing in place had left the revision
  diff with no cause and the history with no old figure. `loadFirmBook` orders
  `created_at desc, id`. Trail: `GET /api/firms/:id/rates/history?item_key=`
  (members; actor e-mails resolved for the firm's own eyes) and the editor's
  history row.
- **Not a pack document**: the diff PDF is firm-facing (sign-in + an identity
  scan of its printed pages), exempt from the T5 job guard by name in
  `ungated-paths.test.ts`. Provenance popovers on the diff use each stored
  revision's own chain; the Δ figure's chain lists the recorded causes
  (`ChainStepKind` gains `cause`).
- **Checks**: `scripts/revision-diff-check.mjs [port]` (Arabella read-only
  reproduction + PDF + identity scan; approvals and promotion history on
  scratch state, cleaned up).

## Client-ready proposal with the reference-basis gate (L4)

A branded proposal a firm sends ITS OWN client — the firm's rates, its OH&P,
its logo. Built on the T5 path, never beside it.

- **Branding** (migration 047: `firms.display_name`, `logo_path`,
  `terms_text`; `lib/firms/branding.ts`): the firm chooses what its client
  sees. `GET/PATCH/POST /api/firms/:id/branding` (members; POST = `{ path }` of a
  direct `logo` upload (H9), PNG/JPG into `plan-uploads` at `firms/<id>/…`), the
  "Proposal branding" panel on `/firms/:id`. `brand` = display name, else
  the registered name.
- **The document** `lib/documents/proposal.ts` (pure pages) +
  `proposal-pdf.ts` + `GET /api/projects/:id/proposal` (a DOCUMENT route:
  behind `guardDocumentRoute`, in `DOCUMENT_ROUTES`): cover (logo, brand,
  project, contract sum in the derived convention + D4 excludes, draft
  stamp), scope summary, the BoQ at the firm's resolved rates with **OH&P as
  its own row**, terms (the firm's words, verbatim), indicative programme.
  **No rate provenance** reaches the client: no source labels, tiers or QS
  marks, and a description's provenance aside — "(no reference rate — QS to
  price)" — is dropped (`clientDescription`). RennovAIte is only the footer
  mark `PREPARED_WITH_MARK`. The draft watermark carries over to every page.
- **Reference-basis gate** (`lib/documents/reference-basis.ts`,
  `proposal-gate.ts`): `referenceBasisOf(boq)` counts lines by the tier that
  answered them (stored `rate_tier`, or inferred exactly as the provenance
  popover does for a pre-L1 BoQ) — firm_private / firm_correction are the
  firm's, QS-to-price lines are `unpriced`, everything else is the
  **reference**. Any BoQ with a reference line shows the in-app banner
  `REFERENCE_BASIS_BANNER` on the BoQ page (`ReferenceBasisNotice`). A
  client proposal exports only when: every line is the firm's own
  (`firm_basis`) · the firm's book is `reviewed` (U2, `book_reviewed`) · the
  firm **accepted the reference basis for THIS BoQ revision** (`accepted` —
  `reference_basis_acceptances`, 047, append-only, by a member of the
  project's firm via `POST /api/projects/:id/reference-basis`). An
  acceptance covers a revision by **pricing fingerprint**
  (`boqPricingFingerprint`: every line's description, qty, unit, rate,
  total + the summary chain): a pack export regenerates the BoQ before its
  gate, and an identical regeneration is the basis the firm accepted; any
  moved line is a new basis and needs a new acceptance. Otherwise the
  proposal route answers **409
  `proposal_not_ready`** and the Export pack checklist blocks on
  `reference_basis` with the fix link to the BoQ page's accept control. The
  fallback to market rates is a stated choice, never a silent default.
- **In the pack**: `PackExportOptions.proposal` (the "Include the client
  proposal" toggle, shown only when the project has a firm; `?proposal=1`
  re-checks the gate with the proposal items); the run adds
  `<name>-proposal.pdf` and the proposal checks in `checks.ts` (brand on the
  cover, prepared-with mark on every page, no provenance words, contract sum
  = BoQ total, OH&P row, draft stamp, terms, programme, basis was a stated
  choice) and scans the proposal pages in the identity leak check. The
  scanner now decodes XML entities and does not require a word boundary
  after a name ending in punctuation ("X & Co.").
- **Identity composes**: the firm's own name is allowed on its own project
  (`withheldFirmNames` excludes it); every other firm, contractor and
  reference-project identity is still withheld and scanned for. A proposal
  that would print one is refused (500 `identity_leak`), never served.
- **Checks**: `scripts/proposal-export-check.mjs [port]` (pack config) —
  branding CRUD, refusal path (route 409, gate blocked, non-member 403),
  acceptance, the document's printed content, the full pack with the
  proposal; scratch state only, restored.

## Per-firm commercial instrumentation + milestone report (L5 / U6)

- **Schema (migration 048)**: `pilot_events` gains `firm_id`, `actor`
  (the signed-in account; null = a script or our own run — the distinction
  the pilot turns on; since H1 a script outside a pack job calls as
  `dev-scripts+pipeline@rennovaite.local`, so its events name that account), `session_ref`, `duration_ms`, `stage` (a column now;
  `detail.stage` stays for old readers), `project_id` nullable (a rate-book
  change is a firm event); kinds gain `boq_viewed`, `support_touch`,
  `rate_book_change`, `approval_recorded`, `basis_accepted`; `pack_exports`
  gains `actor`. Additive: no row changed by DDL. **049** dropped 048's
  scope check (project OR firm not null): with `firm_id` set null on firm
  deletion it made any firm with a rate-book event undeletable (UV found
  it). A firm-level event outlives its firm with both keys null; rollups
  ignore it. The three document routes (BoQ PDF, proposal, render pack)
  stamp their `pack_exported` event with the pack job's actor
  (`packJobActor`, `lib/documents/pack-export/guard.ts`), so a member's
  Export pack is the firm's release, not "our export".
- **Writer** `recordPilotEvent(db, projectId | null, kind, detail, opts)`
  (`lib/pilot/events.ts`): **every project records** (the G5 authored-plan
  guard is gone — interior firm projects were invisible), the firm is
  resolved from the project unless given, and a pre-048 table gets the old
  shape for the old kinds. Writers now pass the actor: generate-boq (+ the
  generation's duration; interior BoQs are `full` by construction),
  corrections (+ firm + session), the pilot-events route (friction, session
  decisions, **support touches** — `POST {kind:"support_touch", channel,
  note}`; the GARDEN_PILOT gate is lifted), approvals, basis acceptances, the
  firm store (entry / promote / retire) and quote accept (`rate_book_change`
  on the FIRM, no project), the BoQ page (`boq_viewed`, one per actor per
  10 min — `lib/pilot/views.ts`), pack-export POST (`pack_exports.actor`).
  `components/app/SupportTouch.tsx` ("Ask for help") sits on the BoQ page.
- **Metrics** `lib/pilot/metrics.ts` (pure): per project — time to first
  BoQ (project start → first pilot-stage generation), time to first FULL
  BoQ, **checking time** (first generation → first release: a passed app
  pack, or a BoQ PDF / proposal handed over), corrections by type, by POMI
  section (`sectionOfItem` over the garden + interior vocabularies) and
  **where they landed** (promoted into the book vs left on the project),
  support touches by channel, reviews (`boq_viewed`, distinct actors),
  approvals / acceptances, packs; per firm — its projects (by
  `projects.firm_id` OR the single firm its corrections name), sums, medians,
  rate-book changes, and **gaps in words** (no actor, no release, no firm,
  scripted release). Not the pilot: stages `verification`, `reference_pack`.
  `GET /api/pilot-events?firm_id=` (signed in) returns the rollup;
  `?project_id=` keeps the G5 per-project metrics.
- **Report** `scripts/three-firms-report.ts [--json] [--firm <id>]` prints
  the evidence table per firm / project with the gaps beside the numbers;
  projects with events and no firm are listed, never dropped.
- **Backfill** `scripts/backfill-pilot-events.ts [--apply]`
  (`lib/pilot/backfill.ts`, pure, idempotent): recovers `stage` from
  detail, firm + session from a correction or a session record, firm from
  `projects.firm_id`. **Cannot recover, and prints so**: actor (no route
  knew the caller before 043; every pre-048 row stays null — the firm's own
  time is not separable from a script's or ours), durations, reviews /
  support / rate-book history, a firm for scripted events, and
  `projects.firm_id` for Arabella (a pricing + identity decision). Applied
  on dev 2026-09-28: 288 of 311 rows patched, 0 on the second run.
- **Checks**: `scripts/pilot-events-check.mjs [port]` (writers + rollup on
  scratch state).

## Figures + number provenance, identity curation (I4)

- **One formatter, one component.** `lib/format/aed.ts` (`formatAed(n, format)`:
  aed · amount · rate · signed · delta · short) replaced 14 local helpers; every
  on-screen figure is `<Figure>` (`components/figures/Figure.tsx`). Don't add a
  local AED formatter.
- **One summary chain.** `lib/boq/totals.ts` `chainTotals` (subtotal → OH&P →
  contingency → VAT). `applyOhp`, the what-if engine (`scenarioTotal`) and the
  vendor picker all use it, so a browser-recomputed figure equals what a
  regenerated BoQ stores (what-if deltas now carry OH&P/contingency/VAT). The
  BoQ view shows Subtotal / OH&P / Contingency / VAT rows like the PDF.
- **Provenance popover.** `lib/provenance/boq.ts` builds, server-side, a chain
  for every figure of a STORED BoQ (any vintage — the tier is inferred when
  `rate_tier` is absent): plan geometry (element names, derived notes,
  "sized to measured aggregate"), resolution tier in the popover's words
  (Private / market_fair / actual_transaction / Fallback — … / Indicative / QS to
  price), a curated source, QS validation, and arithmetic checks. An
  untraceable figure is marked `data-provenance="gap"` and listed in `findings`
  — never given a story. One shared base-ui Popover per page (handle + payload).
- **Identity curation** (`lib/identity/curation.ts`, SERVER-ONLY — it holds the
  names it withholds; a test walks every client import graph). Source
  contractor identities (Atrium, Global Creation, KAME/internal_ref, firm names
  from `firms`) never reach BoQ text: emitted as role labels at source
  (`joinery-aluminum.ts`, R-43 note) and `curateBoq` on every read path (BoQ
  page, vendors, drawings, viewer, BoQ PDF, vendor-options, dry-run). Brands
  that are specifications stay. **T3b rulings** (`NAME_RULINGS`): Laspinas →
  "sanitaryware supplier"; "Villa 94" → "reference project" on every
  firm-facing surface; the vanity slab is "excluded from the client-supplied
  tile package"; RAK stays as a catalogue brand. **Firm names**: a firm's name
  may appear only on its OWN projects (`projects.firm_id`) —
  `loadWithheldNames(sb, projectId)` withholds every other firm, and it is
  applied to BoQ reads, the drawing set (`generateDrawingSet`) and the render
  pack. What-if never selects `rate_book.source` (`RATE_BOOK_LABEL`).
  A firm is withheld by its `name` AND its `display_name`. **Plan notes**
  (`derived_note`, `note`, context `name`, every `spec` string) are curated on
  read too (`lib/plan/curate-notes.ts`): the plan page's garden payload
  (`loadGardenSiteData`) and every row `/api/plan-{elements,context,fixtures,zones}`
  returns. The write side calls `keepStoredText` first, so an editor
  re-sending curated text it read (the fixture inspector re-sends the whole
  spec) never overwrites the stored note. Room `name_en` / `name_ar` are not
  curated in the editor: its save re-sends every name.
  `scripts/document-identity-scan.mjs [port] <ids>` scans every sheet, pack
  page and BoQ page payload of a project.
- **Checks:** `scripts/provenance-check.mjs [port] <ids>` (read-only: figure
  counts, gaps, summary rows, identity scan of the full page payload) and
  `scripts/figure-popover-sweep.mjs <url> [--shots=dir]` (headless Chrome over
  CDP: hovers every figure, one tap, screenshots).
- **D4 — unpriced lines out of the headline.** A QS-to-price line at rate 0
  (`isUnpricedLine`, `lib/documents/boq-derived.ts`) is never silently inside
  a total: `derivedTotal` returns `headline` =
  `≈ AED N* · excludes K lines to be priced` plus the lines, named. The BoQ
  page (headline + Project total row) and the BoQ PDF (title block + grand
  total) print both. A needs_qs line WITH a rate is priced, not excluded.
- **D5 — REF codes.** `lib/boq/refs.ts`: one unique code per section
  (`SECTION_REF_CODES` — PLA / PLB / PRE, not three "P"s), `assignRefs`
  suffixes any in-BoQ collision, so a REF is unique in a BoQ. The screen, the
  PDF (new REF column) and 3D tap-to-inspect links use the same codes. Old
  codes: `legacyRef` reproduces them, `resolveRef` accepts one in a deep link
  only when unambiguous, and the migration table is the PDF's "REF changes"
  page and `GET /api/projects/:id/boq-refs[?format=csv]`.
- **What-if basis labels.** The scenario TOTAL runs the shared chain; per-grade
  and per-line deltas and the accessory re-pricing do not. Displays say which
  (`WHATIF_INCL_MARKUPS` / `WHATIF_BEFORE_MARKUPS`, `lib/whatif/engine.ts`)
  until they are applied consistently.

## One gated pack export, in the app and on the CLI (T5)

The pilot's script assembled and checked the client pack; the UI's own links
(drawing set, render pack, BoQ PDF) went straight to the routes — no consistency
anchors, no photo pairs, no printed-content or identity-leak checks, no
display-name check, outputs not saved together. There is now ONE path.

- **`lib/documents/pack-export/run.ts`** is the export: BoQ regeneration → the
  export gate → renders (anchor first, faithfulness + consistency) → before/after
  pairs → the documents through their routes → the printed-content checks
  (`checks.ts`, the script's assertions made generic) → outputs + manifest saved
  together. `scripts/garden-draft-pack.ts` and the in-app **Export pack** action
  both call it and differ ONLY in transport (which origin the routes are on) and
  sink (a local folder, or the private `packs` bucket). Verified on the same
  project state: the CLI's and the button's three PDFs are **byte-identical**
  (equal sha256) — PDF dates are pinned to the UTC day (`lib/documents/pdf-date.ts`)
  so a run is reproducible.
- **No ungated output path.** Every document route calls `guardDocumentRoute`,
  which serves a document only to a RUNNING `pack_exports` job (migration 042,
  header `x-pack-export-job`, 3 h TTL, project-scoped) — and, since H1, only to
  a signed-in caller: the transport carries the session of whoever started the
  job (the in-app job forwards the member's; the CLI uses `devFetch`). A browser navigation is
  redirected to the Export pack panel; anything else gets `403 use_pack_export`.
  The design-lock archive (`lib/drawings/persist.ts`) no longer mints year-long
  signed URLs — it records storage paths. `ungated-paths.test.ts` scans the app
  for a direct link to a document route and for a route that produces a PDF
  without the guard. Internal verification scripts READ documents through
  `scripts/lib/verification-job.mjs`, which opens a job and releases nothing.
- **The gate is a checklist, not a 409.** `checklist.ts` names what is open —
  untyped counters, undecided existing items, a stale BoQ, unpriced drawn scope,
  lines nothing shows, overlay counts, and a working name — with the page to fix
  each on. A blocked run stops BEFORE producing a document; a run whose printed
  checks fail releases nothing but its manifest.
- **The gate is SCOPE-AWARE** (the T4 finding): interior rooms are priced by the
  interior take-off's area-driven rules, so `parity.interiorRows` passes a room
  the element lines name, EXEMPTS the rest when interior work is priced, and
  fails only when rooms are drawn and no interior work is priced at all. Before
  this every interior room read as "drawn with cost impact, no BoQ line" and
  every interior BoQ PDF 409'd.
- **One visibility rule** fixes the 404 bug: `packExportEnabled()` is
  `PACK_EXPORT_ENABLED && DRAWINGS_ENABLED`, and it governs the button AND the
  routes — the BoQ PDF button used to show on any garden BoQ while its route
  required `DRAWINGS_ENABLED`. Flag off = the action is absent from both pages,
  the prose does not mention it, and every document route 404s (`/boq-pdf?format=json`,
  which carries no document content, stays open).
- **Options**: renders `full | cached | skip` (`cached` spends no render —
  `cache_only` on the scene and photo-pair routes returns `not_cached`), pairs,
  `regenerateBoq`, `boqPdf` (false only for the CLI reference pack: negotiated
  prices never leave as a document), and `stage` for the pilot events the run
  causes. A CLI `--stage verification` run never overwrites the tracked pilot
  records.
- **Production flags stay OFF** — this ships dev-side pending the post-pilot
  deployment decision.

**DB step**: `npm run db:manifest` + `npm run db:push` for
`20260101004200_pack_exports.sql` (the `pack_exports` table and the private
`packs` bucket).

## Pricing never depends on a flag (H3)

For a fixed project state no combination of feature flags changes a BoQ.
Flags gate UI; they do not price. U7 took the viewer flag out of the element
sections; H3 took `OVERLAYS_ENABLED` out of the P2 overlay feed — a flag-off
deployment had silently dropped Electrical Installations and Plumbing &
Sanitary from every BoQ with fixtures (Mudon: ~AED 8,380 + ~6,440).

- **One assembly**: `lib/boq/assemble.ts` — `loadBoqInputs` (both engine
  paths) + `priceDeterministicBoq`, moved out of the route verbatim. The route,
  the invariance test and read-only scripts all price through it.
- **Invariance test** `lib/boq/__tests__/flag-invariance.test.ts`: a static
  proof (the runtime import graph of `assemble.ts` reads no feature flag; the
  flag list must cover every `*_ENABLED`-style env the app reads; KG grounding
  stays on the legacy LLM path) plus all 2^12 flag combinations over a fixed
  Mudon state with fixtures → one BoQ, Electrical + Plumbing priced. A new flag
  read anywhere in the pricing graph fails the suite. `BOQ_ENGINE` is an engine
  selector, not a feature flag.
- **Measured, read-only**: `scripts/boq-dry-run-diff.ts <project> [--boq id]`
  regenerates IN-PROCESS under current code (no server, no session, nothing
  written — a degraded assembly voids the run) and diffs against a stored
  revision: price moves line by line (revision-diff identity) + every
  non-price field change. Needs `node --experimental-transform-types --import
  ./scripts/_alias-hook.mjs` (`lib/boq/rates.ts` uses a parameter property).
  Prod Mudon, 5 Sep BoQ (AED 723,282) → **738,529 (+15,247)**: the only price
  movement is the four S6-pre lines added on 8 Sep (`4383c34`: cove LED supply
  2,745 · vanity counter slab 4,350 · frameless shower glass 4,400 · bathroom
  mirrors 1,950 = subtotal +13,445, then contingency + VAT). Everything else is
  additive or text: `item_key` / `rate_tier` added, rule ids on the 15
  joinery/aluminium lines (identity only — quantities, rates and totals equal),
  supplier names emitted as role labels at source. Electrical + Plumbing
  unchanged.

## Project ownership + invite-only sign-up (H5)

Route auth stage 2: a session is not an entitlement. Migration **050**
`project_members (project_id, user_id)` mirrors `firm_members`; creating a
project (`/api/upload`, `/api/draw-plan`) makes you its member; every
project-scoped route and page requires membership. Existing projects were
backfilled to Abdallah's account (by e-mail, where the account exists — prod
yes, dev no: run `node scripts/project-member-add.mjs <email> --all` once it
does).

- **One resolver** `lib/projects/access.ts → authorizeProject(db, caller, refs)`
  (routes: `lib/projects/http.ts → projectAccess`). It takes EVERY id a request
  carries — project, plan, room, render, prediction, asset, BoQ, fixture,
  element, opening, context, moodboard item — resolves each to its project, and
  answers 401 → 404 `<kind>_not_found` → 403 `not_a_project_member` → 400
  `refs_span_projects`. Checking only the NAMED project would let a caller pass
  their own project id beside someone else's room or render.
- **Routes**: every handler outside `NON_PROJECT_ROUTE_FILES` (firm-scoped
  routes and the vocabulary, in `lib/auth/access.ts`, each with a reason) calls
  `projectAccess` with all its ids, awaiting nothing but caller, params and body
  before it (`route-auth.test.ts` scans it). pilot-events is dual: a project
  event needs the project, a firm event / the firm rollup needs the firm.
  **A new project route must pass every id it touches.**
- **Pages**: `proxy.ts` checks membership for `/project/<id>/…` before any page
  code runs (a page renders in PARALLEL with its layout, so a layout-only check
  let a non-member's visit run the page's reads and side effects — the BoQ page
  recorded a view). A non-member gets a plain 404. `app/project/[id]/layout.tsx`
  checks again; the dashboard lists only member projects.
- **Firm attach** (`PATCH /api/projects/:id { firm_id }`) needs membership of
  BOTH the project and the firm. Regenerating (H4) = the project's members.
- **Invite-only sign-up** (`lib/auth/signup.ts`): the magic link stays; account
  CREATION needs `AUTH_SIGNUP_ALLOWLIST` (exact addresses or a local-part
  pattern like `dev-scripts+*@rennovaite.local`; unset = nobody new). The
  sign-in action creates an invited address's account itself and never lets
  Supabase create one (`shouldCreateUser: false`); anyone else sees the same
  invite-only notice whether or not their address has an account. **Supabase's
  own "Allow new users to sign up" must be OFF** on each project, or the public
  anon key can still open accounts directly.
- **Scripts**: dev accounts act on projects as members — `grantProjectMembership`
  (+ `revoke()`) or `devFetch(who, { projects })` / `.grant(ids)` in
  `scripts/lib/dev-auth.mjs` (service role, the operator act; no route bypass).
  Checks revoke what they granted; the pipeline account's grants persist.
- **Live**: `node scripts/project-isolation-sweep.mjs [port]` — two fresh
  accounts; every project handler (from the filesystem) as the intruder → 403,
  mixed-reference attacks → 403, every project page → 404, firm attach both
  ways, the owner's rows byte-identical after. At H5: 74/74, 13/13 mixed, 13/13
  pages.
- **DB step**: `npm run db:push` for 050 **before** deploying the code — the
  membership read fails closed (500 `migration_required`) without the table.

## BoQ numeric integrity + payload identity (H7)

Every figure a QS sees multiplies out from the figures beside it.

- **One rounding module** `lib/boq/money.ts`: `money2` (2 dp, half away from
  zero, robust to binary representation), `lineTotal(qty, rate) =
  money2(qty × money2(rate))`, `sumMoney` (exact in integer fils). Every
  resolved rate is 2 dp **at resolution** (`RateResolver.resolve` /
  `resolveDefault`, `elementPricer`, the garden book pick, overlays, joinery,
  the LLM path, furniture); every producer's total is `lineTotal`. GL-14
  pergola: book net 1,366.6928 (list × 0.88) → 1,366.69; 12.25 × 1,366.69 =
  16,741.95 (was 16,741.99).
- **The chain to the fils** (`lib/boq/totals.ts`): OH&P, contingency and VAT
  each rounded ONCE to 2 dp; grand = subtotal + OH&P + contingency + VAT
  exactly. **OH&P sits between the subtotal and contingency** (contingency and
  VAT are both charged on it). **`rechain(boq)`** is the one way any producer
  puts a document back together (canonical order, section totals, subtotal,
  chain, OH&P kept if present) — the six copies of the chain arithmetic are gone.
- **THE section order** `lib/boq/section-order.ts` (`CANONICAL_SECTION_ORDER`,
  Preliminaries first; `SECTION_ORDER` in rules.ts derives from it). Applied by
  `rechain` to every stored document and by `sortSections` on read in the BoQ
  page, BoQ PDF, proposal, revision diff and the pricing fingerprint — so a
  pre-H7 revision displays in the same order. Stable, whole sections only: REF
  codes are per section, so none moves (asserted).
- **Display**: `formatAed(n, "money")` (16,741.95) for line rates, line totals
  and the summary rows on the page, PDF and proposal; a non-draft total prints
  to the fils; a draft keeps its labelled "≈ AED N*" headline with the exact
  chain beside it. `"money-delta"` for fils changes.
- **Diff cause "H7 rounding"** (`isH7Rounding`, lib/boq/revision-diff.ts): only
  when the RECORDS say so — the revisions' stored `engine.version` straddle
  **0.3.0** (`ENGINE_VERSION`), the quantity is unchanged, the new rate is the
  old one to 2 dp, the new total is qty × rate, and the move is within rounding
  size. A total-only move is class `total` ("total moved (rounding)"), no
  longer misfiled as `rate`.
- **Budget**: a budget renders only when the CLIENT entered one
  (`projects.budget_aed`) on a project with **no firm**. The old AED 850,000
  was a platform default (`FALLBACK_BUDGET_AED`, BoQ + vendors pages; the intake
  slider's initial value is never sent) and is gone from every "your budget";
  the hub card says "No client budget recorded" instead of "of AED 0"; the style
  page calls 850k a baseline.
- **Payload identity** (with #88/#89): `plan-openings` curates its responses
  too; `scripts/read-path-leak-scan.ts` pins process.env to its target (on dev
  the plan + catalogue checks had degraded to empty); `scripts/document-identity-scan.mjs`
  also scans the plan page, the hub and every plan-editor API response.
- **Acceptance**: `lib/boq/__tests__/numeric-integrity.test.ts` (every line of
  every fixture BoQ, the chain, the order, REF stability, 5,000 random cases).
  Measured (dry-run, read-only): Arabella 116,679.07 → **116,679.56** (1 line,
  the pergola −0.04); dev demo villa 498,824 → 498,823.06 (5 lines); prod Mudon
  vs 5 Sep: 3 rounding lines (−0.36) beside H3's S6-pre lines, grand 738,529.00.

## Rate-book integrity — magnitude hold + one active entry per item (H8)

Found in the J0 export of the synthetic test firm; both would have hit firm #2
on day one.

- **Magnitude / unit hold** (`lib/firms/magnitude.ts`, pure): a firm rate is
  checked against the figure it SHADOWS (`lib/firms/shadow-rate.ts`: the market
  reference for a garden key; the `WORK_ITEM_DEF` constant for a P4 element key;
  the allowance for an interior allowance rule; catalogue / labour-book keys have
  no single figure and are not checked). Outside **0.33–3×** it is HELD with
  "rate is N× the reference — check the unit". Where the description carries
  dimensions that resolve to the item's unit ("pergola 3.5 x 3.5 m", 1 no, item
  per m² plan) the converted rate is OFFERED (24,500 ÷ 12.25 = 2,000.00 / m² plan),
  never applied. The J0 pergola had been ACCEPTED at 24,500 / m² plan (17.9×),
  which would have priced Arabella's HRD-06 at 300,125.00 instead of 16,741.95.
- **Quote review** (`assessLine` in `lib/quotes/store.ts` — the one place
  confirm and accept compute a status): the hold, `PATCH …/lines/:id
  { apply_conversion: true }` (rate, qty and unit converted, `conversion_note`
  kept) and `{ confirm_outlier: true }` (keep as quoted — an explicit act, a
  `rate_book_change` event `action: "outlier_confirmed"` with the ratio).
  `reviewQuote` gives each line the entry it would `replaces` and the
  `conversion` offer; the review screen shows both. Lines keep the sheet's
  `unit_given` (confirming an item overwrites `unit`).
- **Manual entries**: the same check on `POST /rates` and a figure-moving
  `PATCH` — 409 `rate_outlier` with `{ ratio, reference_rate_aed }` unless
  `confirm_outlier: true` (recorded). The editor warns live and offers "save
  anyway". `/api/rate-vocabulary` now carries the built-in figure where there is
  one (`reference.kind = "builtin"` + `rate_aed`).
- **One active entry per (firm, item_key, grade)** — whatever the origin or
  kind (the resolver ignores kind; two active kinds would be the same ambiguity).
  Before H8 the 045 index included `origin`, so the J0 book had two active
  `garden.pcc_base` (96.00 typed, 98.50 imported) and two `wall_plaster` (44.00
  typed, 48.00 imported); the resolver priced the **typed** one of each
  (`firm_entry` > `quote_import`), silently. Now a new entry SUPERSEDES the
  active one (history kept), enforced by `firm_rate_entries_active_uidx` and
  done in ONE transaction by `replace_firm_entry()` (migration **051**) — typed
  entries, figure edits (a grade change also retires the edited row) and quote
  accepts all go through `replaceEntry` (`lib/firms/store.ts`);
  `promote_correction()` supersedes an active entry of any origin. 051 resolved
  any existing duplicates to the resolver's winner. The review screen and the
  add form say which entry a new one replaces.
- **Checks**: `lib/firms/__tests__/magnitude.test.ts`,
  `lib/quotes/__tests__/h8-magnitude.test.ts` (the J0 fixture end to end);
  `scripts/quote-import-check.mjs` asserts the hold + conversion live; the
  onboarding walkthrough adds the supersede trail and the held pergola.
- **DB step**: `npm run db:push` for `051` **before** the code — without it
  `replaceEntry` answers 500 `migration_required` (no silent fallback that could
  create a second active row).

## Legal pages + the firm-#2 runbook (H6)

- **`/privacy` and `/terms`** render `content/legal/privacy.md` / `terms.md` —
  counsel's working drafts, verbatim, under a frontmatter block (`status`
  draft | published, `last_updated` YYYY-MM-DD, `source`). Publishing the
  lawyer-approved text is a **file swap + `status: published`**; no page edit.
  `lib/legal/markdown.ts` is a deliberately small Markdown (headings,
  paragraphs, quotes, lists, bold/italic) parsed to a block tree and rendered as
  React elements by `components/legal/LegalPage.tsx` — never as HTML. **While
  `draft` the pages show the pre-H6 "being finalised" placeholders
  (`components/legal/LegalPlaceholders.tsx`) — the drafts carry bracketed
  blanks and are never public** (decided 2026-10-04). On `published` the
  document renders with its Last updated line (the body's own `*Last updated:
  [date]*` slot is dropped for the frontmatter date). `LegalPage` still marks a
  draft and noindexes it, for a local preview. The sign-in form links both. A
  test pins both documents at `draft` — flipping it is the sign-off.
- **`docs/ONBOARDING_RUNBOOK.md`**: onboarding a second firm, in order —
  account (allowlist) → firm (or `firm-member-add` for Newspace's 041 firm on
  dev) → project membership + baseline regenerate → attach (both memberships)
  → regenerate with an EMPTY book, which must not move → build the book →
  mark reviewed → flags per pilot type → first proposal through the
  reference-basis gate; plus Arabella's `firm_id` decision point.

## Regenerate from the BoQ page (H4)

The payoff loop: change a rate or the plan → **Regenerate BoQ** → the new
revision's figure and a link to the U4 diff against the revision it superseded
(`/project/:id/boq/revisions?from=<previous>&to=<new>`).

- **Who** (`lib/boq/regenerate.ts`, ONE answer for route, pack export and page):
  since H5, the project's MEMBERS (`not_a_project_member`), whether or not it
  has a firm (H4 shipped it as firm members / any signed-in account). `generate-boq` enforces it on every STORING run, before
  anything is loaded or persisted (a `dry_run` stores nothing and is not
  gated); in-app Export pack refuses up front with the same answer, since it
  regenerates inside its job.
- **Disabled with a reason**: `regenerateReadiness` = authority + the plan
  refusals generation would answer with (`loadPriceablePlan` in
  `lib/boq/assemble.ts`: no plan / no area / no rooms / overlapping rooms), each
  with its fix link. The page passes the server's answer to the control
  (`RegenerateBoq`), so a grey button never disagrees with the route.
- **Recorded**: the `boq_generated` event carries the actor, `trigger:
  "regenerate"` and `previous_boq_id`; the response carries
  `previous_boq_id` / `previous_total_aed`, so the diff link is the server's own
  record of what it superseded.
- **What-if baseline fix (found by the walkthrough)**: `recalc` priced every
  UNSELECTED gradeable line at the rate-book "standard", so a firm-priced BoQ's
  page headline and summary showed reference-priced totals (the walkthrough
  villa: 498,824 on the page vs 477,495 stored) and a regenerated firm-rate
  change could never move them. An unselected line now keeps the rate it was
  priced at; only a chosen grade re-prices. The headline carries
  `data-display-total`.
- **Live**: the onboarding walkthrough's step 6 now edits a rate, presses
  Regenerate, checks progress, the stored revision, the page total, the event
  and the exact diff link, then follows it (`screenshots/h4/`).

## Direct-to-storage uploads + signed downloads (H9)

Vercel caps a function's request AND response body at ~4.5 MB (measured on prod
12 Oct: 4.3 MB reached the app, 4.7 MB got `413 FUNCTION_PAYLOAD_TOO_LARGE`),
so every limit above that was fiction. Since H9 no file passes through a
function. `docs/H9_DIRECT_UPLOADS.md` has the audit and the verification.

- **One limits table** `lib/uploads/limits.ts`: per kind (`plan`,
  `project_asset`, `room_photo`, `quote`, `logo`) max bytes, allowed types
  **by magic bytes** (`sniffType`), scope (project / firm / new project). The
  browser pre-check, sign and complete all read it. **No other numeric upload
  limit anywhere** — `lib/uploads/__tests__/limits-grep.test.ts` fails on one;
  migration 052's bucket cap is held equal to the largest kind.
- **Sign** `POST /api/uploads/sign {kind, project_id|firm_id, size, type,
  filename?, asset_kind?}`: session → membership (H5 project / U1 firm) → the
  declared size + type (structured 413 / 415 before any byte moves) → a signed
  upload URL for `pending/<kind>/<projectId|firmId|new>/<signerId>/<uuid>.<ext>`
  in the PRIVATE `uploads` bucket (052; no storage policies). The path names
  the signer, so no table records intents.
- **Upload**: the browser PUTs straight to Storage with progress
  (`lib/uploads/client.ts`: `uploadDirect`, `completeUpload`, `uploadFile`).
- **Complete** `POST /api/uploads/complete {path, …fields}` (or the kind's own
  route — `/api/upload`, `/api/project-asset`, `/api/room-photo`, the firm
  quote and branding routes — which take `{path, …}` now; **no multipart
  branch remains**): signer = caller (else 403 `upload_not_yours`), membership
  re-checked, REAL size (over ⇒ delete + 413) and magic bytes (mismatch ⇒
  delete + 415), sha256, moved out of `pending/`, then the kind's unchanged
  pipeline (`lib/uploads/register.ts`). A new upload route must go through
  `finishUpload` / `signUpload` (the route-auth scan accepts them as the
  membership check).
- **One error shape**: `{ code: payload_too_large | unsupported_type |
  upload_failed, kind, error }` (413 / 415 / 400); `error` names no number.
- **Large responses** `lib/documents/file-response.ts`: every document PDF route
  (render pack, drawing set, BoQ PDF, proposal, revision diff) answers through
  `fileResponse` — inline up to `RESPONSE_INLINE_MAX_BYTES` (4 MiB), else
  stored in `packs` at `downloads/<projectId>/<uuid>/<name>` and a 302 to a
  signed URL for that one object (300 s), AFTER the route's gates. The
  pack-export transport follows it.
- **Orphans**: `GET /api/cron/uploads-sweep` (Vercel Cron, `vercel.json`,
  daily) deletes `uploads/pending/` and `packs/downloads/` objects older than
  24 h — dry-run (logged) until `UPLOAD_SWEEP_APPLY="true"`; authenticated by
  `CRON_SECRET` (the one public-allowlist route added by H9).
- **Live check**: `node scripts/upload-direct-check.mjs [port]` (dev, `pack`
  server) — real Storage, a 6 MB plan through parse, a 16 MB photo, every
  refusal, second-account 403s, the reference garden's 7.3 MB render pack by
  redirect. Previews cannot be signed into (Vercel auth + prod-scoped Supabase
  env), so dev stands in.
- **DB step**: `npm run db:push` for **052** before deploying — without the
  bucket every sign fails.

## Route auth — a session everywhere (H1)

Every API route and every app page needs a signed-in caller, except the ONE
allowlist in `lib/auth/access.ts`: the `/auth/callback` route, `/api/health`
(anonymous = env presence only, no key fingerprints), `/api/cron/uploads-sweep`
(H9; its own `CRON_SECRET` bearer), the pages `/`,
`/rennovaite`, `/auth`, `/privacy`, `/terms`, and the sign-in / sign-out
server actions. `docs/AUTH.md` has the full account.

**Front door (13 Oct): the sign-in page is the front door** while the pilot is
invite-only. `/` and `/rennovaite` render nothing — `frontDoorRedirect()`
(`lib/auth/front-door.ts`) answers 307 to `/auth` signed out and to
`postSignInPath()` signed in. `postSignInPath(next?)` (`lib/auth/link-error.ts`)
is THE post-sign-in rule — the callback, `/auth`, `/` and `/rennovaite` all
call it; never write a second one. Temporary redirects only (a cached 308 would
outlive the pilot). `PropertyOsLanding`, `HomeLanding` and `watch-demo` are
parked, unrouted; the TopNav / Footer / legal back links point at `/auth`;
`/auth`, `/privacy` and `/terms` are `noindex`. `PROPERTY_OS_LANDING` is dead
(K_BACKLOG). Live check: `node --env-file=.env.local scripts/front-door-check.mjs <base> [--anonymous]`.

- **`proxy.ts`** (Next 16's middleware) gates first: `getClaims` on the Bearer
  JWT or the cookie session (local ES256 check, ~5–15 ms); off the allowlist an
  API route answers `401 { error, code: "unauthenticated" }`, a page redirects
  `307 /auth?next=<path>`. It also refreshes the cookie session. Fails closed
  without Supabase env.
- **Every handler checks again**, as its first await (only route params before
  it): `const caller = await getCaller(request); if (!caller) return
  unauthenticated(…);` (both from `lib/auth/caller.ts`). Server actions call
  `getCaller()` themselves. `lib/firms/__tests__/route-auth.test.ts` scans
  every route and `"use server"` file and fails the suite on one that does not.
  **A new route must open with that guard, or be added to the allowlist with a
  reason.**
- **Server-to-server calls carry a session.** The in-app pack export forwards
  its starter's credential (`forwardableAuthorization`) through
  `httpTransport(base, jobId, { authorization })`; inside a job,
  `generate-boq` keeps the job's actor for its event.
- **Scripts** call the app only through `scripts/lib/dev-auth.mjs` — `devFetch(who)`
  (Bearer, lazily minted, re-minted near expiry; `.authorization()` for the CLI
  transport) or `devSession(who)` (its `.cookies` for headless Chrome). There is
  no bypass, shared secret or dev mode in the routes.
- **Live check**: `node scripts/route-auth-sweep.mjs [port]` — every handler and
  page derived from the filesystem, anonymous / forged-token / signed-in.
- **Stage 2 is H5** (below): project ownership and invite-only sign-up. RLS is
  still off.

## The journey — one definition (B1/B2/B3; renumbered in K8)

`lib/journey.ts` is the single source of truth. **Since K8 the owner journey
is `OWNER_STEPS`, fixed numbers 00–06** — 00 Overview · 01 Plan (incl. the
intake) · 02 Design (`/design?view=direction|references`) · 03 Renders ·
04 Cost (tabs: Bill of quantities `/boq` | Specification `/accessories`) ·
05 Timeline · 06 Tender (tabs: Documents `/drawings` | Contractors &
suppliers `/vendors`). The rail draws them; a page's eyebrow comes from
`lib/journey-eyebrow.ts` — **never hard-code a step number**. The firm journey,
00–08, is `FIRM_STEPS` (see "Shell + journey rail (K2)"). `/ideation`,
`/style` → `/design` and `/moodboard` → `/design?view=references` are 308s
(`next.config.ts`). The **3D viewer is off the numbered path** (a side
surface: the rail keeps the step you came from, `shell/step-memory.ts`).

- **B1 questionnaire** (`lib/ideation/questionnaire.ts`, `project_briefs`):
  six weighted questions scored by a plain weighted sum. **No LLM** — a
  recommendation must be reproducible, or "re-run" is a dice roll. The route
  recomputes `recommended_style_key` from `answers` on every write, while a
  manual pick lives in a **separate `override_style_key` that a re-run never
  reads or writes**. That separation is what makes the flow safe to redo.
- **B2 moodboard** (`lib/moodboard/*`, `moodboard_items`): ordered references,
  each exactly one of a built-in style image, a render, or a user upload via
  the reusable `components/assets/AssetPicker` (`reference_image` kind, so
  uploads land in the asset library and stay reusable).
- **B3 taste seed** (`loadTasteSeed` in `lib/render-grounding.ts`, flagged
  `TASTE_SEED_ENABLED`): the board's first 3 references become extra image
  inputs and their descriptors a `References:` clause. **Style descriptions
  only — never quantities, never dimensions, never plan geometry**, plus an
  explicit "do not copy their layout": the edit model takes architecture from
  the source image and a moodboard must not argue with it. Style descriptors
  are derived deterministically from `lib/styles`; only an upload's descriptor
  is LLM-writable. Like every prompt block it only appends, so flag-off and
  flag-on are two cache entries. `renders.reference_refs` records the lineage —
  `null` = seeding did not run, `[]` = ran against an empty board.
- **DB step** (`npm run db:push` — see `docs/MIGRATIONS.md`): the ideation
  migration. Everything degrades gracefully until then (the questionnaire runs
  locally and says so).

## Env vars

| Name                              | Where used              |
| --------------------------------- | ----------------------- |
| `ANTHROPIC_API_KEY`               | server (Claude calls)   |
| `REPLICATE_API_TOKEN`             | server (image gen)      |
| `RENDER_MODEL`                    | server — optional; edit model id for renders (default `google/nano-banana`) |
| `NEXT_PUBLIC_SUPABASE_URL`        | client + server         |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | client                  |
| `SUPABASE_SERVICE_ROLE_KEY`       | server only — never expose |
| `NEXT_PUBLIC_POSTHOG_KEY`         | client — analytics on/off switch; unset = no-op |
| `NEXT_PUBLIC_POSTHOG_HOST`        | client — PostHog ingest host (EU: `https://eu.i.posthog.com`) |
| `NEO4J_URI`                       | server (KG retrieval)   |
| `NEO4J_USER`                      | server (KG retrieval)   |
| `NEO4J_PASSWORD`                  | server (KG retrieval)   |
| `KG_ENABLED`                      | server — `"true"` turns on KG grounding |
| `BOQ_ENGINE`                      | server — optional; unset = deterministic `lib/boq` engine, `"llm"` = legacy Claude-priced path |
| `PERMIT_CHECK_ENABLED`            | server — `"true"` turns on the P6 Dubai permit-trigger checklist |
| `STAGING_ENABLED`                | server — `"true"` turns on P7 furniture staging (render prompt + optional BoQ section) |
| `PROPERTY_OS_LANDING`             | DEAD (front door, 13 Oct) — read by nothing; `/` redirects to `/auth`. Remove (K_BACKLOG) |
| `TASTE_SEED_ENABLED`              | server — `"true"` lets a project's moodboard condition its renders (B3). Off = renders behave exactly as before |
| `PACK_EXPORT_ENABLED`             | server — `"true"` **with `DRAWINGS_ENABLED="true"`** shows the in-app "Export pack" action and lets the document routes answer a running pack job (T5). Off = the action is absent and every document route 404s |
| `TEXTURED_WALKTHROUGH`            | server — `"true"` lets the 3D walkthrough read StyleBoard finishes onto floors and walls (F1). Off = the clay model, unchanged |
| `PARSE_PROVIDER`                  | server — optional; which floorplan parser to use. Only `"inhouse"` (the default) is configured; any other value throws rather than silently mis-parsing |
| `AUTH_SIGNUP_ALLOWLIST`           | server — H5: who may be GIVEN an account (comma/space separated addresses or `prefix+*@domain` patterns). Unset = nobody new; existing accounts still sign in |
| `CRON_SECRET`                     | server — H9: the bearer Vercel Cron sends to `/api/cron/uploads-sweep`. Unset = the sweep answers 503 |
| `UPLOAD_SWEEP_APPLY`              | server — H9: `"true"` lets the daily sweep DELETE stale pending uploads / staged downloads. Unset = dry-run (logs what it would delete) |
| `PROJECT_PURGE_APPLY`             | server — K10: `"true"` lets the daily purge remove projects deleted > 30 days ago (rows + Storage). Unset = dry-run (logs ids and counts) |
| `GARDEN_PILOT_ENABLED`            | server — `"true"` turns on G1: drawing a plan from scratch, outdoor zone types, the unroofed/open-edge enclosure model, and the linear-element layer |
| `MULTIVIEW_RENDERS_ENABLED`       | server — the bathroom pilot's one flag (B1–B6). B1: `"true"` adds "One room from its dimensions" to the intake; B2: the studio's photo views. Off = intake and studio exactly as before |
| `PHOTO_VIEW_MAX_ATTEMPTS`         | server — B2: `1` = one paid render per photo view (no re-render after a failed check). Unset = the first render and one re-render |
| `PHOTO_VIEW_MODEL`                | server — B2b: the photo-view restyle model. Unset / `"pro"` = frame-pinned `google/nano-banana-pro`; `"edit"` = `google/nano-banana` (the fallback) |

### Feature flags — read at server start (flip → restart)

**All server feature flags in this app are read from `process.env` at server
start** (`process.env.X === "true"`), so changing one in `.env.local` requires a
**dev-server restart** to take effect — there is no runtime toggle. This covers
the Pilot-Seven flags below. Every flag defaults off, and off = pre-flag
behaviour.

**`PROPERTY_OS_LANDING` — DEAD since the front door (13 Oct).** Nothing reads
it: `/` and `/rennovaite` redirect to `/auth` (see "Route auth"). It used to
switch `/` between HomeLanding and the Property OS intro; both are parked.
Removal is in `docs/K_BACKLOG.md`.

### Pilot Seven feature flags (reserved)

Placeholders for the seven-feature pilot, added to `.env.local.example` by the
pre-flight (`PILOT_SEVEN_PREFLIGHT.md`). As wired: `DRAWINGS_ENABLED` (P1),
`OVERLAYS_ENABLED` (P2), `VIEWER_3D_ENABLED` (P3, also gates the P4 inspect
UI — since U7 it no longer gates the element take-off / mapping in the BoQ),
`WHATIF_ENABLED` (P5), `PERMIT_CHECK_ENABLED` (P6, renamed from the reserved
`COMPLIANCE_ENABLED`), `STAGING_ENABLED` (P7). All default off.

KG grounding (render + BoQ prompts) only activates when `KG_ENABLED="true"`
**and** Neo4j is running. If Neo4j is down or `KG_ENABLED` is anything else,
the app falls back to its pre-KG behaviour with no error — but note the
fallback costs a **10 s timeout per call**, so turn `KG_ENABLED` off rather
than leaving it on against a stopped database.

**Where Neo4j lives (O1):** the KG is moving to **Neo4j AuraDB** —
`NEO4J_URI=neo4j+s://<id>.databases.neo4j.io`, no code change, the driver
takes the encrypted scheme from the URI. `docs/OPS_RUNBOOK.md` has the
cut-over, the migration tooling (`scripts/kg/`: export → import → verify →
equivalence check against the app's own queries) and the rollback. The local
container `rennovaite-neo4j` is the **rollback for one week of clean Aura
operation** — stopped, not deleted, until Abdallah confirms that week. To use
it locally: `docker start rennovaite-neo4j` (allow ~40 s to reach `healthy`;
its named volumes `kg_neo4j_data` / `kg_neo4j_logs` persist the seed) and
point `NEO4J_URI` at `bolt://localhost:7687`. **`cd kg && docker compose up -d`
does NOT work from this repo** — `kg/` here holds only the vendored consumer
copy `kg/retrieval/agent.ts`; the seed, loader, and `docker-compose.yml` live
in the separate KG module — private remote
`https://github.com/alsharifer/rennovaite-kg`, local checkout at
`C:\Users\alsha\OneDrive\Desktop\RennovAIte\RennovAIte\kg`. Use compose only
from that directory.

**Backups (O2):** nightly `.github/workflows/backup.yml` (03:00 Dubai) wraps
`scripts/backup-production.sh` unchanged, encrypts the dump and uploads it to
Backblaze B2, prunes (daily 14 d / weekly 56 d), then **restores it from the
bucket** and compares every table's row count. A failed run opens an issue
labelled `backup-failure`. Secrets, restore commands and retention are in
`docs/OPS_RUNBOOK.md`.

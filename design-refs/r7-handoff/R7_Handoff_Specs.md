# R7 Handoff Specs — Blueprint design system + firm journey

*J5 · 5 Oct 2026 · source of truth: Figma file **RenovAIte — Blueprint Design System (R7)** `vgibM0F9SdEQErBaTxjUqH` · tokens: `tokens.css` / `tokens.json` in this folder (generated from the Figma variables — change Figma, re-export, never hand-edit) · build pack: `KSeries_Build_Pack.md` (docs root).*

Node IDs below are Figma node IDs: open `https://www.figma.com/design/vgibM0F9SdEQErBaTxjUqH?node-id=<id with : → ->`. Every mock figure in the frames reconciles; where a frame uses real pilot data the caption says so. **Identity rule applies to the build exactly as to the mocks:** no contractor/supplier name ever renders from `rate_book.source` or any free-text note — only curated labels.

**Not in this cycle (ship in the current UI, unchanged):** 03 Specification (accessories/spec comparison), owner Ideation · Moodboard · Style · Render · Scope & timeline · Downloads · Vendors · Viewer, `/rennovaite`. They must keep working on the Atelier tokens — see K1 "coexistence".

---

## 1 · Global

### 1.1 Tokens (all in `tokens.css`)
| Group | Tokens | Rule |
|---|---|---|
| Surfaces | `--color-surface-base` · `-raised` · `-sunken` | Paper substrate. *Raised* = popovers, sticky bars, selected-row wash — never a card. *Sunken* = table header bands, wells. |
| Ink | `--color-ink-primary` · `-secondary` · `-tertiary` · `-on-inverse` | Every number is `ink-primary`. Tertiary ≥4.5:1 on every surface in every mode (verified). |
| Lines | `--color-line-hairline` · `-strong` · `-control` | Hairlines replace cards. `line-control` (≥3:1) is the only boundary for inputs/controls. |
| Active | `--color-active-brass` · `-brass-text` · `--color-focus-ring` · `--color-focus-ring-inverse` | **Brass draws lines only**: rail marker, tab underline, selection rule, focus ring, eyebrow text. Never an area fill, never a number. |
| Provenance | `--color-prov-{measured,validated,market,derived}-{mark,text}` · `--color-prov-unpriced-mark` | **Provenance draws marks only** (the glyph + tier label text). Never a rule, row tint or number colour. |
| Alert | `--color-alert-surface` · `--color-alert-ink` | The only error/refusal treatment: inverse ink block (`.surface-inverse`). **No red, no amber, no green status hues anywhere.** |
| Space | `--space-0…24` (0,4,8,12,16,24,32,48,64,96) | 8 px grid; 4 px half-steps only inside components. |
| Shape | `--radius-none: 0` · `--stroke-hairline: 1px` · `--stroke-rule: 2px` | Zero radius everywhere. 2 px only for section rules, selection, focus, active tab. |
| Layout | `--layout-rail-width: 232px` · `--layout-rail-collapsed: 56px` · grid 8/96 | |

Modes: Light (default) · Dark `[data-theme="dark"]` (designed, not inverted — provenance hues lifted) · Warm `[data-skin="warm"]` (owner landing + intake only; light only this cycle).

### 1.2 Type (`.t-*` classes in `tokens.css`)
| Style | Face | Size/LH | Use |
|---|---|---|---|
| `display/serif` | EB Garamond 400 | 44/52 | **One per screen max** (hub project name, triage title). Most working screens have none. |
| `display/warm` | EB Garamond 400 | 64/72 | Owner landing/intake hero only. |
| `heading/lg · md · sm` | IBM Plex Sans 500/500/600 | 24/32 · 18/24 · 14/20 | Page · section · panel titles |
| `body/md · sm` | IBM Plex Sans 400 | 15/24 · 13/20 | Reading copy · table descriptions |
| `nav/item · item-active` | IBM Plex Sans 400/600 | 14/20 | Rail, tabs, buttons (600) |
| `label/caps` | JetBrains Mono 500, +8%, UPPER | 11/16 | Eyebrows, column heads, tier labels, step numbers |
| `label/md` | JetBrains Mono 400 | 12/16 | REF codes, units, meta |
| `num/xl · lg · md · sm` | JetBrains Mono 500/500/400/400, tabular | 32/40 · 20/28 · 14/20 · 12/16 | Pinned total · subtotals · table figures · arithmetic |

Fonts: add **IBM Plex Sans (Latin)** via `next/font` (the app ships Plex Sans *Arabic* + Inter today). Keep Plex Sans Arabic for bilingual data. Inter stays only on un-redesigned pages.

### 1.3 Numbers — formatting contract (one helper, used everywhere)
- `formatAED(n)` → en-US grouping, **exactly 2 decimals** in every BoQ/book/diff/proposal context (`7,329.70`, never `7,329.7`). Rates 2 dp. Quantities: integer if integral else 2 dp (`1`, `69.41`).
- Negative deltas use the true minus `−` (U+2212); positive deltas carry `+`. Percent deltas 1 dp; ratios `×17.9`.
- Estimates: `≈ AED 116,679.56*` — `≈` = estimate; `*` keeps its D4 meaning (footnotes excluded to-be-priced lines, which are always **named** next to it).
- Unpriced: rate `—`, amount `to be priced` (label/md, ink-tertiary), excluded from every total.
- Screen-reader text for headline: "approximately AED 116,679.56, excludes 3 lines to be priced" (no "star").
- **Display must reconcile:** shown rate × shown qty = shown amount, to the fils. Depends on H7 (rates rounded to 2 dp before multiplying; contingency/VAT to the fils).

### 1.4 Provenance mapping (Gate 1 + 5 Oct addendum) — implement as one `tierOf()` function
| Mark (glyph) | Token | Code sources | Firm label | Owner label |
|---|---|---|---|---|
| Solid ● | `prov-measured` | measured plan geometry · firm private rate · promoted `market_fair` correction | Measured / Own basis | Measured |
| ¾ ◕ | `prov-validated` | `qs_validated` | QS validated | Checked |
| ½ ◑ | `prov-market` | `actual_transaction` (calibrated reference) | Market reference | Market reference |
| Ring ○ | `prov-derived` | `qty_derived` · `pricing_skus` fallback · rule allowance · `labour_rates` · `indicative` · `site_assessment` · flags derived / sized-to-aggregate | Derived (+ which) | Estimated |
| Dashed ◌ | `prov-unpriced` (no hue) | `needs_qs` / QS-to-price, rate 0 | To be priced | To be priced |

**R1 weakest link:** a line's quantity mark = geometry tier; rate mark = rate tier; **amount, section subtotal, counted subtotal and headline = the weakest counted input** (order measured > validated > market > derived). Unpriced lines don't participate.
**R2:** hue + fill level always together (colour-blind safe). **R3:** marks are dots; brass is lines. **R4:** numbers are ink. **R5:** no status hues.
Glyph: 12×12 box, 10 px circle, 1.25 px ring inside; `Provenance mark` component (3:29). Non-interactive; every mark has a text alternative (see §4).

### 1.5 Grid & breakpoints
| Name | Width | Rail | Notes |
|---|---|---|---|
| Phone | < 768 (designed at 390) | top-bar step switcher + bottom step drawer | Rows go two-line; inspector = full-height sheet |
| Tablet portrait | 768–1023 (designed at 834) | Compact 56 | Section chips replace index; Unit + Rate move into the sheet; half-detent bottom-sheet inspector |
| Tablet landscape / laptop | 1024–1679 | Full 232, **except BoQ & Review → Compact** | |
| Desktop wide | ≥ 1680 | Full everywhere | |
Touch (`pointer: coarse`): every interactive target ≥ 44×44 hit area (visual may stay smaller; pad the hit area).

### 1.6 Icons
Material Symbols **Sharp**, weight 300, grade 0, optical 20, rendered via ligature; one `Icon` component (8:50). Retire lucide (merge the conversion branch, then delete remaining imports — inventory: plan editor, BoQ spinner, shadcn Dialog X).

### 1.7 Motion
Popover open 120 ms ease-out (opacity + 4 px y) after 250 ms hover delay · sheet 200 ms ease-out · section collapse 160 ms height · skeleton pulse 1.2 s opacity 1→0.6 · rail compact↔full on hover 160 ms. All off under `prefers-reduced-motion`.

### 1.8 Theme & skin
`<html data-theme="light|dark">` set server-side from the user preference (cookie) + a no-flash inline script; toggle in rail footer ("Theme · Light/Dark/System"). Owner landing + intake add `data-skin="warm"` on their root.

---

## 2 · Components (Components page, 3:14)

| Component | Node | Variants / props | Behaviour & a11y |
|---|---|---|---|
| Provenance mark | 3:29 | `Tier` = Measured/Validated/Market/Derived/Unpriced | Decorative glyph `aria-hidden`; its parent figure carries the tier in its accessible name/description. |
| Icon | 8:50 | `Glyph` text | `aria-hidden` unless standalone (then `aria-label`). |
| Journey step | 8:132 | `State` Done/Active/Available/Attention/Blocked × `Size` Full/Compact; `Number`, `Label`, `Reason`, `Show reason` | Link. Active = `aria-current="step"`, brass 2 px left rule + raised wash. Attention (flag) / Blocked (lock) show the reason line (Full) or tooltip (Compact) and include it in the accessible name: "08 Proposal — blocked: review rates or accept market basis". Blocked steps stay navigable (they explain *why*). |
| Journey rail | 9:361 | `Persona` Firm/Owner × `Size` Full/Compact | `<nav aria-label="Firm journey">`. Firm: wordmark · firm switcher · project switcher (rev + date) · 00 hub + 8 steps · footer (Firm rate book, Settings, Support, Theme, account). Owner: "My home" + 9 steps. Compact: icons/numbers only, labels as tooltips, hover/focus expands to Full as an overlay (doesn't reflow content). |
| Button | 10:230 | `Kind` Primary/Secondary/Quiet × `State` Default/Hover/Focus/Disabled; `Label` | 36 px tall (44 hit area on coarse pointer), zero radius. One Primary per view. **Disabled always paired with a visible reason**; implement as `aria-disabled="true"` + `aria-describedby` → reason (keeps it focusable so keyboard users can read why). |
| BoQ row | 12:314 | `Kind` Priced/Unpriced × `State` Default/Selected; `REF`, `Title`, `Qty`, `Unit`, `Rate`, `Amount` | One text line per row (title wraps to 2 max, then truncates with full title in the inspector). Columns REF 72 · Title fill · Qty 104 · Unit 64 · Rate 112 · Amount 136 · open 32. Each figure + its mark. Selected = brass left rule + raised + `aria-selected`. |
| BoQ section header | 12:335 | `Open` true/false; `Prefix`, `Name`, `Count`, `Subtotal` | `<button aria-expanded aria-controls>`; sticky under the column header while its lines scroll. Subtotal mark = weakest counted line; all-unpriced section shows "to be priced" + dashed mark. Count adds "· K to be priced". |
| Provenance popover | 12:336 | content slots: tier, which figure, arithmetic with each input's mark, curated sources, flags | Opens on hover (250 ms) **and on keyboard focus of the figure cell**; tap on touch opens the inspector instead. Dismiss: Escape, pointer-out (popover itself hoverable — WCAG 1.4.13). 320 wide, opens below right-aligned, flips above within 360 px of viewport bottom, never covers the selected row. `role="tooltip"` wired with `aria-describedby`. |
| Regenerate control | 15:292 | `State` Unchanged/Ready/Running/Done/Blocked | Unchanged: disabled + "Nothing has changed since rev N". Ready: Primary + what changed. Running: progress + what it's doing (status text in `aria-live="polite"`). Done: "rev N+1 created · ≈ total (Δ)" + **View diff** link. Blocked: lock + exact reason + where to fix. Member-gated (H5). |
| State block | 18:355 | `Kind` Empty/Loading/Error/Gate refusal/Pending | Empty: dashed hairline, what will happen, one action. Loading: skeleton rows **inside the shell** (rail + top bar stay). Error: `.surface-inverse`, cause, what's safe, retry, ref code; `role="alert"` only when it appears after a user action. Gate refusal: inverse, lock, unlock options as a checklist; a labelled region (not an alert) on page load. Pending: placeholder + what's running + honest duration. |
| Skeleton row | 18:276 | — | `aria-hidden`; container has `aria-busy="true"` + visually hidden "Loading BoQ". |

---

## 3 · Screens

### 3.1 Project hub — `/project/[id]` (J2: 11:48 light · 11:439 dark · 11:639 tablet)
Landing for a firm project. Header (eyebrow PROJECT HUB · project name in `display/serif` · meta line). **Estimate block:** headline `≈ AED N*` + weakest mark + named exclusions; "Basis of this number" table (tier rows: lines, AED, share; counted total row). **Next** column: up to 3 actions derived from gate/journey state (e.g. 04 review rates → reference-basis gate; 07 client approval outstanding), each with eyebrow step, title, sentence, Primary/Quiet. **Revisions** table (rev, date, cause, lines, Δ AED, total, status) + reconciliation line. **Documents** list (ready / locked + "Why locked?"). Tablet: single column; revisions drops Date + Total.
Data: latest BoQ summary, per-tier aggregates (sum of counted line amounts by amount-tier), revision list (`/api/projects/[id]/boq-revisions`), approvals, export readiness.
Empty: no BoQ yet → State block Empty in the estimate slot. Replaces the hub timeline card with mock dates.

### 3.2 BoQ & Review — `/project/[id]/boq` (J3: 13:48 · 14:675 dark · 14:890 tablet · 17:1602 scale check · phone 26:924)
**Layout (desktop ≤1679):** Compact rail · top bar (breadcrumb, `rev N · date · draft`, Revisions & diff, Export BoQ PDF, **Regenerate control**) · **pinned total bar** (sticky): PROJECT TOTAL · INCL. CONTINGENCY x% + VAT 5% · `≈ AED N*` + weakest mark · `* excludes K lines to be priced — REF, REF…` · right: "Basis of subtotal" (tier · lines · AED) · **notice rows** (each one line, flag icon, label/caps key, sentence, Quiet action): DRAFT FOR REVIEW (garden draft statement), PRICED FROM MARKET REFERENCE (reference-basis) · **work area**: section index 184 (sticky) | table (fill) | inspector 360 (when a line is selected).
**Section index:** REF prefix · name · subtotal + weakest mark · "K TBP"; current section = brass left rule. >10 sections → compact items (single line, name truncates with full name in `title`/accessible name, subtotal without decimals). Click = scroll + focus that section header. Footer: Summary & totals · Collapse all.
**Table:** sticky column header; sections in **canonical order (Preliminaries first — H7)**; rows per §2; summary chain at the end: Subtotal — N counted lines (mark) · OH&P (`not applied · no firm book on this project` or `x% · from your book`) · Contingency `x% × base` · VAT `5% × base` · Project total; then "* NOT IN THE TOTAL — TO BE PRICED" list with REF + qty + reason.
**Inspector tabs:** *Line* (REF · section · title `heading/md` · amount `num/lg` + mark + tier label · arithmetic with input marks · "Amount takes the weaker input — …" · QUANTITY block (tier, derivation, elements, Show on plan) · RATE block (tier, curated source, what's in the rate, "Your book has no entry…" + Add to my book) · Capture correction · Line history). *What-if* (16:1580): baseline vs scenario vs difference; modifier checkboxes with % and AED effect; scenario chain; "never the BoQ" copy; Save scenario / Reset. *Corrections · N*: list + **Capture correction** form (16:1654): type tabs Rate/Quantity/Scope/Design · current value + mark · corrected value input with unit suffix · live line effect · basis text · "Promote to our rate book after review" checkbox · sunken info note "A correction never changes this BoQ by itself…" · Save correction / Cancel.
**Tablet (834):** sections → chip strip (prefix + weakest mark, active = brass underline); Unit and Rate columns hidden; tap a row → bottom sheet at half detent (drag to full), selected row stays visible above it. No hover popover on touch — the sheet *is* the explanation.
**Phone (390):** top bar step switcher (`05 BoQ & Review ▾` → step drawer); pinned total compact; chips; rows two-line: title + amount + mark / REF + `qty unit × rate` + qty mark. Tap → full-height inspector sheet.
**States:** loading = skeleton rows in shell · empty = "No BoQ yet" + Generate · error = inverse block with retry, last good rev named · regenerating = Regenerate control Running; table stays readable (old rev) with a sunken banner "Showing rev 4 while rev 5 is generated" · blocked = Regenerate Blocked with reason (e.g. plan overlaps).
**Numbers on the frames** (Arabella rev 4 with H7): subtotal 102,892.03 · contingency 8,231.36 · VAT 5,556.17 · ≈ 116,679.56* · Market 6 lines 21,074.00 · Derived 9 lines 81,818.03 · 3 TBP.
**Open for K0:** garden what-if semantics (design assumes modifiers are additive % of the counted subtotal, contingency + VAT recomputed) — match the engine and fix the copy, not the engine; interior grade-picker what-if keeps its current interaction inside the new What-if tab shell.

### 3.3 Rates & Basis — book — `/firms/[firmId]` (in project context also reachable as step 04) (J4: 19:48)
Status strip (3 columns, hairline top): **Book status** (Draft — not reviewed · *Mark book reviewed* disabled with reason "Resolve N conflicts and confirm N outliers first") · **On this project** ("N of M lines price from your book; …") · **Reference basis** (Not accepted + Quiet "Accept market basis for this project" — records an event with name). Tabs: Entries · N | Quote imports · N | Corrections to promote · N | History. Table: ITEM (label + `item_key` mono) · KIND · UNIT · YOUR RATE (+ measured mark) · MARKET REF (+ market mark, or `built-in`) · VS REF (+x.x% / −x.x% / ×n.n) · ORIGIN (Firm entry · date / Quote ref · l.N). Groups: **NEEDS ATTENTION** first, then **IN USE**.
Attention kinds (each an expanded raised sub-row with explanation + actions): **Unit check** (ratio > 3× or < 0.33× and dimensions in the quote description resolve to the item unit → offer converted rate: "Convert to 2,000.00 / m² plan"; show the project consequence "12.25 × 24,500.00 = 300,125.00 instead of 16,741.95") · **Outlier** (ratio > 3× or < 0.33×, no conversion → Confirm / Retire) · **Conflict** (two active entries for one item/grade/kind → radio group, Keep selected, retire the other with history). Depends on **H8**.
Top bar actions: Download quote template (Quiet) · Import a quote · Add rate.

### 3.4 Quote import review — `/firms/[firmId]/quotes/[quoteId]` (J4: 20:263)
Pre-accept review. Header: supplier label (firm's own data — shown to the firm, never on client documents) · ref · version · date · validity · currency · net/excl. VAT · file name · sha256 prefix. Summary row: lines read · ready · to confirm · held · no match. Table: # · quoted line (+ qty unit) · quoted (raw) · matched item (`item_key` + how: key given / suggested · NN% match / exact) · enters book as · market ref · vs ref · STATUS (icon + label/caps + sentence + actions). Statuses: READY (incl. "Replaces your 96.00 firm entry (kept in history)") · CONFIRM MATCH (score < 0.6) · HELD · OUTLIER · HELD · UNIT CHECK · HELD · CURRENCY · HELD · NOT A NUMBER · NO MATCH. Footer: Primary "Add N ready lines to the book" · Quiet "Save review for later" · copy "Held and unmatched lines never enter the book…". Accepting an outlier requires explicit confirm (recorded).

### 3.5 Revisions & Approval — `/project/[id]/boq/revisions` (J4: 21:450) — now numbered step 07 with full chrome
From/To revision selectors · Export diff PDF. **Summary chain table** (rev A, rev B, Δ): counted subtotal · OH&P · contingency · VAT · project total (+ %). **Lines**: "N changed · N unchanged · N added · N removed · all N on quantity"; table REF · line · QTY a → b + mark · RATE (or a → b) · AMOUNT a → b · Δ AED · CAUSE (`none recorded` with help icon when no cause event; otherwise the cause summary, linked). Reconciliation line under the table. Right column 360: **Approval trail** (empty state copy + Record firm approval / Record client approval — client approval captured by the firm: date, method, reference) and **In this window · not linked to lines** (session decisions / plan edits between the two revisions, time + kind + summary) + "Link causes to lines".
Line key = stable line identity (U4), not REF.

### 3.6 Documents — `/project/[id]/drawings` (J4: 22:548)
"Export pack" — one gate for all documents. Left: **Export checks · rev N · run time** (icon, title, sentence, PASS / PASS · NOTE / BLOCKS CLIENT PACK): BoQ current · drawings match plan · quantities agree across documents (parity) · renders passed the design gate (substitutions named) · no contractor/supplier names (identity scan) · draft statement on every page · reference basis accepted. Right 400: **Internal review pack · ready** (watermarked DRAFT; list of contents; Download / Single files) and **Client pack locked** (State block Gate refusal). Drawing thumbnails grid stays below (existing component, restyled: zero radius, hairline frame). Replaces today's red "No drawings available." with State block Empty.

### 3.7 Proposal — **NEW ROUTE** `/project/[id]/proposal` (J4: 23:689) — step 08
Gate refusal block when locked. Setup (saved to the firm, reused): display name · logo (dashed drop zone empty state; display name set as type until a logo exists) · client (cover only) · validity · payment terms · cover note · checkbox "Show line rates to the client" **default off** (section totals only — the firm's book stays private). Right 440: "What the client receives · from rev N" (7 numbered sections) + Price summary preview (section totals, subtotal, contingency, VAT, total, excluded lines footnote, "regenerate after reviewing your book to apply your rates and OH&P"). Footer: Generate proposal (disabled with reason when locked) · Preview as client. Fields beyond `/api/firms/[id]/branding` (client, validity, cover note, rate toggle) are **new** — K4 adds them.

### 3.8 Scope — `/project/[id]/plan` chrome + parse failure (J4: 24:814)
Compact rail (02 active; downstream 05/06/08 Blocked with reason). Top bar: breadcrumb · undo/redo · Save changes (disabled until dirty). Layer tabs Plan / Openings / Electrical / Plumbing (brass underline) + tools Add room / Select / Measure. Canvas: `surface-sunken`; **canvas internals unchanged this cycle** except: purple/red handles → ink; overlap fill = ink at 30% with dashed ink outline ("floor counted twice"), rooms = ink 5%; legend chip top-left. Right panel 380 "Plan check": parse failure = inverse block ("Plan can't be priced yet", overlap count + share + consequence, Fix overlaps · N / Re-run parse) · overlaps list largest first (click = select both rooms) · "Blocked downstream" note. Remove the mock "Worth a second look" card.

### 3.9 Owner front door — `/` landing (J4: 28:1003) and `/project/new` intake (29:1016) — `data-skin="warm"`
Landing: nav (wordmark, How it works, For firms, Sign in, Start your project) · hero (`display/warm` headline, body, Start with your plan / See a sample bill of quantities, fee line) + 3:2 render slot with "checked against your plan" caption (licensed or own-project image only) · How it works 01/02/03 · provenance legend in owner vocabulary on `surface-raised` · For-firms band · footer (legal links marked "being finalised" until counsel). **No testimonials, logos or usage numbers until real.** Replaces the Property OS landing's own header/footer and hard-coded colours.
Intake: owner rail (01 active) · `display/serif` question · three option tiles (Upload a drawing / Draw it yourself / Start from photos — the last only when the garden flag is on) — selected = brass left rule + raised · upload zone (dashed) · **413 / too-large** = inverse block with what to do instead · project fields · Continue disabled with reason until a way to start is valid.

### 3.9a Sign in — `/auth` (added 11 Oct at Gate 3, frame 35:1152) — Dark, shared by firm and owner
Abdallah's Gate 3 change: the sign-in page is the one "futuristic" moment; everything after it stays practical. Full-bleed **3D design view** of a fictional demo villa (hidden-line clay/axonometric look: graphite faces, hairline `ink`-light edges, faint ground grid) on the right two-thirds, legibility gradient from `surface-base` at the left. Left panel 96 px inset: wordmark · eyebrow SIGN IN · `display/serif` headline "Renovation / Re-imagined" (two lines — Abdallah's edit, 11 Oct) · one sentence ("Sign in with your email. We send a one-time link. No password to remember.") · WORK EMAIL field · Primary "Email me a sign-in link" · invite-only note with Request access · legal links at the bottom. Caption chip bottom-right: "DESIGN VIEW · RENOVAITE 3D MODEL · ILLUSTRATIVE".
**Asset rules:** capture from our own 3D viewer (R3F) — never a client project, never a stock or AI image; 8–12 s slow orbit, WebM + MP4 ≤ 2 MB, poster frame shown first; static poster under `prefers-reduced-motion`, `Save-Data`, or slow connections; **no live WebGL on the sign-in page** (cost, battery, first paint). Video is decorative: `aria-hidden`, no audio, no controls. States: sent ("Check your inbox — the link expires in N minutes" + resend after 30 s), invalid email (inline, `aria-invalid`), not on the invite list (same neutral notice as today, no account enumeration). Phone: video hidden, poster as a 40%-height band above the form.

### 3.10 Route decisions (J4 triage, 25:924)
Cut from navigation: `/community`, `/marketplace`. Fold: `/firms` → firm switcher (redirect to the user's book; list only when >1 firm) · `/support` → help drawer on every page · `/project/[id]/style` stays inside ideation · accessories → 03 Specification (current UI) · firm timeline → BoQ programme section. `/settings` (minimal, no frame): Account (email, sign out) · Appearance (Light/Dark/System) · Firm (link to book: OH&P, branding). Legal pages: one template.

---

## 4 · Accessibility audit (WCAG 2.1 AA) — BoQ & Review + Rates & Basis
*Scanned in Figma: every text node's fg/bg token pair resolved per mode across BoQ light/dark/tablet, book, quote review, diff, documents, proposal, scope, phone, owner landing/intake.*

**Summary:** text contrast 0 failures (all pairs ≥4.59:1). **1 major found and fixed in tokens** (focus ring on inverse blocks in Dark = 1.97:1 → new `focus/ring-inverse`). The remaining items are implementation requirements — the design can't fail them, the build can.

### 4.1 Contrast (worst cases per pair)
| Pair | Light | Dark | Warm | Need |
|---|---|---|---|---|
| ink-tertiary / sunken | 4.67 | 5.66 | 4.59 | 4.5 ✅ |
| brass-text / base | 5.00 | 8.90 | 4.94 | 4.5 ✅ |
| prov-*-text / raised | ≥5.77 | ≥7.70 | — | 4.5 ✅ |
| alert-ink / alert-surface | 15.14 | 15.12 | 14.98 | 4.5 ✅ |
| prov marks / sunken (non-text) | market 3.31 · derived 3.40 · validated 4.17 | ≥5.66 | market 3.25 · derived 3.33 | 3.0 ✅ |
| line-control / raised | 5.48 | 4.99 | — | 3.0 ✅ |
| focus ring / base·raised·sunken | 3.49 · 3.74 · 3.19 | 7.66 · 7.10 | 3.45 · 3.13 | 3.0 ✅ |
| focus ring / alert block | 4.34 | **1.97 ❌ → fixed** (`focus-ring-inverse`, ≥14:1) | — | 3.0 |
Do not put `brass-text` on `surface-sunken` in Warm (4.48).

### 4.2 Findings → requirements
| # | Requirement | WCAG | Sev. |
|---|---|---|---|
| 1 | Provenance is conveyed by a 12 px glyph: every figure cell has an accessible description with its tier ("7,329.70, derived — quantity derived, rate market reference"). The mark itself `aria-hidden`. | 1.1.1, 1.3.1 | 🔴 if missed |
| 2 | The popover must open on keyboard focus too, stay open while hovered, close on Escape; on touch the inspector replaces it. Hover-only = provenance unavailable to keyboard/touch users. | 2.1.1, 1.4.13 | 🔴 if missed |
| 3 | BoQ table = ARIA grid with roving tabindex: Tab enters/leaves the grid; arrows move between cells; Enter opens the inspector for the row; Space toggles a section header. Not one tab stop per figure (≈100 stops). | 2.1.1, 2.4.3 | 🟡 |
| 4 | Inspector = `<aside aria-labelledby>`; on open focus moves to its heading; Close returns focus to the row. Tablet/phone sheet = modal dialog with focus trap + Escape. | 2.4.3, 2.1.2 | 🟡 |
| 5 | Section headers `<button aria-expanded aria-controls>`; section index = `<nav aria-label="BoQ sections">`, activating a link moves focus to the section header. | 4.1.2 | 🟡 |
| 6 | Disabled-with-reason controls (Mark reviewed, Generate proposal, Regenerate Unchanged/Blocked, Continue) use `aria-disabled` + `aria-describedby` → the visible reason; they stay focusable. | 4.1.2, 3.3.2 | 🟡 |
| 7 | Live updates: Regenerate status, what-if scenario total, quote "ready" count → `aria-live="polite"`; the pinned total announces only on change, not on scroll. | 4.1.3 | 🟡 |
| 8 | Tabs (inspector, book) = WAI-ARIA tabs (arrow keys between tabs, `aria-selected`). Active tab not by colour alone (underline + weight ✅). | 4.1.2, 1.4.1 | 🟢 |
| 9 | Conflict choice = real radio group with a legend; what-if modifiers = native checkboxes with labels. | 1.3.1, 3.3.2 | 🟢 |
| 10 | Touch targets: phone section chips (28 px) and Quiet buttons (36 px) get ≥44 px hit areas on coarse pointers. | 2.5.5 (house rule) | 🟢 |
| 11 | Reflow: at 400% zoom on 1280 px the BoQ must switch to the phone layout (layout by CSS px breakpoints, not device detection) — no horizontal scroll of the table. | 1.4.10 | 🟡 |
| 12 | Headline reads "approximately AED …, excludes 3 lines to be priced" (visually hidden text), not "AED … star". | 1.3.1 | 🟢 |
| 13 | Gate refusal blocks: labelled region with heading on load (not `role="alert"`); errors raised by a user action (413, retry failure) use `role="alert"`. | 4.1.3 | 🟢 |
| 14 | Truncated section names in the compact index expose the full name. | 1.3.1 | 🟢 |
| 15 | Skeleton containers `aria-busy`; pulse disabled under reduced motion. | 2.3.3 (AAA) / good practice | 🟢 |

### 4.3 Keyboard map — BoQ & Review
| Element | Tab | Enter / Space | Escape | Arrows |
|---|---|---|---|---|
| Rail | in order | navigate | — | — |
| Top bar actions | in order | activate | — | — |
| Notice rows | Quiet action only | activate | — | — |
| Section index | one stop (roving) | jump + focus section | — | ↑↓ between sections |
| BoQ grid | one stop (roving) | row → open inspector; header → toggle | close popover | ←→↑↓ cells; popover follows focused figure |
| Inspector | heading first, then controls | activate | close, focus back to row | ←→ between tabs |
| Bottom sheet (touch) | trapped | — | close | — |

### 4.4 Manual checks for KV (cannot be verified from Figma)
VoiceOver + NVDA pass over BoQ (grid announcements, figure descriptions), 200%/400% zoom, keyboard-only walkthrough of: open line → read provenance → capture correction → promote → regenerate → open diff.

---

## 5 · Open questions to resolve in K0 (read-only, before building)
1. Garden what-if semantics (additive % on counted subtotal?) — copy follows the engine.
2. Upload size limit (the intake error deliberately names no number).
3. Where the I4 curated provenance labels are produced — `tierOf()` must consume the same source, not re-derive from raw fields in the UI.
4. Tailwind version / theme mechanism in the repo (v3 config vs v4 `@theme`) — tokens map into whichever exists.
5. Which pages still depend on Atelier tokens after K (should be exactly the "ship in current UI" list above).

# Copy pass — surface record (2026-09-09)

Verification record for the pre-partner-session copy pass.

## On the missing PNGs — read this first

**There are no image files in this directory, and I could not produce them.**

Screenshots were taken and reviewed for every changed surface, but the in-app
browser returns images into the conversation rather than to disk, and this repo
has no headless-browser dependency (`playwright`, `puppeteer` — neither is
installed). Adding one to a copy-only pass would mean a ~200 MB browser download
and a new dependency for a task that changes no behaviour, so I stopped and
recorded the rendered text instead.

What follows is the **live rendered output** captured from the running app via
the DOM — the same text a visitor sees, not the source I wrote. If you want
actual PNGs, say so and I will add `playwright` and generate them properly.

One further limitation worth knowing: the preview pane only paints the top of a
document, so sections below the fold were verified by rendered text rather than
by eye. The hero, catalogue strip, `/privacy`, `/terms` and the intake page were
all confirmed visually.

---

## 1. Hero claim — `components/marketing/home-landing.tsx`

**Before**

> From your floorplan to a built villa, in five days.
>
> RennovAIte turns your villa's drawings into photoreal designs, a real bill of
> quantities in AED, and three vetted contractors ready to bid.

**After** (rendered)

> From your floorplan to a tender-ready renovation package in five days.
>
> Tender-ready means: design renders, an itemised bill of quantities in AED,
> drawings and a permit check — ready for contractors to bid. Built for Dubai
> owners.

The contractor half of the old subheading was removed, not reworded: there is no
contractor panel (see §7).

Sub-claim also removed: *"Average first-render in under 6 minutes"* → *"You pay
only when you lock a BoQ."* The six-minute figure was never measured.

## 2. Intake drawings — `app/project/new/_components/villa-intake.tsx`

**Before:** "Optional — stored for later. We don't process these yet."

**After** (rendered): "Optional. Stored with your project today; revised MEP,
electrical and HVAC drawings are a roadmap deliverable."

## 3. Step counts

**Before:** the landing page announced *"Five steps"* above three cards.

**After:** "One villa. Zero spreadsheets." — the three cards are a phase summary
and now carry no number, per the rule that a surface which numbers steps must
render exactly that many.

The app journey is unaffected and already correct: it sources every count from
`lib/journey.ts`. Confirmed live on `/project/new` — **"STEP 01 OF 09"** with
`DRAWINGS_ENABLED` on, which is `journeyLength()`'s real answer.

Audit result: no other surface in `app/` or `components/` states a step count.

## 4. Pricing label

**Before:** sidebar "Pro Plan"; landing "Standard Project Fee / AED 2,500 /
paid once your BoQ is locked and contractors are invited."

**After** (rendered)

- Sidebar: **"Project fee · AED 1,000"**
- Landing heading: "One project fee. No subscription, no design retainer."
- Landing: "Project fee / **AED 1,000** / at BoQ lock, credited in full when you
  execute through the platform."

`"Pro Plan"` returns zero hits across `app/` and `components/`. Note the price
also changed 2,500 → 1,000 to match the stated offer.

## 5. Supplier attribution

The logo strip was unlabelled, which read as a partner wall. It now carries a
caption above the names:

> **PRICED FROM SUPPLIER CATALOGUES AND REAL PROJECT QUOTATIONS**
> BRKZ · DANUBE HOME · IKEA UAE · SAINT-GOBAIN GYPROC · HOME CENTRE

The constant was renamed `TRUSTED` → `CATALOGUE_SOURCES` so the code cannot drift
back into implying endorsement.

**Newspace is not named on any public surface** — the audit found zero
occurrences outside `lib/ground-truth/` and internal docs. Nothing to change, and
nothing to soften to "our delivery partner" yet.

## 6. Dead links

`href="#"` returns **zero hits** across `app/` and `components/`. Every link on
`/rennovaite`, `/privacy` and `/terms` resolves:

```
/  ·  /project  ·  /marketplace  ·  /project/new  ·  /rennovaite
/rennovaite#how-it-works  ·  /rennovaite#pricing
/privacy  ·  /terms  ·  mailto:hello@rennovaite.fit
```

Footer links that pointed nowhere and had nothing behind them were **removed**
rather than stubbed: Floorplans, AI Rendering, Cost Calculator, Contractors,
About Us, Design Atelier, Careers, Refund Policy, and the inert `EN | AR`
toggle.

`/privacy` and `/terms` are honest stubs. **Both require real drafting by someone
qualified** — see the report.

## 7. Claims removed beyond the brief

| Surface | Claim | Why it went |
| --- | --- | --- |
| Vendors send modal | "We'll invite three vetted contractors to bid… you'll hear back within 3–5 business days" | No contractors table in any migration, no invitation path, no email. The dialog's only action was "Got it". |
| Landing testimonial | "The accuracy of the bill of quantities allowed us to start construction two weeks earlier…" | Unattributed, and no customer has said it. |
| Landing stats | "BoQ Precision AED 587,400" · "Design Delivery 6 hours" · "Execution Team 3 vetted" | A number presented as an accuracy measure; a delivery record and a contractor bench that do not exist. |
| BoQ page | "sourced from QS-vetted labour rates" | 12 of 61 `rate_book` rows carry `qs_validated`. The phrasing implied all of them. |
| Property OS card | "an itemized cost plan accurate to the line… and trusted execution" | "Accurate to the line" overclaims precision; "trusted execution" implies the same absent contractor network. |

Replacement stats, rendered:

> BOQ FORMAT — POMI sections
> CURRENCY — AED, local rates
> CALIBRATED AGAINST — 1 completed villa

---

## Verification

```
"built villa"   0 hits
"Pro Plan"      0 hits
href="#"        0 hits
"five days"     1 hit — the tender-ready hero
step counts     0 user-facing claims outside lib/journey.ts
```

`tsc --noEmit` clean · `eslint` 0 errors · 365 tests · build green, `/privacy`
and `/terms` prerendered.

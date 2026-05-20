# Atelier Precise — Migration TODO

Findings from the post-refactor verification pass. Items that were auto-fixed
have been moved out; items left here are decisions / data gaps that need
product input.

## Step 1 — Dark Silk / indigo legacy refs

All actionable matches were auto-fixed. Two files held the only remaining
indigo classes:

- `app/project/[id]/vendors/_components/send-modal.tsx:27` — round badge
  `bg-indigo-500/15 text-indigo-400` → `bg-primary-fixed text-brass-600`
  (soft-brass background + brass accent, the Atelier badge pattern).
- `app/project/[id]/boq/_components/generate-boq-button.tsx:44` — CTA
  `bg-indigo-600 text-white hover:bg-indigo-500` → `bg-brass-600
  text-on-primary hover:bg-primary` (Atelier primary CTA).

No matches for `neo-raised` / `neo-pressed` / `glow-indigo` outside the
"don't" callout in `CLAUDE.md`, and no literal `#0b1326` / `#131b2e`
anywhere.

## Step 2 — Hex literal audit

Three stale Dark Silk SVG paint values lived in
`app/project/[id]/plan/_components/editable-plan-viewer.tsx`. They have
been promoted to named constants alongside the existing
BONE_FILL/PRIMARY_FIXED/INK_900/INK_700 block and rewired:

- `#F87171` (Tailwind red-400) overlap-warning dashed stroke → `#9D3E1D`
  (`tertiary`/terracotta, the Atelier warning hue).
- `#F87171` Delete-X button circle fill → `#BA1A1A` (`error`, destructive).
- `#A855F7` (purple-500) resize-handle fill → `#A4793A` (`brass-600`).
- `#0B0712` (Dark Silk near-black) stroke → `#0F1B2D` (`ink-900`).

The remaining hex literals are all already Atelier values and are kept
inline because they feed places Tailwind classes can't reach (raw SVG
attributes, CSS-in-JS gradients, the shadcn `:root` variable bridge in
`globals.css`). They are:

| File / line | Hex(es) | Notes |
| --- | --- | --- |
| `app/globals.css:15–49,60,61,78,83,87` | full Atelier palette | shadcn variable bridge — each `:root` var is already commented with the token name. Leave. |
| `editable-plan-viewer.tsx:24–30` | full constant block | already named (BONE_FILL/PRIMARY_FIXED/INK_900/INK_700 + the 3 added above). |
| `boq-view.tsx:62–66` | `#7A5518`, `#966D2F`, `#A4793A`, `#C9A66B`, `#F1BE78` | five-stop sparkline palette across the Atelier brass ramp; already commented. |
| `vendor-picker.tsx:469,480` / `boq-view.tsx:749` / `render-interactive.tsx:939,1003` | `linear-gradient(135deg, #C9B79A 0%, #6B5B3E 100%)` | Atelier "brass-matte" gradient referenced from the Stitch HTML. Repeated 5×. **Polish opportunity:** centralize as a `bg-brass-matte` utility (or CSS custom property) so it lives next to `matte-image` in `globals.css`. Functionally correct as-is. |
| `render-interactive.tsx:578` | `#0F1B2D` | SVG polygon fill = ink-900. Kept as raw hex since the element is a `<polygon>` not a `<div>`. |
| `parse-loading.tsx:27,41` | `#0F1B2D` / `#4F4539` / `#A4793A` | inline `style={{}}` for animated dot states — ink-900 / ink-700 / brass-600. Cosmetic, kept inline because they're computed from `i === active`. |
| `components/app/Sidebar.tsx:73` | `#FBF7EE` | arbitrary class `bg-[#FBF7EE]` for the sidebar tint. Matches the `--sidebar` CSS var in `globals.css`. Could be promoted to a `sidebar` token alias in `tailwind.config.ts` — minor. |

## Step 3 — Default Tailwind shadows

`app/` is already fully on `shadow-level-1` (hover lifts, popovers, sticky
bars) and `shadow-level-2` (the floating Material Board / hero CTA). No
`shadow-sm` / `shadow-md` / `shadow-lg` / `shadow-xl` left in the app
tree.

One regression in `components/ui/button.tsx`: the `default` variant
carried a Dark Silk-era purple glow
(`shadow-[0_0_32px_rgba(168,85,247,0.28)]`) plus a `hover:bg-brand-hover`
class that doesn't resolve to any token. Replaced with
`hover:bg-brass-600` and the glow dropped entirely (Atelier is hairlines
over shadows). Other variants (`outline`/`secondary`/`ghost`/`destructive`/
`link`) already route through shadcn variables that are mapped to
Atelier tokens in `globals.css`.

## Step 4 — Route smoke test

All 15 routes returned HTTP 200 on a fresh fetch sweep against the live
dev server. No runtime errors in the post-fetch log window.

| Route | Status |
| --- | --- |
| `/` | 200 |
| `/auth` | 200 |
| `/dashboard` | 200 |
| `/project/new` | 200 |
| `/project/[id]` | 200 |
| `/project/[id]/plan` | 200 |
| `/project/[id]/style` | 200 |
| `/project/[id]/render` | 200 |
| `/project/[id]/boq` | 200 |
| `/project/[id]/vendors` | 200 |
| `/my-projects` | 200 |
| `/marketplace` | 200 |
| `/community` | 200 |
| `/settings` | 200 |
| `/support` | 200 |

## Step 5 — Font-family check

Live `getComputedStyle()` audit of every `<h1>…<h6>` on each rebuilt
route. **Zero heading offenders** — every heading resolves to
`EB Garamond, EB Garamond Fallback, Rubik, …` (display stack). Body
text resolves to `Inter, Inter Fallback, IBM Plex Sans Arabic, …`
(sans stack), and elements with `.font-mono` resolve to
`JetBrains Mono, JetBrains Mono Fallback, monospace`.

Note: `.tabular-nums` does NOT imply JetBrains Mono — the dashboard's
big stat value is deliberately `font-display text-[40px] tabular-nums`
(display font with tabular figures). That's by design, not a regression.

`/project/[id]/render` has zero headings — the workspace uses label
caps and div labels instead of formal `<h>` elements, also by design
(it's a tool surface, not editorial text).

## Step 6 — Icon audit

Six files still pulled icons from `lucide-react`. Four app-side files
have been converted to Material Symbols (and their stale Dark Silk
token classes — `text-text-*`, `bg-bg-*`, `brand-primary`,
`text-status-error/success` — fixed alongside the icon swap so the
files are internally consistent):

- `app/project/[id]/plan/_components/editable-project-name.tsx` —
  `Pencil` → `material-symbols-outlined "edit"`. Replaced
  `border-bg-border bg-bg-elevated text-text-primary
  focus-visible:ring-brand-primary/40` with `border-ink-100 bg-paper
  text-ink-900`; `text-text-tertiary` → `text-ink-500`;
  `hover:bg-bg-elevated/60` → `hover:bg-surface-container-low`;
  `text-status-error` → `text-error`.
- `app/project/[id]/plan/_components/editable-plan-viewer.tsx` —
  `Plus`/`Undo2`/`Layers` → `add`/`undo`/`layers`. Replaced
  `border-status-error/60 text-status-error hover:bg-status-error/10`
  with `border-error/60 text-error hover:bg-error/10`;
  `text-status-success` → `text-tertiary`; `text-status-error` →
  `text-error`.
- `app/project/[id]/boq/_components/generate-boq-button.tsx` —
  `Loader2` → animated `material-symbols-outlined "progress_activity"`.
  `text-label-sm` → `text-body-sm`; `text-status-error` → `text-error`.
- `app/project/[id]/vendors/page.tsx:135` — `text-status-error` →
  `text-error`.

The orphaned `components/back-button.tsx` (only self-referencing,
plus 5 stale Dark Silk classes in one line) was deleted.

The plan-route's loading skeleton `app/project/[id]/plan/loading.tsx`
was rewritten to use Atelier bone shimmer (`bg-bone`, `border-ink-100`,
`bg-canvas` page background) instead of the old `bg-bg-elevated`
placeholders.

Remaining lucide imports — both in shadcn primitives:

- `components/ui/dialog.tsx` — `XIcon` for the close button.
- `components/ui/accordion.tsx` — `ChevronDownIcon`/`ChevronUpIcon`.

These come straight from the shadcn registry and are wired through
slot props. Converting them to Material Symbols would mean forking the
primitives. Left as a follow-up — the design impact is invisible to
the user because dialog/accordion icons are tiny and use `currentColor`.

## Step 7 — `tsc --noEmit`

Clean. `npx tsc --noEmit` exits 0 with no diagnostics after all of the
VP1–VP6 fixes land.

## Step 8 — `eslint`

`npx eslint .` exits 0 with zero warnings.

There was one pre-existing warning (`no-page-custom-font` on the
Material Symbols `<link>` in `app/layout.tsx`) that we silenced with an
inline `eslint-disable-next-line` plus a comment explaining why: the
variable icon font has 4 axes (opsz/wght/FILL/GRAD) and isn't
swappable to `next/font`, so the documented Google Fonts `<link>`
install path is correct here.

## Step 9 — Screenshots at 1440×900

Captured via Chrome headless (`--headless=new --window-size=1440,900`)
and saved to `screenshots/atelier-precise/`:

| # | File | Route |
| --- | --- | --- |
| 01 | `01-landing.png` | `/` |
| 02 | `02-auth.png` | `/auth` |
| 03 | `03-dashboard.png` | `/dashboard` |
| 04 | `04-project-new.png` | `/project/new` |
| 05 | `05-project-hub.png` | `/project/[id]` |
| 06 | `06-project-plan.png` | `/project/[id]/plan` |
| 07 | `07-project-style.png` | `/project/[id]/style` |
| 08 | `08-project-render.png` | `/project/[id]/render` |
| 09 | `09-project-boq.png` | `/project/[id]/boq` |
| 10 | `10-project-vendors.png` | `/project/[id]/vendors` |
| 11 | `11-my-projects.png` | `/my-projects` |
| 12 | `12-marketplace.png` | `/marketplace` (placeholder) |
| 13 | `13-community.png` | `/community` (placeholder) |
| 14 | `14-settings.png` | `/settings` (placeholder) |
| 15 | `15-support.png` | `/support` (placeholder) |

Two visual notes:
- Several villa hero images in the dashboard + my-projects screenshots
  render as alt-text instead of pixels — these are the expired
  Replicate `replicate.delivery` presigned URLs flagged in B11 (TTL
  has elapsed). Pre-existing data quality issue, not a refactor
  regression.
- `/marketplace`, `/community`, `/settings`, `/support` are still the
  placeholder pages shipped in B0 (Step 7). They render the canonical
  AppShell with the page name, but the content panes are stubbed.

---

## Summary

The Atelier Precise migration (B0–B11) ported every user-facing screen
from the legacy Dark Silk / neomorphic system to the editorial
paper-on-paper aesthetic: tokens live in `tailwind.config.ts`,
`globals.css` only bridges shadcn variables and adds four utility
classes, every route now wraps `<AppShell>`, and all 15 routes return
HTTP 200 cleanly. The post-refactor verification pass (VP1–VP9) caught
the last legacy leftovers — two indigo accents, four stale Dark Silk
SVG hexes, the purple button glow, six lucide icon sites, an orphan
`back-button.tsx`, and the plan-route bone-shimmer skeleton — and
ended with `tsc --noEmit` and `eslint .` both exiting 0. Screenshots
of all 15 routes at 1440×900 sit under `screenshots/atelier-precise/`.

**Couldn't be matched 1:1 to Stitch:**

- The `/marketplace`, `/community`, `/settings`, `/support` pages are
  placeholder Atelier shells — Stitch never shipped detailed designs
  for these surfaces.
- `/my-projects` had no dedicated Stitch screen; its visual language
  is derived from the dashboard project-card pattern + the BoQ table
  treatment. Four spec items couldn't be honored because the data
  doesn't exist yet: a `community` column on `projects`, a `plan_type`
  column, an actor field for the "by Sara"/"by Atrium Build & Co."
  caption on list rows, and a real activity-log table for the
  dashboard "Recent activity" feed.
- The "In Construction" and "Handover" filter chips on `/my-projects`
  always render with a `(0)` badge because no domain tracks either
  yet.
- Two shadcn primitives (`components/ui/dialog.tsx`,
  `components/ui/accordion.tsx`) still import their X / Chevron icons
  from `lucide-react`. Converting them to Material Symbols would
  require forking the primitives. Visual impact is invisible (icons
  are tiny, `currentColor`).

**Still using stub data / hardcoded fallbacks:**

- Dashboard greeting name is hardcoded `"Sara"` — no auth-name
  wiring yet.
- The "+N this month" delta on the active-projects stat uses
  `projects.created_at` as a proxy because there's no real onboarding
  event.
- The dashboard "Recent activity" feed is synthesized from recent
  `renders` / `boqs` / `vendor_selections` rows — there's no
  `activity_log` table.
- Vendor distance / country / warranty / sample-availability values
  on `/vendors` come from a hardcoded `VENDOR_META` lookup keyed by
  brand — these fields don't exist on `pricing_skus`.
- BoQ materials-vs-labour classification is a heuristic (B7) — the
  underlying rows don't carry a classification column.
- Project Hub's "3 bids in flight" stat ships as `0`; there's no
  contractor-bids domain yet.
- 4 stored hero `render` URLs and 15 projects with no render at all
  cause the matte-image hero slot on the dashboard + `/my-projects`
  villa cards to fall back to "Render pending" / alt-text. The URLs
  themselves are TTL-expired `replicate.delivery` presigned links;
  longer-term fix is to re-host renders in Supabase Storage.

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

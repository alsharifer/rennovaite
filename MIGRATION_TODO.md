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

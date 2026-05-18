@AGENTS.md

# RennovAIte

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
- shadcn/ui components (base color: **neutral**), lucide-react icons
- Anthropic SDK (`@anthropic-ai/sdk`) for reasoning / design generation
- Replicate SDK (`replicate`) for image generation (render rooms, moodboards)
- Supabase (`@supabase/supabase-js`) for storage + persistence
- zod for schema validation at boundaries (LLM output, API inputs, env)
- PostHog for product analytics (env var wired, client not yet added)

## Brand — Dark Silk (current direction)

Single dark theme (no light mode). All tokens live in `app/globals.css` under
`@theme` (Tailwind v4 is CSS-first — there is no `tailwind.config.ts`).

The aesthetic is **neomorphic** — depth comes from precise light/shadow
modeling on a single plane, not from stacking layers. Backgrounds skew deep
blue-slate (`#0b1326` family); the active accent is **indigo** (`#6366f1`
ring, `indigo-400`/`indigo-500` text glows). The reference HTML/spec lives
in `design-refs/dark_silk/DESIGN.md` and `design-refs/ai_design_studio_dark_mode_refresh/code.html`.

### Surfaces (Dark Silk)

| Token                         | Hex       | Utility                            | Use                              |
| ----------------------------- | --------- | ---------------------------------- | -------------------------------- |
| `surface`                     | `#0b1326` | `bg-surface`                       | page / canvas background         |
| `surface-container-lowest`    | `#060e20` | `bg-surface-container-lowest`      | recessed wells (search pills)    |
| `surface-container-low`       | `#131b2e` | `bg-surface-container-low`         | secondary surfaces, input wells  |
| `surface-container`           | `#171f33` | `bg-surface-container`             | cards                            |
| `surface-container-high`      | `#222a3d` | `bg-surface-container-high`        | popovers, modals                 |
| `surface-container-highest`   | `#2d3449` | `bg-surface-container-highest`     | accent surfaces                  |
| `surface-bright`              | `#31394d` | `bg-surface-bright`                | active highlights                |
| `outline`                     | `#908fa0` | `border-outline`                   | strong dividers                  |
| `outline-variant`             | `#464554` | `border-outline-variant`           | hairline dividers                |

### Text

| Token                | Hex       | Utility                       | Use                       |
| -------------------- | --------- | ----------------------------- | ------------------------- |
| `on-surface`         | `#dae2fd` | `text-on-surface`             | body + headings on dark   |
| `on-surface-variant` | `#c7c4d7` | `text-on-surface-variant`     | muted body, secondary     |
| Tailwind `slate-400` | `#94a3b8` | `text-slate-400`              | tertiary, sidebar idle    |
| Tailwind `slate-500` | `#64748b` | `text-slate-500`              | placeholders / sub-labels |

### Accent (Indigo — Tailwind stock scale)

The active accent uses Tailwind's stock indigo scale, NOT a token. This
matches `design-refs/ai_design_studio_dark_mode_refresh/code.html` which uses
`text-indigo-400`, `text-indigo-500`, `bg-indigo-600`, etc.

| Class             | Use                                       |
| ----------------- | ----------------------------------------- |
| `text-indigo-500` | Wordmark, primary glow                    |
| `text-indigo-400` | Active nav item, primary buttons text     |
| `bg-indigo-600`   | Filled primary buttons                    |
| `glow-indigo`     | Utility — `box-shadow: 0 0 20px rgba(99,102,241,0.2)` |

### Type — Plus Jakarta Sans

- All text is **Plus Jakarta Sans**, loaded once in `app/layout.tsx` via
  `next/font/google` (weights 400/500/600/700/800) and exposed as
  `--font-jakarta`. `font-sans`, `font-display`, `font-serif`, and
  `font-heading` all resolve to the same family — there is no second face.
- Use the typography scale tokens, not raw `text-Xl`:
  - `text-h1` / `text-h2` / `text-h3` for headings (48 / 36 / 24 px, weight
    bold, tight tracking)
  - `text-body-lg` / `text-body-md` for body (18 / 16 px, line-height 1.6)
  - `text-label-md` / `text-label-sm` for labels (14 / 12 px, semi-bold,
    positive tracking)

### Iconography — Material Symbols Outlined

- Always use **Material Symbols Outlined** for shell + chrome icons.
  - Loaded once in `app/layout.tsx` via a `<link>` to fonts.googleapis.com.
  - Render with `<span className="material-symbols-outlined">{icon_name}</span>`.
  - Variation defaults are set in `globals.css`
    (`'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24`); override per-instance
    with `style={{ fontVariationSettings: "'FILL' 1" }}` if needed.
- `lucide-react` is still around in older components (BackButton, FadeIn,
  some pages). New components should reach for Material Symbols. Lucide
  usages will be migrated during per-screen rebuilds.

### Neomorphism — utility classes

Defined as raw CSS in `globals.css` (not Tailwind utilities). Apply on top
of `slate-950` / `slate-900` surfaces; the highlight color (`#1e293b`) and
depth color (`#080c18`) are tuned for that base.

| Class           | Effect                                                            |
| --------------- | ----------------------------------------------------------------- |
| `neo-raised`    | Extruded — `-5px -5px 10px #1e293b, 5px 5px 10px #080c18`         |
| `neo-pressed`   | Inset — `inset 4px 4px 8px #080c18, inset -4px -4px 8px #1e293b`  |
| `neo-button`    | Adds an `:active` press transform                                 |
| `glow-indigo`   | `0 0 20px rgba(99,102,241,0.2)` — primary call-out                |

The Sidebar's active nav item is the canonical neo-pressed example
(`bg-slate-900` + `shadow-[inset_4px_4px_8px_#080c18,inset_-4px_-4px_8px_#1e293b]`
+ `text-indigo-400`).

### Status

| Token            | Hex       | Utility                  |
| ---------------- | --------- | ------------------------ |
| `status.success` | `#34D399` | `bg/text-status-success` |
| `status.warning` | `#FBBF24` | `bg/text-status-warning` |
| `status.error`   | `#F87171` | `bg/text-status-error`   |

### Shell

Every full-app page is wrapped in `<AppShell pageName="...">` (from
`components/AppShell.tsx`), which composes:
- `<TopBar pageName />` — fixed `h-16`, `bg-slate-950`, hosts the wordmark,
  vertical divider, current page name, and the search/notif/account cluster.
- `<Sidebar />` — fixed `w-64`, `bg-slate-950`, primary nav (Dashboard, AI
  Designer, My Projects, Marketplace, Community), secondary group at the
  bottom (Settings, Support). Active state via `usePathname` →
  neo-pressed + `text-indigo-400`.
- Main content area is `ml-64 pt-16`. Pages should use
  `min-h-[calc(100vh-4rem)]` rather than `min-h-screen` to avoid double
  scrollbars.

### Legacy violet tokens (transitional)

The previous dark + violet tokens (`bg-bg-base`, `text-brand-primary`,
`text-text-secondary`, `font-display`, etc.) are kept as **aliases in
`globals.css` so existing pages don't break visually.** They will be
migrated to Dark Silk tokens during per-screen rebuilds. Don't reach for
them in new code — use `bg-surface`, `text-on-surface`, etc.

### Carve-out: floorplan SVG

`app/project/[id]/plan/_components/editable-plan-viewer.tsx` (and the
read-only `plan-canvas.tsx` companion) intentionally render rooms with a
**sand fill (`#F5EFE6`)** and **terracotta border / chips (`#B85042`)** on
a dark page. This is a deliberate "drafting paper on a desk" effect for the
data viz only. Keep this SVG as the only sanctioned use of the warm legacy
palette.

### Don't

- Don't introduce a light theme without product signoff.
- Don't reach for raw hex when a token utility exists.
- Don't mix Material Symbols with lucide inside one new component — pick
  Material Symbols for new shell-adjacent code.
- Don't pull the old violet tokens into new pages — they exist only to
  keep transitional pages alive until they're rebuilt.

## Visual polish principles

The bar is "premium designer-grade product" (Apple, Linear, Stripe, Arc) —
not "developer prototype". Apply these eight principles to every new
component and respect them when touching existing ones.

1. **Whitespace over content.** Default page padding is `p-12` on
   desktop, `p-6` on mobile. Section gaps are `gap-12`–`gap-16`
   (48–64 px), never less than `gap-8` (32 px). Cards have `p-6` minimum.
2. **Typography is the star.** H1 is **56–72 px** Plus Jakarta Sans,
   weight 700, tracking `-0.03em`, leading `1.05`. H2 is 36–44 px. Body
   is 17 px, leading 1.6. **Exactly one H1 per page.** Subtitles are
   18–20 px in `text-on-surface-variant`. The tokens in
   `app/globals.css` (`text-h1`, `text-h2`, `text-h3`, `text-body-lg`,
   `text-body-md`, `text-label-md`, `text-label-sm`) are already tuned
   to these — reach for them, not `text-3xl`/`text-[18px]`.
3. **One hero per screen.** Each page has one dominant element (hero
   render, primary action, key metric) that the eye lands on first.
   Everything else is supporting.
4. **Color restraint.** The page is 90 % surface tones (`slate-950`,
   `bg-surface-container`). The indigo accent appears on **at most
   three elements per visible viewport**: the active sidebar item, one
   primary CTA, and one status/metric highlight. No "decorative" indigo.
5. **Animations exist but are subtle.** All clickable elements have a
   150 ms transition on hover (color, `scale-[1.02]`, shadow elevation).
   Page transitions use a 250 ms fade. Cards lift `-translate-y-1`
   (4 px) on hover with a soft shadow expansion. Modal entries are
   200 ms scale-from-0.96.
6. **No purely decorative elements.** Every visible thing must serve a
   purpose. Dividers separate sections; icons aid recognition; gradient
   overlays add depth. If it doesn't, remove it.
7. **Consistent rhythm.** All cards in the same context share the same
   border-radius, padding, and shadow treatment. Mixing styles is
   forbidden — pick the contextual rule and stay with it.
8. **Buttons feel physical.**
   - **Primary:** `bg-indigo-600`, soft inset highlight on the top edge,
     `glow-indigo` on hover, `scale-[0.98]` on `:active`.
   - **Secondary:** `bg-surface-container`, `neo-raised` shadow,
     `text-indigo-300` on hover.

### Don't, additions

- Don't reach for `text-[18px]` / `text-3xl` / `text-[16px]` etc. when
  a token covers it. The token system is the reference; arbitrary sizes
  are a smell.
- Don't sprinkle `drop-shadow-…` or `shadow-[…]` to make something
  "feel important". The neomorphic + glow utilities are the sanctioned
  depth language. Custom shadows compete with them.
- Don't add `border-radius` outliers. Use `rounded-md` / `rounded-lg` /
  `rounded-xl` / `rounded-2xl` from the token scale.

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

## Env vars

| Name                              | Where used              |
| --------------------------------- | ----------------------- |
| `ANTHROPIC_API_KEY`               | server (Claude calls)   |
| `REPLICATE_API_TOKEN`             | server (image gen)      |
| `NEXT_PUBLIC_SUPABASE_URL`        | client + server         |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | client                  |
| `SUPABASE_SERVICE_ROLE_KEY`       | server only — never expose |
| `NEXT_PUBLIC_POSTHOG_KEY`         | client                  |

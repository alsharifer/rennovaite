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

## Brand — Atelier Precise (current direction)

The visual system is **Atelier Precise**: an editorial, paper-on-paper aesthetic
for the luxury Dubai market. Calm, exclusive, meticulous — a private
architectural atelier, never a construction tool. Replaces the old Dark Silk
(dark + neomorphic) system entirely. The reference materials live in
`design-refs/stitch_rennovaite_design_system/` (gitignored, local-only); the
spec is `atelier_precise/DESIGN.md` and the canonical shell wiring is
`landing_page/code.html` / `project_dashboard/code.html`.

**Default to light mode. There is no dark toggle in the PoC.**

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
  (JetBrains Mono). All three are loaded via `next/font/google` in
  `app/layout.tsx` and exposed as CSS variables; Arabic fallbacks
  (IBM Plex Sans Arabic for body, Rubik for display) are appended to each
  stack so RTL works without rework.
- Use the type scale tokens, not raw sizes: `text-display-hero` (64/72),
  `text-headline-lg` (40/48), `text-headline-lg-mobile` (32/40),
  `text-headline-md` (24/32), `text-body-lg` (18/28), `text-body-md` (16/24),
  `text-body-sm` (14/20), `text-data-mono` (14/20), `text-label-caps`
  (12/16, +0.05em).
- **Numeric cells in tables always use `font-mono tabular-nums`** (AED
  amounts, m², measurements) so figures align.

### Iconography

- **Always use Material Symbols Outlined via the global font** — render
  `<span className="material-symbols-outlined">icon_name</span>`. Loaded once
  via a `<link>` in `app/layout.tsx`. **No inline SVG icon imports** and no
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

- Don't introduce a dark theme or a dark toggle without product signoff.
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

## Env vars

| Name                              | Where used              |
| --------------------------------- | ----------------------- |
| `ANTHROPIC_API_KEY`               | server (Claude calls)   |
| `REPLICATE_API_TOKEN`             | server (image gen)      |
| `NEXT_PUBLIC_SUPABASE_URL`        | client + server         |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | client                  |
| `SUPABASE_SERVICE_ROLE_KEY`       | server only — never expose |
| `NEXT_PUBLIC_POSTHOG_KEY`         | client — analytics on/off switch; unset = no-op |
| `NEXT_PUBLIC_POSTHOG_HOST`        | client — PostHog ingest host (EU: `https://eu.i.posthog.com`) |
| `NEO4J_URI`                       | server (KG retrieval)   |
| `NEO4J_USER`                      | server (KG retrieval)   |
| `NEO4J_PASSWORD`                  | server (KG retrieval)   |
| `KG_ENABLED`                      | server — `"true"` turns on KG grounding |

KG grounding (render + BoQ prompts) only activates when `KG_ENABLED="true"`
**and** Neo4j is running — start it from the KG module with
`cd kg && docker compose up -d`. If Neo4j is down or `KG_ENABLED` is anything
else, the app falls back to its pre-KG behaviour with no error.

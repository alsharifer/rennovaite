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

## Brand

- Wordmark / primary: **terracotta `#B85042`**
- Accent: **deep teal `#164E63`**
- Background (hero / marketing surfaces): **warm cream `#FAF7F2`**
- Body font: **Inter** (loaded via `next/font/google`)

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

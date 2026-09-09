-- 027_ideation.sql — ideation questionnaire, moodboard, and taste-seed lineage
-- (backlog B1/B2/B3).
--
-- Three additions:
--   project_briefs   — B1. One row per project: the questionnaire answers, the
--                      style the recommender derived from them, and (separately)
--                      any manual override the user made. Keeping the two apart
--                      is the whole point: re-running the recommendation
--                      rewrites `recommended_style_key` and NEVER touches
--                      `override_style_key`, so a user's own pick survives.
--   moodboard_items  — B2. Ordered references per project. An item is exactly
--                      one of: a project_assets row (user upload), a built-in
--                      style image, or a render. `descriptor` is an optional
--                      short style description — the ONLY thing an LLM is
--                      allowed to write here (never quantities, never geometry).
--   renders.reference_refs — B3. Which moodboard items seeded a render, so a
--                      render's inputs stay traceable after the fact.
--
-- Manual apply: no migration runner — paste into the Supabase SQL editor.
-- Service-role JWT cannot run DDL. All code degrades gracefully until applied:
-- the questionnaire and moodboard show empty states, and taste-seeding is a
-- no-op.

-- 1. Ideation questionnaire ---------------------------------------------------
create table if not exists public.project_briefs (
  project_id            uuid primary key references public.projects(id) on delete cascade,
  -- { [questionId]: optionId | optionId[] } — shape owned by lib/ideation.
  answers               jsonb   not null default '{}'::jsonb,
  -- Deterministic output of the recommender over `answers`.
  recommended_style_key text,
  -- Full ranked list + per-style score, for "why this one?" transparency.
  recommendation        jsonb   not null default '{}'::jsonb,
  -- A style the user picked by hand. Survives every re-run of the recommender.
  override_style_key    text,
  completed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- 2. Moodboard ----------------------------------------------------------------
create table if not exists public.moodboard_items (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  -- asset | style | render — exactly one of the three ref columns is set.
  kind         text not null,
  asset_id     uuid references public.project_assets(id) on delete cascade,
  render_id    uuid references public.renders(id) on delete cascade,
  -- Built-in style imagery: the style key plus which room bucket's art.
  style_key    text,
  style_room   text,
  -- Resolved image URL at add time (style art is a static /moodboards path;
  -- asset + render URLs are re-derived on read, so this is a display cache).
  image_url    text,
  -- Short style description. LLM-writable. Never quantities, never geometry.
  descriptor   text,
  -- Manual ordering; gaps are fine, ties break by created_at.
  position     integer not null default 0,
  created_at   timestamptz not null default now()
);

alter table public.moodboard_items drop constraint if exists moodboard_items_kind_chk;
alter table public.moodboard_items add constraint moodboard_items_kind_chk
  check (kind in ('asset', 'style', 'render'));

-- Exactly one reference per row, matching its kind.
alter table public.moodboard_items drop constraint if exists moodboard_items_ref_chk;
alter table public.moodboard_items add constraint moodboard_items_ref_chk
  check (
    (kind = 'asset'  and asset_id  is not null and render_id is null and style_key is null) or
    (kind = 'render' and render_id is not null and asset_id  is null and style_key is null) or
    (kind = 'style'  and style_key is not null and asset_id  is null and render_id is null)
  );

create index if not exists moodboard_items_project_idx
  on public.moodboard_items (project_id, position, created_at);

-- The same style image should not be addable twice to one board.
create unique index if not exists moodboard_items_style_uniq
  on public.moodboard_items (project_id, style_key, style_room)
  where kind = 'style';

-- 3. Taste-seed lineage on renders -------------------------------------------
-- Array of moodboard_items ids whose imagery/descriptors conditioned the
-- render. NULL = the render predates taste-seeding or ran with it disabled;
-- an empty array = seeding ran but the board was empty. The two are different
-- facts and are stored differently on purpose.
alter table public.renders add column if not exists reference_refs jsonb;

alter table public.project_briefs   disable row level security;
alter table public.moodboard_items  disable row level security;

notify pgrst, 'reload schema';

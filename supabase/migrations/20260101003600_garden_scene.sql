-- 036_garden_scene.sql — what a plan-faithful render and a sectional elevation
-- need the plan to know (garden pilot G4b).
--
-- 1. Levels and heights live on the graph, not in a drawing. A render that
--    invents a pergola height and an elevation that prints one are the same
--    failure, so both read these columns:
--      rooms.level_mm   finished level of a zone relative to the plan datum
--                       (±0 FFL). NULL = the drawing does not state one.
--      rooms.height_mm  top of a structure zone above its level (pergola TRL).
--      rooms.spec       member sizes and where each number came from.
--      plan_elements.spec  counter/bench/planter build-up (top slab, plinth,
--                       kerb) and provenance.
--
-- 2. plan_context — what is on the plot but not in scope: the existing villa and
--    garage, an existing pergola, entrance steps, boundary walls. Never priced,
--    never a zone. A garden rendered without the house it belongs to is not the
--    garden, and a camera placed without knowing where the house is ends up
--    inside it.
--
-- 3. renders.camera / gate / cache_key — which camera a scene render was made
--    from, the faithfulness gate's verdict, and a cache key that includes the
--    project, so two projects with a same-named zone can never share an image.

alter table public.rooms add column if not exists level_mm numeric;
alter table public.rooms add column if not exists height_mm numeric;
alter table public.rooms add column if not exists spec jsonb;

alter table public.plan_elements add column if not exists spec jsonb;

create table if not exists public.plan_context (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.plans(id) on delete cascade,
  kind       text not null,
  name       text,
  -- Normalised footprint ring, same space as rooms.polygon.
  polygon    jsonb not null,
  base_mm    numeric not null default 0,
  height_mm  numeric,
  -- true = the height (or footprint) is assumed or scaled, not dimensioned.
  derived    boolean not null default false,
  note       text,
  source     text not null default 'traced',
  created_at timestamptz default now()
);
alter table public.plan_context drop constraint if exists plan_context_kind_chk;
alter table public.plan_context add constraint plan_context_kind_chk
  check (kind in ('existing_building', 'existing_structure', 'steps', 'boundary_wall'));
create index if not exists plan_context_plan_idx on public.plan_context (plan_id);
alter table public.plan_context disable row level security;

alter table public.renders add column if not exists camera text;
alter table public.renders add column if not exists gate jsonb;
alter table public.renders add column if not exists cache_key text;
create index if not exists renders_project_cache_idx on public.renders (project_id, cache_key);

notify pgrst, 'reload schema';

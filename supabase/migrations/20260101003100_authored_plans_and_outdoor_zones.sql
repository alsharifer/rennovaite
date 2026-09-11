-- 031_authored_plans_and_outdoor_zones.sql — garden pilot G1.
--
-- Three additive changes, all defaulted so every existing row keeps its current
-- behaviour exactly:
--
-- 1. plans.source / plot dimensions — a project can now start with no drawing to
--    parse. An authored plan has no PDF and no parsed_json; what it has instead
--    is a plot the user measured, and `plot_width_m` is the plan's real scale.
--    That distinction matters beyond provenance: buildPlanGraph normally infers
--    metres from total_area_m2, which assumes rooms TILE the plan. Interior
--    floors do; a garden does not — zones have gaps between them, so an inferred
--    scale would inflate every zone to fill the plot. A typed plot width is a
--    MEASUREMENT, and the graph marks it as one (derived.metric_scale = false).
--
-- 2. rooms.unroofed — the enclosure model. An unroofed zone has no ceiling and
--    its polygon edges emit no wall. Default false, so nothing already parsed
--    changes; outdoor zone types default it true when a room is created.
--
-- 3. plan_elements — linear runs. Openings are children of walls and fixtures
--    are points; a boundary wall, a bench, a planter kerb and an outdoor counter
--    are none of those. They are measured in linear metres, so they get their
--    own table rather than being forced into either shape. `polyline` is in
--    NORMALISED plan space, the same space as rooms.polygon and
--    plan_fixtures.position, so an element survives a change of scale.
--
-- Lighting and drainage POINTS need no schema at all: plan_fixtures already
-- carries an 'electrical'/'plumbing' layer with a free-text type, and the
-- overlay rules already have an `outdoor` category. They reuse both.

-- 1. Authored plans -----------------------------------------------------------

alter table public.plans add column if not exists source text not null default 'parsed';
alter table public.plans add column if not exists plot_width_m numeric;
alter table public.plans add column if not exists plot_depth_m numeric;

alter table public.plans drop constraint if exists plans_source_chk;
alter table public.plans add constraint plans_source_chk
  check (source in ('parsed', 'user_drawn'));

-- 2. Enclosure ----------------------------------------------------------------

alter table public.rooms add column if not exists unroofed boolean not null default false;

-- 3. Linear elements ----------------------------------------------------------

create table if not exists public.plan_elements (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.plans(id) on delete cascade,
  room_id    uuid references public.rooms(id) on delete set null,
  kind       text not null,
  polyline   jsonb not null,   -- normalised [[x, y], …], >= 2 points
  height_mm  numeric,
  width_mm   numeric,
  source     text not null default 'user_drawn',
  -- true when the cross-section was DEFAULTED rather than measured. A defaulted
  -- run must never silently read as a measured quantity.
  derived    boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.plan_elements drop constraint if exists plan_elements_kind_chk;
alter table public.plan_elements add constraint plan_elements_kind_chk
  check (kind in ('boundary_wall', 'bench_run', 'planter_run', 'counter_run'));

alter table public.plan_elements drop constraint if exists plan_elements_source_chk;
alter table public.plan_elements add constraint plan_elements_source_chk
  check (source in ('parsed', 'user_drawn'));

create index if not exists plan_elements_plan_idx on public.plan_elements (plan_id);
create index if not exists plan_elements_room_idx on public.plan_elements (room_id);

-- Match the rest of the PoC: RLS disabled (single-user, service-role access).
alter table public.plan_elements disable row level security;

notify pgrst, 'reload schema';

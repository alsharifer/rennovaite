-- 015_plan_fixtures.sql — Pilot Seven / P2 electrical + plumbing overlays.
--
-- One row per placed fixture (point) on the 2D plan. Rule-seeded fixtures have
-- source 'rule'; user edits in the 2D viewer write source 'user'. position is a
-- [x,y] pair in NORMALISED plan space (same space as rooms.polygon). Fixture
-- counts feed the "Electrical Installations" / "Plumbing & Sanitary" BoQ
-- sections deterministically (lib/overlays/boq.ts).
--
-- Manual apply: no migration runner — paste into the Supabase SQL editor
-- (same as 001–014). Service-role JWT cannot run DDL.

create table if not exists public.plan_fixtures (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  layer text not null check (layer in ('electrical', 'plumbing')),
  type text not null,
  room_id uuid references public.rooms(id) on delete set null,
  position jsonb not null,
  wall_id text,
  spec jsonb,
  source text not null default 'rule' check (source in ('rule', 'user')),
  created_at timestamptz default now()
);

create index if not exists plan_fixtures_project_layer_idx
  on public.plan_fixtures (project_id, layer);

alter table public.plan_fixtures disable row level security;

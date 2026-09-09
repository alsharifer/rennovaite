-- 021_staging.sql — Pilot Seven / P7 furniture staging.
--
-- Three additive pieces, all best-effort in the app (the feature degrades to
-- module defaults / no-op when they are absent):
--   1. renders.staging_set — which staging set dressed a render (trace + BoQ feed).
--   2. furniture_opt_ins    — per-room "add furniture to my budget" opt-in.
--   3. furniture_prices     — optional QS-editable override of the indicative
--                             retail figures in lib/staging/prices.ts.
--
-- Manual apply: no migration runner — paste into the Supabase SQL editor.

-- 1. Which staging set (if any) dressed a render.
alter table public.renders
  add column if not exists staging_set jsonb;

-- 2. Per-room furniture opt-in. Presence of a row = opted in.
create table if not exists public.furniture_opt_ins (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  created_at timestamptz default now(),
  unique (project_id, room_id)
);

create index if not exists furniture_opt_ins_project_idx
  on public.furniture_opt_ins (project_id);

alter table public.furniture_opt_ins disable row level security;

-- 3. Optional indicative price overrides (seed via scripts/seed-furniture-prices.ts).
create table if not exists public.furniture_prices (
  item_key text not null,
  tier text not null check (tier in ('value', 'mid', 'premium')),
  price_aed numeric not null,
  vendor text,
  updated_at timestamptz default now(),
  primary key (item_key, tier)
);

alter table public.furniture_prices disable row level security;

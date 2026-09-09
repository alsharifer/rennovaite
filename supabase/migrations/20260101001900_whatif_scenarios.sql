-- 019_whatif_scenarios.sql — Pilot Seven / P5 what-if scenarios.
--
-- A saved grade selection over a project's QS baseline BoQ, so a scenario
-- survives reload and can be shown to the QS. Never mutates the stored BoQ —
-- a scenario becomes real only via the normal BoQ regeneration path.
-- Manual apply: paste into the Supabase SQL editor.

create table if not exists public.whatif_scenarios (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  selections jsonb not null default '{}'::jsonb,
  total numeric,
  created_at timestamptz default now()
);

create index if not exists whatif_scenarios_project_idx
  on public.whatif_scenarios (project_id, created_at desc);

alter table public.whatif_scenarios disable row level security;

-- 013_plan_snapshots.sql — Pilot Seven / P1 geometry contract.
--
-- Immutable snapshots of the derived PlanGraph (lib/plan/geometry.ts). The
-- as-built snapshot is written once when the parse is confirmed; a proposed
-- snapshot is written whenever the user locks a design. Diffing as_built vs
-- proposed is what P2 (demolition quantities) and P6 (permit triggers) consume.
--
-- Manual apply: no migration runner in this project — paste into the Supabase
-- SQL editor (see MIGRATION_TODO.md / memory).

create table if not exists public.plan_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('as_built', 'proposed')),
  graph jsonb not null,
  created_at timestamptz default now()
);

create index if not exists plan_snapshots_project_kind_idx
  on public.plan_snapshots (project_id, kind, created_at desc);

-- Match the rest of the PoC: RLS disabled (single-user, service-role access).
alter table public.plan_snapshots disable row level security;

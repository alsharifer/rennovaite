-- 023_boq_outcomes.sql — the feedback-loop ledger (delta log).
--
-- One row per (project, comparison run): the platform's takeoff-provenance BoQ
-- total + per-section breakdown vs the contractor's actual total + per-section
-- breakdown, with the delta and any capture-gap notes. This is the "feedback
-- loop before data scale" gate made real — delta-log entry #1 is the Mudon pilot.
--
-- Manual apply: no runner — paste into the Supabase SQL editor.

create table if not exists public.boq_outcomes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  platform_boq_total numeric,
  platform_by_section jsonb not null default '{}'::jsonb,
  actual_total numeric,
  actual_by_section jsonb not null default '{}'::jsonb,
  delta_pct numeric,
  capture_gap_notes text,
  recorded_at timestamptz not null default now()
);

create index if not exists boq_outcomes_project_idx
  on public.boq_outcomes (project_id, recorded_at desc);

alter table public.boq_outcomes disable row level security;

-- 020_permit_checks.sql — Pilot Seven / P6 compliance surface.
--
-- The fired permit-trigger rules for a project's as-built→proposed diff, so the
-- concierge team sees the same checklist the homeowner saw. Deterministic
-- rule-based output (lib/compliance) — NOT an LLM guessing regulations.
-- Manual apply: paste into the Supabase SQL editor.

create table if not exists public.permit_checks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  plan_snapshot_id uuid references public.plan_snapshots(id) on delete set null,
  fired jsonb not null default '[]'::jsonb,
  checked_at timestamptz default now()
);

create index if not exists permit_checks_project_idx
  on public.permit_checks (project_id, checked_at desc);

alter table public.permit_checks disable row level security;

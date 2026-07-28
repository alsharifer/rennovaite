-- 017_takeoff_items.sql — Pilot Seven / P4 per-room takeoff layer.
--
-- One row per (room × work item) or (element × work item), computed
-- deterministically from the PlanGraph before the POMI BoQ aggregates. This is
-- what makes element↔BoQ-line mapping real: the aggregated POMI line's quantity
-- is the SUM over these items, and its element_refs are their element ids.
-- The stored POMI document format does NOT change — per-room lives here + in
-- views, never as extra document lines.
--
-- Manual apply: no migration runner — paste into the Supabase SQL editor.

create table if not exists public.takeoff_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  plan_snapshot_id uuid references public.plan_snapshots(id) on delete set null,
  work_item_key text not null,
  room_id text,
  element_id text,
  qty numeric not null,
  unit text not null,
  wet_area boolean not null default false,
  computed_at timestamptz default now()
);

create index if not exists takeoff_items_project_idx
  on public.takeoff_items (project_id, computed_at desc);

alter table public.takeoff_items disable row level security;

-- 014_drawing_sets.sql — Pilot Seven / P1 drawing engine persistence.
--
-- One row per generated drawing set. sheet_urls is a jsonb array of
-- { kind, title, sheet_number, svg_url, pdf_url } pointing at Supabase Storage
-- objects under projects/{id}/drawings/. Regenerated when the proposed snapshot
-- changes (design lock).
--
-- Manual apply: paste into the Supabase SQL editor. Also create a public
-- Storage bucket named `drawings` (or reuse an existing bucket) for the sheet
-- objects — see CLAUDE.md "Drawings (P1)".

create table if not exists public.drawing_sets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  plan_snapshot_id uuid references public.plan_snapshots(id) on delete set null,
  sheet_urls jsonb not null default '[]'::jsonb,
  generated_at timestamptz default now()
);

create index if not exists drawing_sets_project_idx
  on public.drawing_sets (project_id, generated_at desc);

alter table public.drawing_sets disable row level security;

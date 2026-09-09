-- 025_parse.sql — non-rectilinear parse: per-room confidence + parse metrics.
--
-- Adds:
--   rooms.confidence — provider's 0..1 confidence per room (nullable; the editor
--                      flags low-confidence rooms for review).
--   parse_metrics    — one row per parse and per correction-save: room counts,
--                      confidence summary, and user-correction counts (the
--                      "<3 corrections/plan" KPI made measurable), plus
--                      needed_split/needed_merge demand from the editor's
--                      "flag an issue" escape valve.
--
-- Manual apply: no migration runner — paste into the Supabase SQL editor.
-- Service-role JWT cannot run DDL. All code degrades gracefully until applied.

alter table public.rooms add column if not exists confidence numeric;

create table if not exists public.parse_metrics (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  plan_id             uuid references public.plans(id) on delete cascade,
  kind                text not null default 'parse',   -- 'parse' | 'corrections'
  provider            text,
  room_count          int,
  mean_confidence     numeric,
  low_confidence_count int,
  corrections         jsonb not null default '{}'::jsonb, -- {move,resize,vertex,relabel,delete}
  correction_total    int not null default 0,
  needed_split_count  int not null default 0,
  needed_merge_count  int not null default 0,
  detail              jsonb not null default '{}'::jsonb,
  recorded_at         timestamptz not null default now()
);

alter table public.parse_metrics drop constraint if exists parse_metrics_kind_chk;
alter table public.parse_metrics add constraint parse_metrics_kind_chk
  check (kind in ('parse', 'corrections'));

create index if not exists parse_metrics_project_idx
  on public.parse_metrics (project_id, recorded_at desc);
create index if not exists parse_metrics_plan_idx
  on public.parse_metrics (plan_id, recorded_at desc);

alter table public.parse_metrics disable row level security;

notify pgrst, 'reload schema';

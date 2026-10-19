-- 066_boq_snapshot_benchmark.sql — bathroom pilot B9: a frozen revision, and
-- a benchmark that can never be mistaken for ground truth.
--
-- 1. boq_snapshots — a BoQ revision FROZEN for a purpose (B9: the
--    pre-comparison snapshot a contractor's figure is compared against). A
--    revision is already append-only; the snapshot records WHICH one, why, its
--    pricing fingerprint and a copy of its document, so a later regeneration or
--    rate change cannot blur what was compared.
--
-- 2. boq_outcomes.kind — 'ground_truth' (every row so far: Mudon #1, the Villa 94
--    garden #2) or 'benchmark': a contractor's single total with no lines. It
--    can say "higher or lower", never which line is wrong, and no rate is ever
--    calibrated from it. `scope` says what the figure includes (VAT,
--    contingency, NOC, supply or labour only) and the like-for-like comparison;
--    `platform_snapshot_id` ties the comparison to the frozen revision.
--
-- Additive: existing rows default to ground_truth; nothing is rewritten.

create table if not exists public.boq_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  boq_id uuid not null references public.boqs(id) on delete cascade,
  purpose text not null check (purpose in ('pre_comparison')),
  label text not null,
  fingerprint text not null,
  grand_total_aed numeric not null,
  document jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create unique index if not exists boq_snapshots_project_purpose_uidx
  on public.boq_snapshots (project_id, purpose, boq_id);

alter table public.boq_snapshots disable row level security;

alter table public.boq_outcomes
  add column if not exists kind text not null default 'ground_truth',
  add column if not exists label text,
  add column if not exists scope jsonb,
  add column if not exists platform_snapshot_id uuid references public.boq_snapshots(id) on delete set null;

do $$ begin
  alter table public.boq_outcomes add constraint boq_outcomes_kind_check check (kind in ('ground_truth', 'benchmark'));
exception when duplicate_object then null; end $$;

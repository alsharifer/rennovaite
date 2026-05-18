-- =============================================================================
-- 007: Vendor selections — user's per-line SKU pick from /project/[id]/vendors
-- =============================================================================
-- Persists the customer's chosen pricing_skus row for a given BoQ line. The
-- BoQ generator cites a default SKU per line in vendor_or_source; this table
-- records when the customer swaps it for an alternative on the vendors page.
--
-- boq_line_id is a synthetic key of the form "${work_section}-${idx}" because
-- BoQ lines live inside the boqs.sections JSONB blob and don't have stable
-- per-line uuids. The (project_id, boq_id, boq_line_id) tuple is unique so
-- re-picking the same line upserts the row instead of stacking duplicates.
-- =============================================================================

create table if not exists public.vendor_selections (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  boq_id       uuid not null references public.boqs(id) on delete cascade,
  boq_line_id  text not null,
  sku_id       uuid not null references public.pricing_skus(id) on delete restrict,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique (project_id, boq_id, boq_line_id)
);

create index if not exists vendor_selections_project_idx on public.vendor_selections(project_id);
create index if not exists vendor_selections_boq_idx     on public.vendor_selections(boq_id);
create index if not exists vendor_selections_sku_idx     on public.vendor_selections(sku_id);

alter table public.vendor_selections disable row level security;

-- Tell PostgREST to pick up the new table without a project restart.
notify pgrst, 'reload schema';

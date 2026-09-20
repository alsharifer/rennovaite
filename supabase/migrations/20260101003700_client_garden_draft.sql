-- 037_client_garden_draft.sql — a garden drawn on DERIVED dimensions, the
-- features already on site, and the pilot's instrumentation (garden pilot G5).
--
-- 1. Derived vs measured, per dimension. The client garden is drawn first from a
--    developer type plan and amended once the plot is measured. Every boundary-
--    dependent value records which it is, so a document can say "derived" where
--    it is, and so the draft watermark can drop exactly when nothing boundary-
--    critical is derived any more:
--      plans.dims_derived / dims_note     the plot itself
--      rooms.dims_derived                 a zone's outline (rooms.derived_note says why)
--      plan_elements.dims_derived (+note) a run's position/length
--      plan_fixtures.dims_derived (+note) a point placed approximately
--      plan_context.dims_derived          a context footprint (plan_context.derived
--                                         keeps meaning "height assumed")
--
-- 2. Site reference. What already stands in the garden (a gazebo, a sink
--    counter, a stepping-stone path, planter borders, trees, string lights) is
--    placed on the plan and tagged site_reference, and the designer decides per
--    item: keep | remove | replace. NULL = not decided yet. The take-off reads
--    it: keep excludes the item from demolition AND new-work quantities; remove
--    counts demolition only; replace counts both.
--
-- 3. Two more run kinds for site reference — a stepping-stone path and a string
--    light run — neither of which is a surface or a counted point.
--
-- 4. pilot_events (time to draw, time to first full BoQ, friction points) and
--    boq_corrections (review-session corrections, typed, market_fair provenance).

alter table public.plans add column if not exists dims_derived boolean not null default false;
alter table public.plans add column if not exists dims_note text;

alter table public.rooms add column if not exists dims_derived boolean not null default false;
alter table public.rooms add column if not exists site_reference boolean not null default false;
alter table public.rooms add column if not exists disposition text;

alter table public.plan_elements add column if not exists dims_derived boolean not null default false;
alter table public.plan_elements add column if not exists derived_note text;
alter table public.plan_elements add column if not exists site_reference boolean not null default false;
alter table public.plan_elements add column if not exists disposition text;

alter table public.plan_fixtures add column if not exists dims_derived boolean not null default false;
alter table public.plan_fixtures add column if not exists derived_note text;
alter table public.plan_fixtures add column if not exists site_reference boolean not null default false;
alter table public.plan_fixtures add column if not exists disposition text;

alter table public.plan_context add column if not exists dims_derived boolean not null default false;
alter table public.plan_context add column if not exists site_reference boolean not null default false;
alter table public.plan_context add column if not exists disposition text;

alter table public.rooms drop constraint if exists rooms_disposition_chk;
alter table public.rooms add constraint rooms_disposition_chk
  check (disposition is null or disposition in ('keep', 'remove', 'replace'));
alter table public.plan_elements drop constraint if exists plan_elements_disposition_chk;
alter table public.plan_elements add constraint plan_elements_disposition_chk
  check (disposition is null or disposition in ('keep', 'remove', 'replace'));
alter table public.plan_fixtures drop constraint if exists plan_fixtures_disposition_chk;
alter table public.plan_fixtures add constraint plan_fixtures_disposition_chk
  check (disposition is null or disposition in ('keep', 'remove', 'replace'));
alter table public.plan_context drop constraint if exists plan_context_disposition_chk;
alter table public.plan_context add constraint plan_context_disposition_chk
  check (disposition is null or disposition in ('keep', 'remove', 'replace'));

alter table public.plan_elements drop constraint if exists plan_elements_kind_chk;
alter table public.plan_elements add constraint plan_elements_kind_chk
  check (kind in ('boundary_wall', 'bench_run', 'planter_run', 'counter_run', 'stepping_path', 'string_light_run'));

create table if not exists public.pilot_events (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  kind        text not null,
  detail      jsonb,
  recorded_at timestamptz not null default now()
);
alter table public.pilot_events drop constraint if exists pilot_events_kind_chk;
alter table public.pilot_events add constraint pilot_events_kind_chk
  check (kind in ('plan_started', 'plan_saved', 'design_edit', 'boq_generated', 'pack_exported', 'friction'));
create index if not exists pilot_events_project_idx on public.pilot_events (project_id, kind, recorded_at);
alter table public.pilot_events disable row level security;

create table if not exists public.boq_corrections (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  boq_id          uuid references public.boqs(id) on delete set null,
  item_key        text,
  line_description text not null,
  correction_type text not null,
  provenance      text not null default 'market_fair',
  field           text,
  old_value       numeric,
  new_value       numeric,
  note            text,
  element_refs    jsonb,
  recorded_at     timestamptz not null default now()
);
alter table public.boq_corrections drop constraint if exists boq_corrections_type_chk;
alter table public.boq_corrections add constraint boq_corrections_type_chk
  check (correction_type in ('rate', 'quantity', 'scope', 'design'));
alter table public.boq_corrections drop constraint if exists boq_corrections_provenance_chk;
alter table public.boq_corrections add constraint boq_corrections_provenance_chk
  check (provenance in ('market_fair'));
create index if not exists boq_corrections_project_idx on public.boq_corrections (project_id, recorded_at);
alter table public.boq_corrections disable row level security;

notify pgrst, 'reload schema';

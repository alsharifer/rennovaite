-- 039_garden_gates.sql — garden gates as openings in a boundary or separator
-- wall (garden pilot G5c).
--
-- An opening has always been a child of a WALL: a door snaps to the nearest wall
-- the graph derives from room edges. A garden's walls are not room edges — the
-- boundary and separator walls are plan_context footprints — so a garden gate
-- names its wall directly (context_id) instead of being re-snapped.
--
--   kind            — adds 'gate'
--   context_id      — the plan_context wall the gate is in (null for room-wall openings)
--   spec            — name, leaf, source note
--   site_reference / disposition / dims_derived / derived_note — the G5 (037)
--                     vocabulary: an existing gate photographed on site is placed,
--                     decided (keep/remove/replace) and flagged derived like every
--                     other existing item.

alter table public.plan_openings drop constraint if exists plan_openings_kind_chk;
alter table public.plan_openings add constraint plan_openings_kind_chk
  check (kind in ('door', 'window', 'archway', 'gate'));

alter table public.plan_openings add column if not exists context_id uuid references public.plan_context(id) on delete cascade;
alter table public.plan_openings add column if not exists spec jsonb;
alter table public.plan_openings add column if not exists site_reference boolean not null default false;
alter table public.plan_openings add column if not exists disposition text;
alter table public.plan_openings add column if not exists dims_derived boolean not null default false;
alter table public.plan_openings add column if not exists derived_note text;

alter table public.plan_openings drop constraint if exists plan_openings_disposition_chk;
alter table public.plan_openings add constraint plan_openings_disposition_chk
  check (disposition is null or disposition in ('keep', 'remove', 'replace'));

create index if not exists plan_openings_context_idx on public.plan_openings (context_id);

notify pgrst, 'reload schema';

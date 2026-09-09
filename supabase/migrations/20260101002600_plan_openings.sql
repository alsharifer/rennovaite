-- 026_plan_openings.sql — openings (doors/windows/archways) as first-class
-- children of walls (backlog A5).
--
-- One row per opening. Openings attach to a WALL (not a room): `wall_ref` is a
-- stable hint, but the PlanGraph re-snaps each opening to its nearest derived
-- wall at build time (derived wall ids are volatile). Consumers: net-wall
-- quantities (takeoff deducts opening area from paint/plaster/wall-tile — already
-- wired in lib/boq/quantify.ts), a door/window schedule view, and the R2 2D
-- editor which creates/edits these records.
--
--   kind    — door | window | archway
--   source  — parsed (from the parser) | user_drawn (editor capture)
--   derived — true when dimensions were DEFAULTED (standard door 0.9×2.1 m, etc.)
--             rather than measured. A defaulted opening must never silently read
--             as a measured quantity.
--   position — normalised [x, y] midpoint (same space as rooms.polygon).
--
-- Manual apply: no migration runner — paste into the Supabase SQL editor.

create table if not exists public.plan_openings (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references public.plans(id) on delete cascade,
  room_id      uuid references public.rooms(id) on delete set null,
  wall_ref     text,
  kind         text not null,
  width_mm     numeric,
  height_mm    numeric,
  sill_mm      numeric,
  position     jsonb,        -- normalised [x, y]
  along_offset numeric,      -- 0..1 along the wall
  source       text not null default 'user_drawn',
  derived      boolean not null default false,
  created_at   timestamptz not null default now()
);

alter table public.plan_openings drop constraint if exists plan_openings_kind_chk;
alter table public.plan_openings add constraint plan_openings_kind_chk
  check (kind in ('door', 'window', 'archway'));

alter table public.plan_openings drop constraint if exists plan_openings_source_chk;
alter table public.plan_openings add constraint plan_openings_source_chk
  check (source in ('parsed', 'user_drawn'));

create index if not exists plan_openings_plan_idx on public.plan_openings (plan_id);
create index if not exists plan_openings_room_idx on public.plan_openings (room_id);

alter table public.plan_openings disable row level security;

notify pgrst, 'reload schema';

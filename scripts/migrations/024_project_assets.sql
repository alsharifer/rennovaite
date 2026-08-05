-- 024_project_assets.sql — project asset library (A3/A4/C2).
--
-- One row per uploaded document/image belonging to a project: the floorplan,
-- existing MEP/electrical/HVAC drawings, site photos, and reference/moodboard
-- images. This is the single catalogue the intake flow writes into and the
-- render photo picker + project hub read from — so a photo uploaded at intake
-- is reusable at the render step instead of being re-uploaded per room.
--
--   kind    — floorplan | drawing_mep | drawing_electrical | drawing_hvac
--             | photo | reference_image | other
--   room_id — nullable; set when a photo is assigned to a room in the render
--             picker (drawings/floorplan stay project-scoped)
--   source  — intake | render | moodboard (where the upload originated)
--
-- Objects live in the existing (public) `plan-uploads` bucket under
-- `<project_id>/assets/<uuid>.<ext>`; `storage_path` is that key. Public URLs
-- are derived at read time, so no url column.
--
-- Manual apply: no migration runner — paste into the Supabase SQL editor.

create table if not exists public.project_assets (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  kind         text not null,
  room_id      uuid references public.rooms(id) on delete set null,
  storage_path text not null,
  filename     text,
  mime         text,
  bytes        bigint,
  uploaded_at  timestamptz not null default now(),
  source       text
);

-- Guard the enumerations (idempotent — drop first so re-runs don't error).
alter table public.project_assets drop constraint if exists project_assets_kind_chk;
alter table public.project_assets add constraint project_assets_kind_chk
  check (kind in (
    'floorplan', 'drawing_mep', 'drawing_electrical', 'drawing_hvac',
    'photo', 'reference_image', 'other'
  ));

alter table public.project_assets drop constraint if exists project_assets_source_chk;
alter table public.project_assets add constraint project_assets_source_chk
  check (source is null or source in ('intake', 'render', 'moodboard'));

create index if not exists project_assets_project_idx
  on public.project_assets (project_id, uploaded_at desc);
create index if not exists project_assets_room_idx
  on public.project_assets (room_id);
create index if not exists project_assets_kind_idx
  on public.project_assets (project_id, kind);

-- RLS disabled to match every existing table (auth comes later; all access is
-- via the service role).
alter table public.project_assets disable row level security;

-- Tell PostgREST to pick up the new table without a project restart.
notify pgrst, 'reload schema';

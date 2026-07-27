-- =============================================================================
-- 010: Room photos — substrate for the photo-first render path (Phase 1)
-- =============================================================================
-- Stores an uploaded "before" photo per room. The photo-first render pipeline
-- (a later task) restyles this exact photo so the output reads as the owner's
-- real room rather than a generic AI room. Multiple rows per room are allowed;
-- the latest by created_at is the active photo.
--
-- The renders columns record what produced each image so we can A/B models and
-- trace a render back to its source photo:
--   source_image_url — the room photo (or base image) fed to the model
--   model            — the Replicate model id used
--   mode             — control mode / pipeline path (e.g. depth, photo-edit)
-- =============================================================================

create table if not exists public.room_photos (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid references public.rooms(id) on delete cascade,
  storage_path  text,
  public_url    text,
  created_at    timestamptz default now()
);

create index if not exists room_photos_room_id_idx on public.room_photos(room_id);

alter table public.room_photos disable row level security;

-- renders: provenance for the photo-first pipeline (all nullable, back-compat).
alter table public.renders add column if not exists source_image_url text;
alter table public.renders add column if not exists model text;
alter table public.renders add column if not exists mode text;

-- Tell PostgREST to pick up the new table + columns without a project restart.
notify pgrst, 'reload schema';

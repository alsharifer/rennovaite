-- 064_room_design_anchor.sql — one design across a room's views (bathroom pilot B4).
--
-- B2 rendered every photo of a room on its own: five views, five slightly
-- different bathrooms. B4 anchors the room to the FIRST view the user locks —
-- a photo view by default, because it carries the real layout. Every later
-- render of the room's other views is made against the anchor's image and a
-- short room design spec read from it, and records which anchor it followed.
--
--   room_anchors          one row per room: the locked view that anchors it
--                         (room_photo_id + the render version locked), the room
--                         design spec read from that render (floor tile, wall
--                         tile + tiled height, vanity, mirror, WC, shower
--                         screen, fittings finish, palette), and its history —
--                         an "Ask for a change" on the anchor moves it to the
--                         new version (the old one is kept in `history`).
--   room_photos.locked_*  the version of THIS view the user locked.
--   renders.anchor_render_id
--                         the anchor version a render was made against — a view
--                         whose anchor_render_id is not the room's current one
--                         no longer follows it (shown; never re-rendered
--                         automatically).
--
-- Additive: no existing row changes.

create table if not exists public.room_anchors (
  room_id        uuid primary key references public.rooms(id) on delete cascade,
  room_photo_id  uuid null references public.room_photos(id) on delete set null,
  render_id      uuid not null references public.renders(id) on delete cascade,
  spec           jsonb not null,
  history        jsonb not null default '[]'::jsonb,
  locked_by      uuid null,
  locked_at      timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.room_anchors disable row level security;

alter table public.room_photos
  add column if not exists locked_render_id uuid null references public.renders(id) on delete set null,
  add column if not exists locked_at timestamptz null;

alter table public.renders
  add column if not exists anchor_render_id uuid null references public.renders(id) on delete set null;

notify pgrst, 'reload schema';

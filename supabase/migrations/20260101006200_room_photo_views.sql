-- 062_room_photo_views.sql — every photo of a room is a view, placed on the plan
-- (bathroom pilot B2).
--
-- room_photos always allowed many rows per room, but the render route read only
-- the LATEST one: a room had one photo. B2 makes each photo a view of its own
-- ("Photo N · your photo"), restyled on its own, and asks where it was taken
-- from — the camera is what lets a view be checked against the plan, and what
-- B4's views-on-the-plan draws.
--
--   room_photos.camera_position      [x, y] in the plan's normalised space (the
--                                    space rooms.polygon is in); null = not placed
--   room_photos.camera_heading_deg   compass heading the camera looks along —
--                                    0 = plan up (−y), 90 = plan right, clockwise
--                                    (the room sheet's and B1's fixture convention)
--   room_photos.camera_set_by        who placed it (the signed-in member)
--   renders.room_photo_id            the photo a render restyles — a photo view's
--                                    renders; null for every render before B2
--
-- Additive: nothing existing reads these, and the latest-photo render path is
-- unchanged.

alter table public.room_photos
  add column if not exists camera_position jsonb null,
  add column if not exists camera_heading_deg numeric null
    check (camera_heading_deg is null or (camera_heading_deg >= 0 and camera_heading_deg < 360)),
  add column if not exists camera_set_by uuid null;

alter table public.renders
  add column if not exists room_photo_id uuid null references public.room_photos(id) on delete set null;

create index if not exists renders_room_photo_id_idx on public.renders(room_photo_id) where room_photo_id is not null;

notify pgrst, 'reload schema';

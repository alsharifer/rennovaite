-- 065_room_tiled_height.sql — how high a room's walls are tiled (bathroom pilot B5).
--
-- The element take-off measured wet-wall tiling at full height AND painted every
-- wall — so a bathroom's walls were priced tiled and painted on the same face
-- (the pilot bathroom: 27.53 m² tiling + 27.52 m² paint). The rule (room sheet §7
-- item 7): per room, a tiled height; wall paint only ABOVE it; the ceiling always.
--
--   rooms.tiled_height_m   metres, null = the room type's default: full height
--                          for a wet room (bathroom, ensuite, powder, kitchen —
--                          what the take-off already tiles), none for a dry room.
--                          A stored value below the ceiling is a dado: tiling to
--                          it, paint above it — both lines move together.
--
-- Additive: null everywhere, so wet tiling is unchanged; wall paint on walls that
-- bound only wet rooms drops to the band above their tiled height (zero at full
-- height) on the next regenerate.

alter table public.rooms
  add column if not exists tiled_height_m numeric null
    check (tiled_height_m is null or (tiled_height_m >= 0 and tiled_height_m <= 10));

notify pgrst, 'reload schema';

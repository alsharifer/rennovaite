-- 061_room_ceiling_height.sql — a room's own ceiling height, and the plan made
-- from one room's dimensions (bathroom pilot B1).
--
-- Until now no room stored a height: buildPlanGraph gave every roofed room the
-- 2.9 m default (flagged derived), and every wall area — wet-room tiling,
-- plaster, paint — was perimeter × 2.9. The pilot bathroom is 2.80 m, measured;
-- at 2.9 its wall tiling is overstated by ~3.5 %.
--
--   rooms.ceiling_h_m        metres, null = not stated (the graph keeps the
--                            2.9 m default, derived — exactly as before).
--   rooms.ceiling_h_source   'measured' | 'derived' — how the stored value was
--                            got. A value with no source reads as measured
--                            (someone typed it); null with no value.
--   plans.intake             'room_dimensions' = the plan was made from one
--                            room's typed L × W × H ("One room from its
--                            dimensions"). Null for every other plan.
--
-- Additive: no existing room has a height, so every BoQ regenerates unchanged.

alter table public.rooms
  add column if not exists ceiling_h_m numeric null
    check (ceiling_h_m is null or (ceiling_h_m > 0 and ceiling_h_m <= 10));

alter table public.rooms
  add column if not exists ceiling_h_source text null
    check (ceiling_h_source is null or ceiling_h_source in ('measured', 'derived'));

alter table public.plans
  add column if not exists intake text null
    check (intake is null or intake in ('room_dimensions'));

notify pgrst, 'reload schema';

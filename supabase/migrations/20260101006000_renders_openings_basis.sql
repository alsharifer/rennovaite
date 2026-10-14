-- 060_renders_openings_basis.sql — which openings shaped an off-plan render (R10b).
--
-- Detected openings feed the renders at once, labelled: a render built while
-- some of its room's openings were still unconfirmed says so. The record is
-- per render because the plan moves on after it (an opening confirmed or
-- removed later does not change what the picture was built from).
--
--   renders.openings_basis  { confirmed, detected, ids } — null = the render
--                           was built from no opening (photo path, or a room
--                           with none recorded).
--
-- Additive.

alter table public.renders
  add column if not exists openings_basis jsonb;

notify pgrst, 'reload schema';

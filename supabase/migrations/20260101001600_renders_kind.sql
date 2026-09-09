-- 016_renders_kind.sql — Pilot Seven / P3 3D viewer.
--
-- Adds a `kind` discriminator to renders so the 3D viewer can distinguish a
-- flat still ('still', the default) from a 2:1 equirectangular panorama
-- ('pano') to display inside an inverted sphere. Pano GENERATION is not built
-- in P3 — this column only lets the viewer branch when panos later exist.
--
-- Manual apply: no migration runner — paste into the Supabase SQL editor.

alter table public.renders
  add column if not exists kind text not null default 'still';

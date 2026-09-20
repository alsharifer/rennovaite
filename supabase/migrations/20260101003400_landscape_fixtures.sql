-- 034_landscape_fixtures.sql — discrete landscape items as plan fixtures (G3).
--
-- A standalone planter box, an arched wall feature and a built-in BBQ grill are
-- priced per unit. They are not zones (a zone is a surface), not runs (a run is
-- measured in linear metres), and not electrical or plumbing points. They are
-- simply things standing in one place, which is exactly what plan_fixtures
-- already models — so they reuse that table, its API and its editor rather than
-- getting a fourth shape of their own.
--
-- The only change the table needs is a third layer. `type` is already free text.

alter table public.plan_fixtures drop constraint if exists plan_fixtures_layer_check;
alter table public.plan_fixtures drop constraint if exists plan_fixtures_layer_chk;
alter table public.plan_fixtures add constraint plan_fixtures_layer_chk
  check (layer in ('electrical', 'plumbing', 'landscape'));

notify pgrst, 'reload schema';

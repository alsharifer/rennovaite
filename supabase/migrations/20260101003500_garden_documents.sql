-- 035_garden_documents.sql — what the garden document pack needs to say (G4).
--
-- Three additive columns, each carrying a fact a deliverable has to be able to
-- state rather than imply.
--
-- 1. rooms.area_derived_m2 / rooms.derived_note — the part of a zone's area that
--    was APPROXIMATED rather than read off the drawing, and why. A curved lawn
--    edge traced as a quadrant is a real approximation on a real m² figure; a
--    dimensioned drawing that prints that area must be able to say so, and the
--    flag has to live on the zone or it is lost the first time the plan is
--    re-read.
--
-- 2. renders.view — which view of a zone a render is ('day' | 'evening'). The
--    render pack pairs a day render with its evening counterpart; inferring that
--    from prompt text would break the first time somebody tweaks a render.
--    NULL = a render made before views existed, treated as the day view.
--
-- 3. boq_outcomes.delta_lines — the per-line comparison behind a delta-log
--    entry: class, reason, and the corroborating evidence where there is some.
--    capture_gap_notes is prose; a delta whose reasoning only survives as prose
--    cannot be queried, re-checked or carried into the next calibration.

alter table public.rooms add column if not exists area_derived_m2 numeric;
alter table public.rooms add column if not exists derived_note text;

alter table public.renders add column if not exists view text;
alter table public.renders drop constraint if exists renders_view_chk;
alter table public.renders add constraint renders_view_chk
  check (view is null or view in ('day', 'evening'));

alter table public.boq_outcomes add column if not exists delta_lines jsonb;

notify pgrst, 'reload schema';

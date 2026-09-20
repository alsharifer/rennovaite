-- 040_session_capture.sql — the design session's record (garden pilot G5d).
--
-- The first working session with a landscape firm is pilot DATA, not notes:
--
--   boq_corrections
--     correction_type — adds 'confirm': "the BoQ looks right" is a milestone the
--                       metric must count, not a non-event
--     attributed_to   — the firm that made the correction. Their identity lives on
--                       their own corrections and nowhere else (never on a rate
--                       book row, never on a client document)
--     confidence      — firm | estimate, as they stated it
--     session_ref     — which session/record it came from (e.g. "three-firms #1")
--   pilot_events
--     kind            — adds 'session_decision' (a Sheet B/C answer applied) and
--                       'correction' (a Sheet D row captured)
--   plan_context
--     spec            — what stands BEYOND a boundary wall (neighbour | street |
--                       open), read by the 3D scene so a render's surroundings come
--                       from the plan instead of a default

alter table public.boq_corrections drop constraint if exists boq_corrections_type_chk;
alter table public.boq_corrections add constraint boq_corrections_type_chk
  check (correction_type in ('rate', 'quantity', 'scope', 'design', 'confirm'));
alter table public.boq_corrections add column if not exists attributed_to text;
alter table public.boq_corrections add column if not exists confidence text;
alter table public.boq_corrections add column if not exists session_ref text;
alter table public.boq_corrections drop constraint if exists boq_corrections_confidence_chk;
alter table public.boq_corrections add constraint boq_corrections_confidence_chk
  check (confidence is null or confidence in ('firm', 'estimate'));

alter table public.pilot_events drop constraint if exists pilot_events_kind_chk;
alter table public.pilot_events add constraint pilot_events_kind_chk
  check (kind in ('plan_started', 'plan_saved', 'design_edit', 'boq_generated', 'pack_exported', 'friction', 'session_decision', 'correction'));

alter table public.plan_context add column if not exists spec jsonb;

notify pgrst, 'reload schema';

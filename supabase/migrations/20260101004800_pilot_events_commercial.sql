-- 048_pilot_events_commercial.sql — per-firm commercial instrumentation (L5 / U6).
--
-- pilot_events was the garden pilot's own record (037): per project, authored
-- plans only, kind-checked, with everything else inside `detail`. The
-- three-firms pilot needs to answer, PER FIRM: how long to a first BoQ, how long
-- from the first generation to the export (prep + checking), how many
-- corrections of which type and where they landed (the firm's book vs the
-- project), and how much support it took. So:
--
--   firm_id      the firm the event belongs to (the project's firm, or the
--                firm itself for a rate-book event that has no project);
--   actor        the signed-in account that caused it (null = a script or our
--                own run — the distinction the pilot turns on);
--   session_ref  the working-session record ("three-firms #1 — …");
--   duration_ms  how long the thing took, where the writer measured it;
--   stage        promoted from detail.stage to a column (the exclusion filters
--                read it); a backfill script fills it for old rows;
--   project_id   NULLABLE — a rate-book change is a firm event with no project.
--
-- New kinds: boq_viewed (a signed-in view of the BoQ — the checking signal),
-- support_touch (a help request, an intervention, a reported error),
-- rate_book_change (entry / promotion / retirement / quote accept — a
-- correction that "landed in the book"), approval_recorded (U4),
-- basis_accepted (L4). pack_exports gains `actor` for the same reason.
--
-- Additive only: no row is changed here (the backfill is a script, so what it
-- can and cannot recover is stated per row, not hidden in DDL).

alter table public.pilot_events alter column project_id drop not null;
alter table public.pilot_events
  add column if not exists firm_id      uuid references public.firms(id) on delete set null,
  add column if not exists actor        uuid,
  add column if not exists session_ref  text,
  add column if not exists duration_ms  integer,
  add column if not exists stage        text;

alter table public.pilot_events drop constraint if exists pilot_events_kind_chk;
alter table public.pilot_events add constraint pilot_events_kind_chk
  check (kind in (
    'plan_started', 'plan_saved', 'design_edit', 'boq_generated', 'pack_exported', 'friction', 'session_decision', 'correction',
    'boq_viewed', 'support_touch', 'rate_book_change', 'approval_recorded', 'basis_accepted'
  ));
alter table public.pilot_events drop constraint if exists pilot_events_scope_chk;
alter table public.pilot_events add constraint pilot_events_scope_chk
  check (project_id is not null or firm_id is not null);
create index if not exists pilot_events_firm_idx on public.pilot_events (firm_id, recorded_at);
create index if not exists pilot_events_actor_idx on public.pilot_events (actor, recorded_at) where actor is not null;

alter table public.pack_exports add column if not exists actor uuid;

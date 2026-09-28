-- 049_pilot_events_scope_fix.sql — a firm can be deleted again (UV finding).
--
-- 048 added `pilot_events_scope_chk` (project_id is not null or firm_id is not
-- null) beside a firm_id foreign key that SETS NULL when the firm is deleted.
-- A firm-level event (a rate-book change: project_id null, firm_id set) therefore
-- made its firm undeletable: the set-null violated the check, and
-- DELETE /api/firms/:id failed with 23514 for any firm that had entered a rate,
-- promoted a correction or accepted a quotation since 048. The UV live checks'
-- cleanup steps caught it.
--
-- The check is dropped. A firm-level event whose firm is later deleted keeps
-- its kind and detail with both keys null — history of an entity that no longer
-- exists, which the rollups ignore (they group by firm_id). Nothing else changes.

alter table public.pilot_events drop constraint if exists pilot_events_scope_chk;

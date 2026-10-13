-- 058_rooms_in_scope.sql — which rooms this renovation covers (K12, spec §7.4, Figma 81:716).
--
-- Until now every room on the plan was priced, rendered and scheduled. An owner
-- renovating the bedrooms but not the terraces had no way to say so — and
-- inferring scope from "which rooms were rendered" couples two unrelated
-- decisions (people renovate bathrooms they never render).
--
--   rooms.in_scope   true (default) = in this renovation. An out-of-scope room
--                    stays on the plan (the plan graph's scale and the overlap
--                    check need every room) but contributes no room-level
--                    quantities, renders or timeline work. Whole-home work
--                    (project preliminaries and approvals, demolition from the
--                    proposed plan, the aluminium allowance, fixtures not placed
--                    in a room) stays — lib/plan/scope.ts says which and why.
--                    Chosen on 01 Plan (PATCH /api/plan-scope); takes effect on
--                    the next regenerate, which is a new revision.
--
-- Additive: every existing room is in scope, so every BoQ regenerates unchanged.

alter table public.rooms
  add column if not exists in_scope boolean not null default true;

notify pgrst, 'reload schema';

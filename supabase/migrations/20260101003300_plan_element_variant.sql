-- 033_plan_element_variant.sql — which kind of counter a counter run is (G3).
--
-- `plan_elements.kind` says a run is a counter. It does not say whether it is a
-- bar counter or a BBQ counter, and those differ by AED 968 per linear metre —
-- the BBQ one carries a sink, water, drainage and sockets, which is also what
-- makes its rate inclusive of MEP and stops those points being counted twice.
--
-- Until somebody chooses, the take-off prices the cheaper of the two and flags
-- the line `needs_selection`. Nullable on purpose: null IS the unanswered
-- state, and it has to be distinguishable from a deliberate "bar".

alter table public.plan_elements add column if not exists variant text;

alter table public.plan_elements drop constraint if exists plan_elements_variant_chk;
alter table public.plan_elements add constraint plan_elements_variant_chk
  check (variant is null or variant in ('bar', 'bbq'));

comment on column public.plan_elements.variant is
  'Counter runs only: bar | bbq. NULL = not yet chosen, priced as bar and flagged needs_selection.';

notify pgrst, 'reload schema';

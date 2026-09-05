-- 029_plan_overlaps.sql — record overlap state on the plan (D3).
--
-- Overlapping rooms are a legitimate TRANSIENT state while editing: dragging a
-- room across another creates one, and refusing the save would put unsaved work
-- one refresh away from being lost. So the save always succeeds — it just
-- records what it saw.
--
-- The harm from overlaps is double-counted floor and wall area, and that
-- happens at TAKE-OFF. So enforcement lives at BoQ generation (409), not at the
-- save. These two columns are what let the generation path refuse without
-- re-deriving geometry, and what make the problem measurable across the estate.
--
--   has_overlaps  — true when the last save saw overlapping rooms.
--   overlap_pairs — [{a_id,a_name,b_id,b_name}], the offending pairs, so the
--                   banner and the 409 can name them without recomputing.
--
-- Both are NULLABLE with no default: null means "never assessed" (every plan
-- saved before this migration), which is deliberately distinct from false
-- ("assessed, clean"). The generation path treats null as unknown and assesses
-- it live rather than assuming either way.
--
-- Manual apply: no migration runner — paste into the Supabase SQL editor.
-- Service-role JWT cannot run DDL. Additive only; the app degrades to live
-- assessment until it is applied.

alter table public.plans add column if not exists has_overlaps boolean;
alter table public.plans add column if not exists overlap_pairs jsonb;
alter table public.plans add column if not exists overlaps_checked_at timestamptz;

-- Finding the plans that cannot currently produce a BoQ should be one index hit.
create index if not exists plans_has_overlaps_idx
  on public.plans (has_overlaps)
  where has_overlaps = true;

notify pgrst, 'reload schema';

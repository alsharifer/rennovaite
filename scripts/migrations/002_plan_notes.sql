-- =============================================================================
-- OBSOLETE — DO NOT APPLY THIS FILE BY HAND.
--
-- Superseded by supabase/migrations/ and `supabase db push` (I7).
-- Kept only as the historical record of how production was built.
-- See docs/MIGRATIONS.md.
-- =============================================================================
-- Adds a free-text notes column to plans, used to capture user-supplied
-- corrections to the auto-parsed floorplan ("the kitchen is much smaller", etc.).

alter table public.plans
  add column if not exists notes text;

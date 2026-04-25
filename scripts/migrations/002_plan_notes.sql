-- Adds a free-text notes column to plans, used to capture user-supplied
-- corrections to the auto-parsed floorplan ("the kitchen is much smaller", etc.).

alter table public.plans
  add column if not exists notes text;

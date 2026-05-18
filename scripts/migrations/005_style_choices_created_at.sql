-- The original style_choices table didn't track creation time. Adding it
-- so the project dashboard can show "Completed 12 Mar 2026" for the Style
-- phase symmetrically with Plan / Render / BoQ, and so we can pick the
-- latest project-level style choice deterministically.

alter table public.style_choices
  add column if not exists created_at timestamptz default now();

-- Backfill anything existing with `now()` since we don't know the real
-- creation time. Idempotent (re-running over already-populated rows
-- keeps the existing values).
update public.style_choices
   set created_at = now()
 where created_at is null;

notify pgrst, 'reload schema';

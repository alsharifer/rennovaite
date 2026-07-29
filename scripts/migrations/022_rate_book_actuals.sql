-- 022_rate_book_actuals.sql — ground-truth ingest (Mudon actuals).
--
-- Extends rate_book so a rate can carry its pre-discount list price, its supply/
-- install scope (prevents double-counting install labour), and a provenance rank
-- that lets contract-actual rates outrank seed defaults without yet being
-- qs_validated. Existing rows are untouched (columns are nullable / defaulted);
-- the reseed SUPERSEDES via a newer valid_from rather than deleting.
--
-- Manual apply: no runner — paste into the Supabase SQL editor.

alter table public.rate_book
  add column if not exists list_rate_aed numeric,           -- pre-discount list rate (net stays in rate_aed)
  add column if not exists scope text,                      -- supply_only | install_only | supply_and_install
  add column if not exists provenance text not null default 'seed';

-- Guard the enumerations (idempotent — drop first so re-runs don't error).
alter table public.rate_book drop constraint if exists rate_book_scope_chk;
alter table public.rate_book add constraint rate_book_scope_chk
  check (scope is null or scope in ('supply_only', 'install_only', 'supply_and_install'));

alter table public.rate_book drop constraint if exists rate_book_provenance_chk;
alter table public.rate_book add constraint rate_book_provenance_chk
  check (provenance in ('seed', 'indicative', 'actual_transaction'));

-- Resolution reads the newest valid_from per (city, item_key, grade, scope), so
-- index that path.
create index if not exists rate_book_supersede_idx
  on public.rate_book (city, item_key, grade, valid_from desc);

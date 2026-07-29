-- 018_rate_book.sql — Pilot Seven / P5 what-if rate book.
--
-- QS-validated Dubai rates per (work_section, item_key, grade). Seeded from the
-- grade→spec mapping (lib/whatif/grades.ts), which is derived from labour-rates
-- .csv + the pricing_skus SKU catalogue. `source` is the transparency moat —
-- every rate cites where it came from. Manual apply: paste into the Supabase
-- SQL editor, then run `npx tsx scripts/seed-rate-book.ts`.

create table if not exists public.rate_book (
  id uuid primary key default gen_random_uuid(),
  city text not null default 'Dubai',
  work_section text not null,
  item_key text not null,
  grade text not null check (grade in ('economy', 'standard', 'premium')),
  unit text not null,
  rate_aed numeric not null,
  source text not null,
  qs_validated boolean not null default false,
  valid_from date default now()
);

create index if not exists rate_book_item_grade_idx
  on public.rate_book (city, item_key, grade);

alter table public.rate_book disable row level security;

-- 045_firm_quotes.sql — a supplier / contractor quotation becomes private rates,
-- through a record and a review, never a wipe (L2 / U3).
--
--   firm_quotes        the quote as a RECORD: who (a label the firm chose — it
--                      reaches no client document; the BoQ line says "contractor
--                      rate book (supplier quotation)"), reference, date,
--                      validity, currency, VAT treatment, whether the rates are
--                      net or list and the discount — so the rate that enters
--                      the book can be derived and shown derived. The uploaded
--                      file's name and sha256 are recorded; the file is not stored.
--                      Re-importing the same quote (same firm + reference, or the
--                      same file) creates a NEW version that names the one it
--                      supersedes; the old record and its lines stay.
--   firm_quote_lines   every row the parser saw, matched or not. A line is
--                      `unmatched` until a MEMBER confirms an item_key (a
--                      suggestion is stored, never applied on its own); it is
--                      `rejected` if the member says so; `accepted` once a rate
--                      was created from it (entry_id). Nothing is dropped:
--                      unparseable rates, foreign currencies and unknown items
--                      are held with a hold_reason.
--   firm_rate_entries  origin gains 'quote_import'; quote_id / quote_line_id
--                      trace the rate to its row. Supersession replaces
--                      deletion: an entry that a later import (or, in U4, a later
--                      promotion) replaces gets superseded_at / superseded_by and
--                      stays. The uniqueness rule becomes "one ACTIVE entry per
--                      firm / key / grade / origin" — a partial index — so history
--                      can coexist with the current rate.
--
-- The seeders' delete-before-insert pattern is deliberately absent here: no
-- statement in this migration or in lib/quotes deletes a rate entry.

create table if not exists public.firm_quotes (
  id                   uuid primary key default gen_random_uuid(),
  firm_id              uuid not null references public.firms(id) on delete cascade,
  supplier_label       text not null,
  supplier_role        text not null default 'supplier',
  quote_ref            text,
  quote_date           date,
  valid_until          date,
  currency             text not null default 'AED',
  vat_treatment        text not null default 'excl',
  rates_are            text not null default 'net',
  discount_pct         numeric not null default 0,
  source_filename      text,
  source_sha256        text,
  status               text not null default 'review',
  version              integer not null default 1,
  supersedes_quote_id  uuid references public.firm_quotes(id) on delete set null,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  accepted_at          timestamptz
);
alter table public.firm_quotes drop constraint if exists firm_quotes_role_chk;
alter table public.firm_quotes add constraint firm_quotes_role_chk
  check (supplier_role in ('supplier', 'contractor', 'manufacturer', 'other'));
alter table public.firm_quotes drop constraint if exists firm_quotes_vat_chk;
alter table public.firm_quotes add constraint firm_quotes_vat_chk
  check (vat_treatment in ('excl', 'incl', 'unknown'));
alter table public.firm_quotes drop constraint if exists firm_quotes_rates_chk;
alter table public.firm_quotes add constraint firm_quotes_rates_chk
  check (rates_are in ('net', 'list'));
alter table public.firm_quotes drop constraint if exists firm_quotes_discount_chk;
alter table public.firm_quotes add constraint firm_quotes_discount_chk
  check (discount_pct >= 0 and discount_pct < 100);
alter table public.firm_quotes drop constraint if exists firm_quotes_status_chk;
alter table public.firm_quotes add constraint firm_quotes_status_chk
  check (status in ('review', 'accepted', 'superseded'));
create index if not exists firm_quotes_firm_idx on public.firm_quotes (firm_id, created_at desc);
alter table public.firm_quotes disable row level security;

create table if not exists public.firm_quote_lines (
  id                  uuid primary key default gen_random_uuid(),
  quote_id            uuid not null references public.firm_quotes(id) on delete cascade,
  firm_id             uuid not null references public.firms(id) on delete cascade,
  row_no              integer not null,
  description         text not null,
  item_key_given      text,
  suggested_item_key  text,
  suggestion_score    numeric,
  item_key            text,
  grade               text,
  kind                text,
  qty                 numeric,
  unit                text,
  rate_raw            numeric,
  currency            text,
  rate_aed            numeric,
  status              text not null default 'unmatched',
  hold_reason         text,
  entry_id            uuid references public.firm_rate_entries(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table public.firm_quote_lines drop constraint if exists firm_quote_lines_status_chk;
alter table public.firm_quote_lines add constraint firm_quote_lines_status_chk
  check (status in ('matched', 'unmatched', 'rejected', 'accepted'));
alter table public.firm_quote_lines drop constraint if exists firm_quote_lines_grade_chk;
alter table public.firm_quote_lines add constraint firm_quote_lines_grade_chk
  check (grade is null or grade in ('economy', 'standard', 'premium'));
alter table public.firm_quote_lines drop constraint if exists firm_quote_lines_kind_chk;
alter table public.firm_quote_lines add constraint firm_quote_lines_kind_chk
  check (kind is null or kind in ('labour', 'supply', 'supply_and_install', 'lump'));
create index if not exists firm_quote_lines_quote_idx on public.firm_quote_lines (quote_id, row_no);
alter table public.firm_quote_lines disable row level security;

-- Entries: a third origin, the trace to the quote, and supersession instead of deletion.
alter table public.firm_rate_entries
  add column if not exists quote_id       uuid references public.firm_quotes(id) on delete set null,
  add column if not exists quote_line_id  uuid,
  add column if not exists superseded_at  timestamptz,
  add column if not exists superseded_by  uuid references public.firm_rate_entries(id) on delete set null;
alter table public.firm_rate_entries drop constraint if exists firm_rate_entries_origin_chk;
alter table public.firm_rate_entries add constraint firm_rate_entries_origin_chk
  check (origin in ('firm_entry', 'promoted_correction', 'quote_import'));
drop index if exists public.firm_rate_entries_key_uidx;
create unique index if not exists firm_rate_entries_key_uidx
  on public.firm_rate_entries (firm_id, item_key, coalesce(grade, '*'), origin)
  where superseded_at is null;
create index if not exists firm_rate_entries_quote_idx on public.firm_rate_entries (quote_id);

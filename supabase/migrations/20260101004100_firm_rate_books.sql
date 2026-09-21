-- 041_firm_rate_books.sql — private firm rate books as an OVERLAY (L1).
--
-- A firm (a contractor or landscape firm) keeps its own rates — labour, supplier
-- prices, a supply-and-install composite — and its own OH&P. Those rates SHADOW
-- the reference rate for that firm's projects only. The reference book
-- (`rate_book`) is never modified by anything here.
--
--   firms                 who the firm is. `private` defaults true. The name lives
--                         HERE and nowhere a client document reads: a firm's rate
--                         reaches a BoQ line as a neutral label ("contractor rate
--                         book"), never as a name. This is where 040's
--                         `boq_corrections.attributed_to` free text normalises to.
--   firm_rate_books       one book per firm; carries the OH&P percentage, which is
--                         applied at BoQ assembly as its own visible line — never
--                         baked into a unit rate.
--   firm_rate_entries     the overlay rows. `grade` null = every grade. `origin`:
--                           firm_entry          a rate the firm entered itself
--                           promoted_correction a market_fair correction the firm
--                                               made, EXPLICITLY promoted into its
--                                               book (`correction_id` traces it)
--                         `firm_id` is denormalised from the book so every read can
--                         be scoped by it directly.
--   projects.firm_id      the firm whose book prices this project. null = the
--                         reference book only (every project before L1).
--   boq_corrections       firm_id (normalised attributed_to), promoted_at,
--                         promoted_entry_id. A correction is still RECORDED, never
--                         applied, until it is promoted.
--
-- Backfill: one firm per distinct attributed_to, and the corrections linked to it.
-- No book and no entries are created — no firm has a private book until one is
-- written, so every BoQ regenerates unchanged.

create table if not exists public.firms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  private     boolean not null default true,
  created_by  text,
  created_at  timestamptz not null default now()
);
create unique index if not exists firms_name_uidx on public.firms (lower(btrim(name)));
alter table public.firms disable row level security;

create table if not exists public.firm_rate_books (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null unique references public.firms(id) on delete cascade,
  ohp_pct     numeric not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.firm_rate_books drop constraint if exists firm_rate_books_ohp_chk;
alter table public.firm_rate_books add constraint firm_rate_books_ohp_chk
  check (ohp_pct >= 0 and ohp_pct <= 50);
alter table public.firm_rate_books disable row level security;

create table if not exists public.firm_rate_entries (
  id             uuid primary key default gen_random_uuid(),
  book_id        uuid not null references public.firm_rate_books(id) on delete cascade,
  firm_id        uuid not null references public.firms(id) on delete cascade,
  item_key       text not null,
  grade          text,
  unit           text not null,
  rate_aed       numeric not null,
  kind           text not null,
  origin         text not null default 'firm_entry',
  correction_id  uuid references public.boq_corrections(id) on delete set null,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.firm_rate_entries drop constraint if exists firm_rate_entries_grade_chk;
alter table public.firm_rate_entries add constraint firm_rate_entries_grade_chk
  check (grade is null or grade in ('economy', 'standard', 'premium'));
alter table public.firm_rate_entries drop constraint if exists firm_rate_entries_rate_chk;
alter table public.firm_rate_entries add constraint firm_rate_entries_rate_chk
  check (rate_aed >= 0);
alter table public.firm_rate_entries drop constraint if exists firm_rate_entries_kind_chk;
alter table public.firm_rate_entries add constraint firm_rate_entries_kind_chk
  check (kind in ('labour', 'supply', 'supply_and_install', 'lump'));
alter table public.firm_rate_entries drop constraint if exists firm_rate_entries_origin_chk;
alter table public.firm_rate_entries add constraint firm_rate_entries_origin_chk
  check (origin in ('firm_entry', 'promoted_correction'));
-- One entry per (firm, key, grade, origin); null grade compared as its own value.
create unique index if not exists firm_rate_entries_key_uidx
  on public.firm_rate_entries (firm_id, item_key, coalesce(grade, '*'), origin);
create index if not exists firm_rate_entries_book_idx on public.firm_rate_entries (book_id);
alter table public.firm_rate_entries disable row level security;

alter table public.projects add column if not exists firm_id uuid references public.firms(id) on delete set null;

alter table public.boq_corrections add column if not exists firm_id uuid references public.firms(id) on delete set null;
alter table public.boq_corrections add column if not exists promoted_at timestamptz;
alter table public.boq_corrections add column if not exists promoted_entry_id uuid references public.firm_rate_entries(id) on delete set null;

-- Backfill: normalise the free-text attribution.
insert into public.firms (name, private, created_by)
select distinct on (lower(btrim(attributed_to))) btrim(attributed_to), true, 'migration 041 (boq_corrections.attributed_to)'
from public.boq_corrections
where attributed_to is not null and btrim(attributed_to) <> ''
order by lower(btrim(attributed_to)), recorded_at
on conflict do nothing;

update public.boq_corrections c
set firm_id = f.id
from public.firms f
where c.firm_id is null
  and c.attributed_to is not null
  and lower(btrim(c.attributed_to)) = lower(btrim(f.name));

notify pgrst, 'reload schema';

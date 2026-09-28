-- 047_firm_branding_reference_basis.sql — the firm's client-facing proposal (L4).
--
-- BRANDING. A proposal a firm sends its own client carries the FIRM's brand:
-- the name the firm chooses its client sees (display_name; the registered
-- `name` stays what it is), a logo (a file in the plan-uploads bucket at
-- firms/<firm>/…, referenced by path so the URL is derived like every other
-- asset), and a free-text terms block. RennovAIte appears on such a document
-- only as a discreet "prepared with" mark.
--
-- REFERENCE BASIS. A BoQ whose lines resolved below the firm's own book (tier 1)
-- is priced from the market reference. A client-facing proposal on such a BoQ
-- is refused until the firm's book is `reviewed` (U2) OR the firm explicitly
-- ACCEPTS the reference basis for that BoQ revision — recorded here as an
-- event, append-only, so the fallback is a stated choice and never a silent
-- default. An acceptance names the boq revision it covers: a regenerated BoQ
-- needs its own.

alter table public.firms
  add column if not exists display_name  text,
  add column if not exists logo_path     text,
  add column if not exists terms_text    text;

create table if not exists public.reference_basis_acceptances (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  firm_id       uuid not null references public.firms(id) on delete cascade,
  boq_id        uuid not null references public.boqs(id) on delete cascade,
  accepted_by   uuid,
  reference_lines integer not null default 0,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists reference_basis_acceptances_boq_idx on public.reference_basis_acceptances (project_id, boq_id, created_at);
alter table public.reference_basis_acceptances disable row level security;

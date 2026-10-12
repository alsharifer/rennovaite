-- 053_proposals.sql — the proposal's setup (K4, R7 §3.7, Figma 23:689).
--
-- FIRM DEFAULTS. What a firm writes once and reuses on every proposal: how long
-- a proposal is valid, its payment terms, and whether its client sees line
-- rates. Line rates default OFF — the client sees the scope and section totals;
-- the firm's book stays private unless the firm chooses otherwise.
--
-- PER PROJECT. What belongs to one proposal: the client as the cover names them
-- (printed on the cover only, never shared), the cover note, and this
-- proposal's own validity / payment terms / line-rate choice — copied from the
-- firm's defaults when the setup is first saved, then the project's own. One
-- row per project; the revision it is generated from is the BoQ the export
-- regenerates, so it is not stored here.

alter table public.firms
  add column if not exists proposal_validity_days   integer check (proposal_validity_days is null or proposal_validity_days between 1 and 365),
  add column if not exists proposal_payment_terms   text,
  add column if not exists proposal_show_line_rates boolean not null default false;

create table if not exists public.project_proposals (
  project_id      uuid primary key references public.projects(id) on delete cascade,
  firm_id         uuid references public.firms(id) on delete set null,
  client_label    text,
  validity_days   integer check (validity_days is null or validity_days between 1 and 365),
  payment_terms   text,
  cover_note      text,
  show_line_rates boolean not null default false,
  updated_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.project_proposals disable row level security;

-- 028_accessories.sql — accessory / spec selection (backlog D1, D1b).
--
-- Until now the accessory categories (lighting, sanitary, sockets & switches,
-- AC/heating) were priced entirely by R-xx rules with no user choice. This adds
-- the catalogue those rules can be overridden from, and the per-project record
-- of what was chosen.
--
--   accessory_catalog     — one row per selectable item. `item_key` is the BoQ
--                           item the row prices, so a selection swaps exactly
--                           one line's rate source. `spec_class` follows the
--                           P8 spec-class vocabulary (economy | standard |
--                           premium) — a CLASS, not a price band: exposed vs
--                           concealed shower are different classes, not one
--                           item at two prices.
--   accessory_selections  — one row per (project, item_key). Deleting the row
--                           returns that line to its rule-derived default.
--
-- SCOPE is carried per item and matters: a `supply_and_install` row must never
-- spawn a separate install line (the S-pack invariant in lib/boq/scope.ts). The
-- engine emits exactly one line per item_key, so selection cannot create a
-- second line — the constraint below keeps the DATA honest so that stays true.
--
-- ATTRIBUTES are jsonb and deliberately sparse where we have no real source.
-- Sanitary attributes come from the Laspinas 46703 quotation (the Mudon
-- actuals); AC/electrical/lighting from the verified pricing_skus vendor
-- catalogue. Anything unknown is ABSENT, never invented — the compare view
-- renders a missing attribute as "—".
--
-- Manual apply: no migration runner — paste into the Supabase SQL editor.
-- Service-role JWT cannot run DDL. All code degrades gracefully until applied:
-- the picker shows rule defaults only and the BoQ is unchanged.

create table if not exists public.accessory_catalog (
  id            uuid primary key default gen_random_uuid(),
  -- lighting | sanitary | electrical_points | hvac
  category      text not null,
  -- The BoQ item_key this row prices (e.g. 'san.basin', 'hvac.office_split').
  item_key      text not null,
  spec_class    text not null,
  name          text not null,
  brand         text,
  model_code    text,
  rate_aed      numeric not null,
  unit          text not null default 'no',
  -- supply_only | install_only | supply_and_install (lib/boq/scope.ts)
  scope         text not null default 'supply_and_install',
  -- seed | indicative | actual_transaction (matches rate_book provenance)
  provenance    text not null default 'seed',
  -- Human-readable origin of the rate, shown in the picker and the BoQ line.
  source        text,
  -- Optional linkage into rate_book for QS-validated pricing.
  rate_book_item_key text,
  qs_validated  boolean not null default false,
  -- Technical attributes. Sparse by design; see the header note.
  attributes    jsonb not null default '{}'::jsonb,
  -- true = this row reproduces what the R-xx rule already assumed.
  is_rule_default boolean not null default false,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);

alter table public.accessory_catalog drop constraint if exists accessory_catalog_category_chk;
alter table public.accessory_catalog add constraint accessory_catalog_category_chk
  check (category in ('lighting', 'sanitary', 'electrical_points', 'hvac'));

alter table public.accessory_catalog drop constraint if exists accessory_catalog_spec_chk;
alter table public.accessory_catalog add constraint accessory_catalog_spec_chk
  check (spec_class in ('economy', 'standard', 'premium'));

alter table public.accessory_catalog drop constraint if exists accessory_catalog_scope_chk;
alter table public.accessory_catalog add constraint accessory_catalog_scope_chk
  check (scope in ('supply_only', 'install_only', 'supply_and_install'));

alter table public.accessory_catalog drop constraint if exists accessory_catalog_prov_chk;
alter table public.accessory_catalog add constraint accessory_catalog_prov_chk
  check (provenance in ('seed', 'indicative', 'actual_transaction'));

-- The engine emits ONE line per item_key. An install_only accessory row would
-- therefore have no supply line to pair with and would double-count against the
-- labour section, so it is rejected outright rather than flagged at read time.
alter table public.accessory_catalog drop constraint if exists accessory_catalog_no_install_only_chk;
alter table public.accessory_catalog add constraint accessory_catalog_no_install_only_chk
  check (scope <> 'install_only');

create index if not exists accessory_catalog_item_idx
  on public.accessory_catalog (item_key, spec_class, sort_order);
create index if not exists accessory_catalog_category_idx
  on public.accessory_catalog (category, sort_order);

-- Re-seeding must be idempotent: one row per (item_key, model/name).
create unique index if not exists accessory_catalog_uniq
  on public.accessory_catalog (item_key, coalesce(model_code, name));

-- One selection per (project, item_key). Absence = the rule default applies.
create table if not exists public.accessory_selections (
  project_id        uuid not null references public.projects(id) on delete cascade,
  item_key          text not null,
  catalog_item_id   uuid not null references public.accessory_catalog(id) on delete cascade,
  selected_at       timestamptz not null default now(),
  primary key (project_id, item_key)
);

create index if not exists accessory_selections_project_idx
  on public.accessory_selections (project_id);

-- What-if scenarios may carry their own accessory selections alongside the
-- existing grade selections, so a scenario can price a different spec set
-- without disturbing the project's own choices.
alter table public.whatif_scenarios
  add column if not exists accessory_selections jsonb;

alter table public.accessory_catalog    disable row level security;
alter table public.accessory_selections disable row level security;

notify pgrst, 'reload schema';

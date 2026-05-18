-- =============================================================================
-- 006: Pricing SKUs + Labour rates
-- =============================================================================
-- Two reference tables that feed the BoQ engine. They're seeded from QS-vetted
-- data (vendor catalogues, public benchmarks) and read-only at runtime — the
-- BoQ generator looks up rates here, multiplies by quantities, groups by POMI
-- work section, and totals. Disabling RLS for the PoC; both tables are non-PII
-- pricing data the app needs from any context.
-- =============================================================================

-- Materials catalogue. One row per SKU per vendor. Same physical product
-- carried by multiple vendors should be multiple rows so we can compare.
create table if not exists public.pricing_skus (
  id              uuid primary key default gen_random_uuid(),
  sku             text,
  brand           text,
  category        text,
  subcategory     text,
  description_en  text,
  description_ar  text,
  unit            text,
  price_aed       numeric,
  vendor          text,
  source_url      text,
  photo_url       text,
  lead_time_days  integer,
  in_stock        boolean default true,
  last_verified   date
);

create index if not exists pricing_skus_category_idx       on public.pricing_skus(category);
create index if not exists pricing_skus_subcategory_idx    on public.pricing_skus(subcategory);
create index if not exists pricing_skus_vendor_idx         on public.pricing_skus(vendor);

alter table public.pricing_skus disable row level security;


-- Labour rates per POMI work section. Three-band pricing (low/mid/high)
-- captures the Dubai contractor spread; the BoQ generator picks `mid` by
-- default and exposes low/high so the customer can flex.
create table if not exists public.labour_rates (
  id            uuid primary key default gen_random_uuid(),
  work_section  text,
  description   text,
  unit          text,
  rate_low_aed  numeric,
  rate_mid_aed  numeric,
  rate_high_aed numeric,
  source        text,
  notes         text
);

create index if not exists labour_rates_work_section_idx on public.labour_rates(work_section);

alter table public.labour_rates disable row level security;


-- Tell PostgREST to pick up both new tables without a project restart.
notify pgrst, 'reload schema';

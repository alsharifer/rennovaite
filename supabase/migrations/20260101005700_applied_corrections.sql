-- 057_applied_corrections.sql — a price added on review, and corrections that apply (K11 #4, spec §7.3).
--
-- Until now a correction was RECORDED, never applied (J3 rule): it changed
-- neither the BoQ nor any rate book until a firm promoted it and regenerated.
-- Abdallah's walkthrough (13 Oct) found that an owner could see a line "to be
-- priced" and had no way to price it. Spec §7.3 supersedes the rule:
--
--   "Add a price"        an unpriced line takes the member's rate with its
--                        basis (a supplier's quote / a contractor's price / my
--                        own estimate + note) and enters the NEXT revision as
--                        your price (tier own basis);
--   "Apply to this BoQ"  a rate or quantity correction does the same; "Save for
--                        review only" keeps today's behaviour.
--
-- The record that makes it reproducible is the correction row itself:
--
--   origin              'correction' (captured) | 'add_price' (priced on review)
--   basis_kind          'supplier_quote' | 'contractor_price' | 'own_estimate'
--   line_key            the line's STABLE identity (lib/boq/line-identity.ts,
--                       `${section}|${identity}[#n]`) — survives regeneration
--   line_ref            the REF the line had when the correction was made
--   applied_boq_id      the revision the application created; applied_from_boq_id
--                       the one it was applied onto; applied_at / applied_by /
--                       applied_by_name (the name the revision diff prints:
--                       "Price added by <name>")
--   reverted_at / reverted_by / reverted_by_boq_id
--                       undone by "Revert to rev N" in Revisions — the
--                       correction stays on record, it simply stops applying.
--
-- An applied, un-reverted correction is re-applied by every later
-- regeneration (lib/boq/own-basis.ts in lib/boq/assemble.ts), so a regenerated
-- BoQ never silently drops a price someone added. Additive: no existing row
-- changes meaning (every existing correction is origin 'correction', unapplied).

alter table public.boq_corrections
  add column if not exists origin text not null default 'correction',
  add column if not exists basis_kind text,
  add column if not exists line_key text,
  add column if not exists line_ref text,
  add column if not exists applied_boq_id uuid references public.boqs(id) on delete set null,
  add column if not exists applied_from_boq_id uuid references public.boqs(id) on delete set null,
  add column if not exists applied_at timestamptz,
  add column if not exists applied_by uuid,
  add column if not exists applied_by_name text,
  add column if not exists reverted_at timestamptz,
  add column if not exists reverted_by uuid,
  add column if not exists reverted_by_boq_id uuid references public.boqs(id) on delete set null;

alter table public.boq_corrections drop constraint if exists boq_corrections_origin_chk;
alter table public.boq_corrections add constraint boq_corrections_origin_chk
  check (origin in ('correction', 'add_price'));
alter table public.boq_corrections drop constraint if exists boq_corrections_basis_kind_chk;
alter table public.boq_corrections add constraint boq_corrections_basis_kind_chk
  check (basis_kind is null or basis_kind in ('supplier_quote', 'contractor_price', 'own_estimate'));
-- Only a figure can be applied: a rate or a quantity, with its new value.
alter table public.boq_corrections drop constraint if exists boq_corrections_applied_chk;
alter table public.boq_corrections add constraint boq_corrections_applied_chk
  check (applied_boq_id is null or (correction_type in ('rate', 'quantity') and new_value is not null and line_key is not null));

create index if not exists boq_corrections_applied_idx on public.boq_corrections (project_id, applied_at) where applied_boq_id is not null and reverted_at is null;

notify pgrst, 'reload schema';

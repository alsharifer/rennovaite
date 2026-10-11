-- 051_rate_book_integrity.sql — one active entry per item + the magnitude hold (H8).
--
-- 1. ONE ACTIVE ENTRY PER ITEM. The 045 index was unique on
--    (firm_id, item_key, grade, ORIGIN) where active, so a typed entry, a quote
--    import and a promoted correction could all be active for one item — the J0
--    test book had two active garden.pcc_base (96.00 typed, 98.50 imported) and
--    two wall_plaster (44.00, 48.00). The resolver priced the typed one
--    (firm_entry > quote_import > promoted_correction), silently.
--    The rule now: one active entry per (firm, item_key, grade), whatever its
--    origin or kind — the resolver ignores kind, so two kinds active would be
--    the same ambiguity. A NEW entry for the same item/grade SUPERSEDES the old
--    one (history kept: superseded_at / superseded_by / retired_by /
--    retire_reason). grade null ("all grades") and a named grade stay distinct:
--    the resolver uses the named grade where it exists.
--
--    Existing duplicates are resolved to exactly what pricing used before:
--    the resolver's winner stays active, the rest are superseded by it.
--
-- 2. replace_firm_entry(): every way an entry enters a book (typed entry, edit,
--    quote accept) supersedes-and-inserts in ONE transaction, so a failed insert
--    can no longer leave the item with no active rate. promote_correction() now
--    supersedes the active entry of ANY origin for its key/grade.
--
-- 3. Quote lines carry what the magnitude hold needs: the sheet's own unit
--    (the item confirm overwrites `unit` with the vocabulary unit), the
--    reference figure and ratio the check saw, and an explicit outlier
--    confirmation (who, when) — recorded as an event too.
--
-- Additive except the superseding in step 1, which only retires rows pricing
-- never used.

-- 1a. Resolve today's duplicates to the resolver's winner.
with ranked as (
  select id,
         row_number() over w as rn,
         first_value(id) over w as winner
    from public.firm_rate_entries
   where superseded_at is null
  window w as (
    partition by firm_id, item_key, coalesce(grade, '*')
    order by case origin when 'firm_entry' then 1 when 'quote_import' then 2 else 3 end,
             created_at desc, id
  )
)
update public.firm_rate_entries e
   set superseded_at = now(),
       superseded_by = r.winner,
       retire_reason = 'superseded — one active entry per item (H8, migration 051)',
       updated_at = now()
  from ranked r
 where e.id = r.id
   and r.rn > 1;

-- 1b. The rule, in the database.
drop index if exists public.firm_rate_entries_key_uidx;
create unique index if not exists firm_rate_entries_active_uidx
  on public.firm_rate_entries (firm_id, item_key, coalesce(grade, '*'))
  where superseded_at is null;

-- 2a. Supersede-and-insert, atomically.
create or replace function public.replace_firm_entry(
  p_firm_id        uuid,
  p_item_key       text,
  p_grade          text,
  p_unit           text,
  p_rate           numeric,
  p_kind           text,
  p_origin         text,
  p_note           text,
  p_actor          uuid,
  p_retire_reason  text,
  p_quote_id       uuid default null,
  p_quote_line_id  uuid default null,
  p_correction_id  uuid default null,
  p_also_retire    uuid default null,
  p_also_reason    text default null
) returns jsonb
language plpgsql
as $$
declare
  b_id    uuid;
  old_id  uuid;
  new_id  uuid;
  now_ts  timestamptz := now();
begin
  insert into public.firm_rate_books (firm_id, ohp_pct) values (p_firm_id, 0)
    on conflict (firm_id) do nothing;
  select id into b_id from public.firm_rate_books where firm_id = p_firm_id;

  -- The active entry this one replaces (any origin, any kind).
  select id into old_id
    from public.firm_rate_entries
   where firm_id = p_firm_id
     and item_key = p_item_key
     and coalesce(grade, '*') = coalesce(p_grade, '*')
     and superseded_at is null
     for update;
  if old_id is not null then
    update public.firm_rate_entries
       set superseded_at = now_ts, retired_by = p_actor, retire_reason = p_retire_reason, updated_at = now_ts
     where id = old_id;
  end if;

  -- An edit that moves an entry to another grade also retires the row it edits.
  if p_also_retire is not null and p_also_retire is distinct from old_id then
    update public.firm_rate_entries
       set superseded_at = now_ts, retired_by = p_actor,
           retire_reason = coalesce(p_also_reason, p_retire_reason), updated_at = now_ts
     where id = p_also_retire and firm_id = p_firm_id and superseded_at is null;
    if not found then
      raise exception using errcode = 'P0001', message = 'entry_retired';
    end if;
  end if;

  insert into public.firm_rate_entries
    (book_id, firm_id, item_key, grade, unit, rate_aed, kind, origin, correction_id, quote_id, quote_line_id, note, created_by)
  values
    (b_id, p_firm_id, p_item_key, p_grade, p_unit, p_rate, p_kind, p_origin, p_correction_id, p_quote_id, p_quote_line_id, p_note, p_actor)
  returning id into new_id;

  update public.firm_rate_entries set superseded_by = new_id
   where id in (old_id, p_also_retire) and id is not null;
  update public.firm_rate_books
     set status = 'draft', reviewed_at = null, updated_at = now_ts
   where id = b_id and status = 'reviewed';

  return jsonb_build_object('entry_id', new_id, 'superseded_entry_id', old_id, 'also_retired_id', p_also_retire);
end
$$;

-- 2b. A promotion supersedes the active entry of ANY origin for its key/grade
--     (046 superseded only an earlier promotion, so it could sit beside a
--     typed or imported rate). Body otherwise unchanged from 046.
create or replace function public.promote_correction(
  p_firm_id        uuid,
  p_correction_id  uuid,
  p_actor          uuid,
  p_rate           numeric,
  p_unit           text,
  p_kind           text,
  p_grade          text,
  p_note           text
) returns jsonb
language plpgsql
as $$
declare
  c       record;
  b_id    uuid;
  old_id  uuid;
  new_id  uuid;
  now_ts  timestamptz := now();
begin
  select id, firm_id, correction_type, item_key, promoted_at
    into c
    from public.boq_corrections
   where id = p_correction_id
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'correction_not_found';
  end if;
  if c.firm_id is distinct from p_firm_id then
    raise exception using errcode = 'P0001', message = 'not_this_firms_correction';
  end if;
  if c.correction_type <> 'rate' then
    raise exception using errcode = 'P0001', message = 'not_a_rate';
  end if;
  if c.item_key is null then
    raise exception using errcode = 'P0001', message = 'no_item_key';
  end if;
  if c.promoted_at is not null then
    raise exception using errcode = 'P0001', message = 'already_promoted';
  end if;

  insert into public.firm_rate_books (firm_id, ohp_pct) values (p_firm_id, 0)
    on conflict (firm_id) do nothing;
  select id into b_id from public.firm_rate_books where firm_id = p_firm_id;

  -- H8: the active entry for the same key/grade — whatever its origin — is
  -- superseded, not removed.
  select id into old_id
    from public.firm_rate_entries
   where firm_id = p_firm_id
     and item_key = c.item_key
     and coalesce(grade, '*') = coalesce(p_grade, '*')
     and superseded_at is null
     for update;
  if old_id is not null then
    update public.firm_rate_entries
       set superseded_at = now_ts, retired_by = p_actor,
           retire_reason = 'superseded by a promoted correction', updated_at = now_ts
     where id = old_id;
  end if;

  insert into public.firm_rate_entries
    (book_id, firm_id, item_key, grade, unit, rate_aed, kind, origin, correction_id, note, created_by)
  values
    (b_id, p_firm_id, c.item_key, p_grade, p_unit, p_rate, p_kind, 'promoted_correction', c.id, p_note, p_actor)
  returning id into new_id;

  if old_id is not null then
    update public.firm_rate_entries set superseded_by = new_id where id = old_id;
  end if;
  update public.boq_corrections
     set promoted_at = now_ts, promoted_entry_id = new_id
   where id = c.id;
  update public.firm_rate_books
     set status = 'draft', reviewed_at = null, updated_at = now_ts
   where id = b_id and status = 'reviewed';

  return jsonb_build_object('entry_id', new_id, 'superseded_entry_id', old_id);
end
$$;

-- 3. The magnitude hold on quote lines.
alter table public.firm_quote_lines add column if not exists unit_given text;
alter table public.firm_quote_lines add column if not exists reference_rate_aed numeric;
alter table public.firm_quote_lines add column if not exists magnitude_ratio numeric;
alter table public.firm_quote_lines add column if not exists conversion_note text;
alter table public.firm_quote_lines add column if not exists outlier_confirmed_at timestamptz;
alter table public.firm_quote_lines add column if not exists outlier_confirmed_by uuid references auth.users(id) on delete set null;
-- The sheet's unit for lines imported before 051 (a confirmed line's `unit` may
-- already be the vocabulary's; that is the best record there is).
update public.firm_quote_lines set unit_given = unit where unit_given is null;

notify pgrst, 'reload schema';

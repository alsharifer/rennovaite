-- 046_promotion_history_approvals.sql — promotion supersede-with-history, and
-- the approval trail (L3 / U4).
--
-- PROMOTION. Until now promoting a correction for an item/grade that already
-- had a promoted rate was a 409, the way out was to DELETE the old entry, and a
-- hard delete left the correction's promoted_at set — so it could never be
-- promoted again and the old rate was gone without trace. Three changes:
--
--   promote_correction()   ONE transaction: lock the correction, refuse the
--                          cases that must be refused, retire the active
--                          promoted entry for the same firm/key/grade
--                          (superseded_at / superseded_by / retired_by — kept),
--                          insert the new one, link the correction, return the
--                          book to draft. Nothing in it deletes.
--   created_by / retired_by / retire_reason
--                          who made and who retired an entry — the trail's
--                          who/what/when. (superseded_at / superseded_by came
--                          with 045; the partial unique index on active rows
--                          already lets history coexist with the current rate.)
--   retire, never delete   the store's DELETE now retires; a retired
--                          promotion clears its correction's promoted_at so the
--                          correction is re-promotable (application code).
--
-- APPROVALS. A BoQ revision can be marked approved by the FIRM (a signed-in
-- member) and a CLIENT approval can be RECORDED as an event — the client is not
-- a user; the firm enters the name and date it was given. Both are rows in the
-- trail; nothing here changes a BoQ.

alter table public.firm_rate_entries
  add column if not exists created_by     uuid,
  add column if not exists retired_by     uuid,
  add column if not exists retire_reason  text;

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

  -- The active promotion for the same key/grade is superseded, not removed.
  select id into old_id
    from public.firm_rate_entries
   where firm_id = p_firm_id
     and item_key = c.item_key
     and origin = 'promoted_correction'
     and coalesce(grade, '*') = coalesce(p_grade, '*')
     and superseded_at is null
     for update;
  if old_id is not null then
    update public.firm_rate_entries
       set superseded_at = now_ts, retired_by = p_actor,
           retire_reason = 'superseded by a later promotion', updated_at = now_ts
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

create table if not exists public.boq_approvals (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  boq_id        uuid not null references public.boqs(id) on delete cascade,
  firm_id       uuid references public.firms(id) on delete set null,
  kind          text not null,
  approved_by   uuid,
  client_name   text,
  client_date   date,
  note          text,
  created_at    timestamptz not null default now()
);
alter table public.boq_approvals drop constraint if exists boq_approvals_kind_chk;
alter table public.boq_approvals add constraint boq_approvals_kind_chk check (kind in ('firm', 'client'));
alter table public.boq_approvals drop constraint if exists boq_approvals_client_chk;
alter table public.boq_approvals add constraint boq_approvals_client_chk
  check (kind <> 'client' or (client_name is not null and client_date is not null));
create index if not exists boq_approvals_project_idx on public.boq_approvals (project_id, created_at);
alter table public.boq_approvals disable row level security;

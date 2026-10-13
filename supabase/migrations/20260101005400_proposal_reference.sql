-- 054_proposal_reference.sql — the proposal's reference (K9, K8 review).
--
-- A proposal a firm issues carries ITS reference: a per-firm sequence,
-- "<PREFIX>-P-0001", stored on the project's proposal row (053). It is
-- assigned ONCE, the first time the proposal is issued through the gated
-- export, and every later export of that project's proposal reuses it — so a
-- run that fails its printed checks never burns a number and a re-issue keeps
-- the reference the client already holds. The in-app preview (NOT ISSUED)
-- never assigns one.
--
-- The prefix is the firm's: derived from its brand at the first issue (the
-- app passes it) and kept on `firms.proposal_prefix` from then on, so renaming
-- the firm does not change the series. `proposal_seq` is the last number used.
-- A reference is unique within its firm (two firms may share a prefix).
--
-- If the project moves to another firm, that firm's first issue assigns a
-- reference from ITS series; the old one stays only in the pack manifests.

alter table public.firms
  add column if not exists proposal_prefix text check (proposal_prefix is null or proposal_prefix ~ '^[A-Z0-9]{2,6}$'),
  add column if not exists proposal_seq    integer not null default 0 check (proposal_seq >= 0);

alter table public.project_proposals
  add column if not exists reference             text,
  add column if not exists reference_firm_id     uuid references public.firms(id) on delete set null,
  add column if not exists reference_assigned_at timestamptz;

create unique index if not exists project_proposals_reference_uidx
  on public.project_proposals (reference_firm_id, reference)
  where reference is not null;

-- ONE transaction: lock the project's row (creating it when the setup was
-- never saved), return its reference when this firm already issued one,
-- otherwise take the firm's next number. The firm row's UPDATE serialises
-- concurrent issues across the firm's projects.
create or replace function public.assign_proposal_reference(p_project uuid, p_firm uuid, p_prefix text)
returns text
language plpgsql
as $$
declare
  v_ref      text;
  v_ref_firm uuid;
  v_prefix   text;
  v_seq      integer;
begin
  insert into public.project_proposals (project_id, firm_id)
  values (p_project, p_firm)
  on conflict (project_id) do nothing;

  select reference, reference_firm_id into v_ref, v_ref_firm
  from public.project_proposals
  where project_id = p_project
  for update;

  if v_ref is not null and v_ref_firm = p_firm then
    return v_ref;
  end if;

  update public.firms
  set proposal_prefix = coalesce(proposal_prefix, p_prefix),
      proposal_seq    = proposal_seq + 1
  where id = p_firm
  returning proposal_prefix, proposal_seq into v_prefix, v_seq;

  if v_seq is null then
    raise exception 'firm_not_found' using errcode = 'P0002';
  end if;

  -- lpad would TRUNCATE past 9999; a longer number prints in full.
  v_ref := v_prefix || '-P-' || case when v_seq < 10000 then lpad(v_seq::text, 4, '0') else v_seq::text end;

  update public.project_proposals
  set reference = v_ref, reference_firm_id = p_firm, reference_assigned_at = now()
  where project_id = p_project;

  return v_ref;
end;
$$;

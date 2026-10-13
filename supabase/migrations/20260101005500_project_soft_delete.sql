-- 055_project_soft_delete.sql — rename · archive · delete, safely (K10 #1, spec §6.12).
--
-- Until now `DELETE /api/projects/:id` let ANY project member hard-delete a
-- project instantly, and the files it had written (plans, photos, renders,
-- packs, drawings) stayed in Storage for ever. Now:
--
--   projects.deleted_at / deleted_by   a delete is SOFT: the project moves to
--                                      "Recently deleted" for 30 days. Every
--                                      project read path and route treats a
--                                      deleted project as not found (the same
--                                      404 a non-member gets for a page). A
--                                      member can restore it exactly as it was.
--   projects.created_by                who may delete an OWNER project (no
--                                      firm): its creator. Backfilled from the
--                                      project's earliest member.
--   firm_members.role                  who may delete a FIRM project: a firm
--                                      admin. The firm's creator is its admin
--                                      (firms.created_by holds an e-mail or a
--                                      user id); a firm with no admin after
--                                      that gets its earliest member, so no
--                                      firm is left without one.
--
-- A daily purge (/api/cron/projects-purge) hard-deletes projects deleted more
-- than 30 days ago and removes their Storage objects; "Delete now" does the
-- same at once for the same roles. Additive: no existing row changes meaning.

alter table public.projects
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists created_by uuid;

create index if not exists projects_deleted_at_idx on public.projects (deleted_at) where deleted_at is not null;

update public.projects p
set created_by = m.user_id
from (
  select distinct on (project_id) project_id, user_id
  from public.project_members
  order by project_id, created_at asc, user_id
) m
where m.project_id = p.id and p.created_by is null;

alter table public.firm_members
  add column if not exists role text not null default 'member' check (role in ('admin', 'member'));

update public.firm_members fm
set role = 'admin'
from public.firms f
left join auth.users u on lower(u.email) = lower(f.created_by)
where f.id = fm.firm_id
  and (fm.user_id::text = f.created_by or fm.user_id = u.id);

update public.firm_members fm
set role = 'admin'
from (
  select distinct on (firm_id) firm_id, user_id
  from public.firm_members
  where firm_id not in (select firm_id from public.firm_members where role = 'admin')
  order by firm_id, created_at asc, user_id
) x
where fm.firm_id = x.firm_id and fm.user_id = x.user_id;

notify pgrst, 'reload schema';

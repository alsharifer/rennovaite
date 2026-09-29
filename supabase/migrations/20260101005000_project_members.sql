-- 050_project_members.sql — who may touch a project (H5).
--
-- Until now every project route ran on the service role and answered any
-- signed-in caller (H1): the project id in a request was the only credential.
-- This mirrors firm_members (043), no teams and no roles:
--
--   project_members  (project_id, user_id) — a project belongs to one or more
--                    accounts. Creating a project (upload, draw-plan) makes the
--                    creator a member. Membership is required for every
--                    project-scoped route and page. The check is APPLICATION
--                    CODE (lib/projects/access.ts → authorizeProject): the routes
--                    keep the service-role client, which bypasses RLS, so a
--                    policy here would protect nothing. RLS stays disabled like
--                    every table.
--
-- Backfill: every existing project to the pilot owner's account (Abdallah), by
-- e-mail, where that account exists in THIS database. Production has it; the dev
-- database has only the script accounts, so there the backfill adds nothing and
-- scripts/project-member-add.mjs grants membership once the account exists.
-- A project with no member is unreachable through the app — the intended state
-- for a project nobody owns.

create table if not exists public.project_members (
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_members_user_idx on public.project_members (user_id);
alter table public.project_members disable row level security;

insert into public.project_members (project_id, user_id)
select p.id, u.id
from public.projects p
join auth.users u on lower(u.email) = 'alsharifer@gmail.com'
on conflict do nothing;

notify pgrst, 'reload schema';

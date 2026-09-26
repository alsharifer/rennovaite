-- 043_firm_members.sql — who may act for a firm (U1).
--
-- Until now every firm route ran on the service role and answered anyone: the
-- id in the path was the only "credential", and cross-firm access failed by
-- scoping (404) rather than by authentication. This is the minimal ownership
-- model, no teams and no roles yet:
--
--   firm_members   (firm_id, user_id) — a firm belongs to one or more accounts.
--                  Creating a firm makes the creator a member. Membership is
--                  required for every /api/firms/:id/* route and for attaching
--                  a firm to a project. The check is APPLICATION CODE
--                  (lib/firms/store.ts → requireFirm): the routes keep using the
--                  service-role client, which bypasses RLS, so a policy here
--                  would protect nothing. RLS stays disabled like every table.
--
-- Backfill: none. The one firm 041 created (Newspace, from attributed_to) has no
-- account yet, so it has no member and is unreachable through the API until one
-- is added (scripts/firm-member-add.mjs <firm-id> <email>, service role). That is
-- the intended state: a firm nobody owns should not be operable by everybody.

create table if not exists public.firm_members (
  firm_id     uuid not null references public.firms(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (firm_id, user_id)
);
create index if not exists firm_members_user_idx on public.firm_members (user_id);
alter table public.firm_members disable row level security;

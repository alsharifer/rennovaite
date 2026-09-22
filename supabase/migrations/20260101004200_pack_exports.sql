-- 042_pack_exports.sql — one gated path for every client document (T5).
--
-- A pack export is a JOB: the in-app "Export pack" action and
-- scripts/garden-draft-pack.ts both create one and run the same module
-- (lib/documents/pack-export). The job row is also the only credential the
-- document routes accept for a PDF: a request without a running job's id gets
-- no document, so there is no ungated output path.
--
--   status    queued → running → passed | blocked | failed
--             blocked = a readiness gate stopped it before any document was made
--                       (undecided / untyped / unpriced scope, no client name);
--             failed  = documents were made but a printed-content check failed —
--                       nothing is released;
--             passed  = every gate held; outputs are downloadable.
--   progress  { step, pct, note, log[] } for the progress UI
--   checklist the readable gate verdict (what to fix, where)
--   manifest  checks, gate table, parity, consistency, mix, metrics, baseline
--   outputs   [{ name, path, bytes, sha256 }] in the private `packs` bucket
--             (projects/<project>/<job>/<file>), or a local path for a CLI run
--
-- Nothing reads this table until PACK_EXPORT_ENABLED is on.

create table if not exists public.pack_exports (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  source       text not null default 'app',
  status       text not null default 'queued',
  options      jsonb not null default '{}'::jsonb,
  progress     jsonb not null default '{}'::jsonb,
  checklist    jsonb,
  manifest     jsonb,
  outputs      jsonb not null default '[]'::jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
alter table public.pack_exports drop constraint if exists pack_exports_status_chk;
alter table public.pack_exports add constraint pack_exports_status_chk
  check (status in ('queued', 'running', 'passed', 'blocked', 'failed'));
alter table public.pack_exports drop constraint if exists pack_exports_source_chk;
alter table public.pack_exports add constraint pack_exports_source_chk
  check (source in ('app', 'cli'));
create index if not exists pack_exports_project_idx on public.pack_exports (project_id, created_at desc);
alter table public.pack_exports disable row level security;

-- Private bucket for the released documents; downloads are signed URLs.
insert into storage.buckets (id, name, public)
values ('packs', 'packs', false)
on conflict (id) do nothing;

notify pgrst, 'reload schema';

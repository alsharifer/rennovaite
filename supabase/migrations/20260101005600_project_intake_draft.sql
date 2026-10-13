-- 056_project_intake_draft.sql — a project created by an abandoned upload is a draft (K11 #1, spec §7).
--
-- Uploading a plan on the intake (/project/new) creates the project at once —
-- the parse needs a row to write to — before the owner has pressed Continue,
-- and often before they have typed its name. Abdallah's pilot walkthrough
-- (13 Oct) found it listed on Projects as "Untitled", and every upload the
-- owner abandoned stayed there for ever.
--
--   projects.draft_since   set when the intake's plan upload creates the
--                          project; cleared by Continue (POST
--                          /api/projects/:id/intake), which also writes the
--                          typed name and city. A draft is hidden from
--                          Projects; the daily purge job soft-deletes drafts
--                          older than 24 h (deleted_at — reversible, and kept
--                          out of "Recently deleted": nobody saw it), after
--                          which the 30-day purge rule applies as for any
--                          deleted project.
--
-- Additive: every existing project is not a draft (null).

alter table public.projects
  add column if not exists draft_since timestamptz;

create index if not exists projects_draft_since_idx on public.projects (draft_since) where draft_since is not null;

notify pgrst, 'reload schema';

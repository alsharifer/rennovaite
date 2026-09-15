-- 038_project_display_name.sql — the name a client reads (garden pilot G5).
--
-- projects.name is the working name the team and the scripts use ("Villa 94
-- garden (ground truth)", "Arabella Garden — Draft for Review"). A document a
-- client or a prospect reads needs its own name: a completed reference garden
-- must not be labelled "ground truth" on its cover, and the client project's
-- cover name is decided before the final pack. Documents read
-- display_name when it is set and fall back to name.

alter table public.projects add column if not exists display_name text;

notify pgrst, 'reload schema';

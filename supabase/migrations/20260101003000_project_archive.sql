-- 030_project_archive.sql — archive a project without deleting it.
--
-- The project list accumulates: exploratory parses, half-finished tests, one-off
-- uploads. The instinct is to delete them, but a parsed plan with renders and a
-- generated BoQ is calibration data — the business case rests on having MORE
-- completed projects to calibrate against, not fewer. Deleting them to tidy a
-- list is a bad trade.
--
-- So: hide, never destroy. `archived_at` null = active (the default, so every
-- existing project stays visible). Non-null = hidden from the list behind a
-- "Show archived" toggle, and the timestamp records when.
--
-- Additive and reversible: un-archiving is `set archived_at = null`. Nothing
-- reads this column except the project list, so an archived project remains
-- fully readable by direct link, and every downstream table is untouched.
--
-- Manual apply: no migration runner — paste into the Supabase SQL editor.
-- Service-role JWT cannot run DDL.

alter table public.projects add column if not exists archived_at timestamptz;

-- The list filters on "not archived", which is the overwhelmingly common read.
create index if not exists projects_active_idx
  on public.projects (created_at desc)
  where archived_at is null;

notify pgrst, 'reload schema';

-- Stores Replicate-generated renders for the AI Designer step. Each render
-- belongs to a (project, room) tuple. parent_render_id threads a "tweak":
-- when the user types "make the rug darker", that creates a new render whose
-- parent points to the previous one.

create table if not exists public.renders (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid references public.projects(id) on delete cascade,
  room_id           uuid references public.rooms(id)    on delete cascade,
  prompt            text,
  image_url         text,
  parent_render_id  uuid references public.renders(id)  on delete set null,
  created_at        timestamptz       default now()
);

create index if not exists renders_project_id_idx       on public.renders(project_id);
create index if not exists renders_room_id_idx          on public.renders(room_id);
create index if not exists renders_parent_render_id_idx on public.renders(parent_render_id);

alter table public.renders disable row level security;

-- Tell PostgREST to pick up the new table without a project restart.
notify pgrst, 'reload schema';

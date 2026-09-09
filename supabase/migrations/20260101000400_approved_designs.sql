-- Tracks which render the user has approved per (project, room). Multiple
-- rows per room are allowed — the latest by created_at is the "active"
-- approval. The BoQ step reads from here to know which render's materials
-- to cost.

create table if not exists public.approved_designs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references public.projects(id) on delete cascade,
  room_id     uuid references public.rooms(id)    on delete cascade,
  render_id   uuid references public.renders(id)  on delete cascade,
  created_at  timestamptz       default now()
);

create index if not exists approved_designs_project_id_idx on public.approved_designs(project_id);
create index if not exists approved_designs_room_id_idx    on public.approved_designs(room_id);
create index if not exists approved_designs_render_id_idx  on public.approved_designs(render_id);

alter table public.approved_designs disable row level security;

notify pgrst, 'reload schema';

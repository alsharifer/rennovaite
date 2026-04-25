-- RennovAIte initial schema

create extension if not exists pgcrypto;

-- projects
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz       default now(),
  city        text              default 'Dubai',
  currency    text              default 'AED',
  budget_aed  integer,
  status      text              default 'draft',
  name        text
);

-- plans
create table if not exists public.plans (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid references public.projects(id) on delete cascade,
  pdf_url        text,
  parsed_json    jsonb,
  total_area_m2  numeric,
  scale          text,
  created_at     timestamptz      default now()
);

-- rooms
create table if not exists public.rooms (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid references public.plans(id) on delete cascade,
  name_en    text,
  name_ar    text,
  room_type  text,
  area_m2    numeric,
  polygon    jsonb
);

-- style_choices
create table if not exists public.style_choices (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references public.projects(id) on delete cascade,
  style_key   text,
  room_id     uuid references public.rooms(id)    on delete cascade
);

-- boqs
create table if not exists public.boqs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references public.projects(id) on delete cascade,
  total_aed   numeric,
  sections    jsonb,
  locked_at   timestamptz,
  created_at  timestamptz      default now()
);

-- foreign-key indexes
create index if not exists plans_project_id_idx         on public.plans(project_id);
create index if not exists rooms_plan_id_idx            on public.rooms(plan_id);
create index if not exists style_choices_project_id_idx on public.style_choices(project_id);
create index if not exists style_choices_room_id_idx    on public.style_choices(room_id);
create index if not exists boqs_project_id_idx          on public.boqs(project_id);

-- RLS disabled for now (auth comes later)
alter table public.projects      disable row level security;
alter table public.plans         disable row level security;
alter table public.rooms         disable row level security;
alter table public.style_choices disable row level security;
alter table public.boqs          disable row level security;

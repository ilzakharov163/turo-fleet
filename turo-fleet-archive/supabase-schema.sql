-- Cars table
create table cars (
  id uuid primary key default gen_random_uuid(),
  make text not null,
  model text not null,
  plate text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  inactive_reason text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Car blocks (inactive periods in calendar)
create table car_blocks (
  id uuid primary key default gen_random_uuid(),
  car_id uuid references cars(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- Expenses
create table expenses (
  id uuid primary key default gen_random_uuid(),
  car_id uuid references cars(id) on delete cascade,
  title text not null,
  amount numeric(10,2) not null,
  date date not null,
  files text[] default '{}',
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Maintenance
create table maintenance (
  id uuid primary key default gen_random_uuid(),
  car_id uuid references cars(id) on delete cascade unique,
  oil_change_date date,
  oil_change_miles integer,
  notes text,
  updated_at timestamptz default now()
);

-- Team members (app-level, separate from auth.users)
create table team_members (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text,
  role text not null default 'operator',
  invited_by uuid references auth.users(id),
  invited_at timestamptz default now(),
  joined_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'active'))
);

-- Activity log
create table activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  user_email text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb default '{}',
  created_at timestamptz default now()
);

-- Storage bucket for receipts
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false);

-- RLS policies (allow all authenticated users full access)
alter table cars enable row level security;
alter table car_blocks enable row level security;
alter table expenses enable row level security;
alter table maintenance enable row level security;
alter table team_members enable row level security;
alter table activity_log enable row level security;

create policy "auth users full access" on cars for all to authenticated using (true) with check (true);
create policy "auth users full access" on car_blocks for all to authenticated using (true) with check (true);
create policy "auth users full access" on expenses for all to authenticated using (true) with check (true);
create policy "auth users full access" on maintenance for all to authenticated using (true) with check (true);
create policy "auth users full access" on team_members for all to authenticated using (true) with check (true);
create policy "auth users full access" on activity_log for all to authenticated using (true) with check (true);

create policy "auth users can upload receipts" on storage.objects for insert to authenticated with check (bucket_id = 'receipts');
create policy "auth users can read receipts" on storage.objects for select to authenticated using (bucket_id = 'receipts');
create policy "auth users can delete receipts" on storage.objects for delete to authenticated using (bucket_id = 'receipts');

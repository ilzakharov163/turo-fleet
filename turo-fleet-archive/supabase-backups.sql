-- Резервные копии базы (применено миграцией backups_daily, 23.10.2026).
-- Каждый день в 10:00 UTC pg_cron вызывает make_backup('auto'): снимок всех таблиц приложения
-- в public.backups (jsonb). Хранятся 30 последних автокопий и 10 ручных. Смотреть/скачивать — Настройки → Резервные копии (только админ).
-- Файлы чеков (storage receipts) в копию не входят — только пути к ним.

create extension if not exists pg_cron;

create table if not exists public.backups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null default 'manual' check (kind in ('auto', 'manual')),
  created_by uuid,
  rows int not null default 0,
  data jsonb not null
);
alter table public.backups enable row level security;
create policy "admin read" on public.backups for select to authenticated using (is_admin());
create policy "admin delete" on public.backups for delete to authenticated using (is_admin());

create or replace function public.make_backup(p_kind text default 'manual')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t text;
  snap jsonb := '{}'::jsonb;
  part jsonb;
  total int := 0;
  new_id uuid;
begin
  if auth.uid() is not null and not is_admin() then
    raise exception 'Только администратор может делать резервные копии';
  end if;
  foreach t in array array['cars','car_blocks','expenses','claims','sticker_cars','sticker_changes',
    'revenue_accounts','revenue_cars','revenue_entries','revenue_month_expenses','revenue_payments',
    'tracker_archive','profiles','team_members','maintenance','activity_log'] loop
    execute format('select coalesce(jsonb_agg(x), ''[]''::jsonb) from public.%I x', t) into part;
    snap := snap || jsonb_build_object(t, part);
    total := total + jsonb_array_length(part);
  end loop;
  insert into backups (kind, created_by, rows, data)
  values (case when p_kind = 'auto' then 'auto' else 'manual' end, auth.uid(), total,
          jsonb_build_object('created_at', now(), 'tables', snap))
  returning id into new_id;
  delete from backups where kind = 'auto' and id not in (select id from backups where kind = 'auto' order by created_at desc limit 30);
  delete from backups where kind = 'manual' and id not in (select id from backups where kind = 'manual' order by created_at desc limit 10);
  return new_id;
end $$;

revoke execute on function public.make_backup(text) from public, anon;
grant execute on function public.make_backup(text) to authenticated;

select cron.schedule('daily-backup', '0 10 * * *', $$select public.make_backup('auto')$$);

-- 23.10.2026, миграция cars_removed_from: с какого месяца машины нет в парке (продана/разбита)
alter table public.cars add column if not exists removed_from date;

-- 23.10.2026, миграция salary_deductions: вычеты из зарплаты работника (date, reason, amount, car_id).
-- RLS: читают /cars,/dashboard,/reports,/income; пишут /cars. Таблица добавлена в make_backup.

-- 23.10.2026, миграция revenue_entries_payment: платёж за машину в месяц (null — не задан, 0 — нет)
alter table public.revenue_entries add column if not exists payment numeric;

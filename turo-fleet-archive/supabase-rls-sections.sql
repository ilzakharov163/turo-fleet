-- Доступ к данным по разделам (галочки в «Команде» = profiles.permissions).
-- Админ видит всё. Не-админ без отмеченных разделов = только '/expenses' (как в Sidebar).

create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid())
$$;

create or replace function public.can_any(sections text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and (p.role = 'admin'
        or (case when coalesce(array_length(p.permissions, 1), 0) = 0 then array['/expenses'] else p.permissions end) && sections)
  )
$$;

revoke execute on function public.is_member() from public, anon;
revoke execute on function public.can_any(text[]) from public, anon;
grant execute on function public.is_member() to authenticated;
grant execute on function public.can_any(text[]) to authenticated;

-- Служебные функции не должны вызываться снаружи
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
alter function public.update_updated_at_column() set search_path = public;

-- Убираем старые «полный доступ всем вошедшим»
drop policy if exists "auth users full access" on public.car_blocks;
drop policy if exists "auth users full access" on public.maintenance;
drop policy if exists "auth users full access" on public.team_members;
drop policy if exists "auth users full access" on public.activity_log;
drop policy if exists "auth users full access" on public.cars;
drop policy if exists "auth users full access on sticker_cars" on public.sticker_cars;
drop policy if exists "auth users full access" on public.expenses;
drop policy if exists "auth users full access on claims" on public.claims;
drop policy if exists "auth users full access on sticker_changes" on public.sticker_changes;
drop policy if exists "auth users full access" on public.revenue_accounts;
drop policy if exists "auth users full access" on public.revenue_cars;
drop policy if exists "auth users full access" on public.revenue_entries;
drop policy if exists "auth users full access" on public.revenue_month_expenses;
drop policy if exists "auth users read" on public.tracker_archive;
drop policy if exists "auth users full access" on public.revenue_payments;

-- Машины: список видят все сотрудники (нужен для подписи записей), менять — «Авто»; номер меняют и «Наклейки»
create policy "section read" on public.cars for select to authenticated using (is_member());
create policy "section insert" on public.cars for insert to authenticated with check (can_any('{/cars}'));
create policy "section update" on public.cars for update to authenticated using (can_any('{/cars,/stickers}')) with check (can_any('{/cars,/stickers}'));
create policy "section delete" on public.cars for delete to authenticated using (can_any('{/cars}'));

-- Простои
create policy "section read" on public.car_blocks for select to authenticated using (can_any('{/calendar,/cars,/dashboard,/income,/reports}'));
create policy "section write" on public.car_blocks for all to authenticated using (can_any('{/calendar,/cars}')) with check (can_any('{/calendar,/cars}'));

-- Расходы
create policy "section read" on public.expenses for select to authenticated using (can_any('{/expenses,/dashboard,/analytics}'));
create policy "section write" on public.expenses for all to authenticated using (can_any('{/expenses}')) with check (can_any('{/expenses}'));

-- Клеймы
create policy "section read" on public.claims for select to authenticated using (can_any('{/claims,/dashboard,/reports}'));
create policy "section write" on public.claims for all to authenticated using (can_any('{/claims}')) with check (can_any('{/claims}'));

-- Наклейки
create policy "section read" on public.sticker_cars for select to authenticated using (can_any('{/stickers,/dashboard}'));
create policy "section write" on public.sticker_cars for all to authenticated using (can_any('{/stickers}')) with check (can_any('{/stickers}'));
create policy "section read" on public.sticker_changes for select to authenticated using (can_any('{/stickers,/dashboard}'));
create policy "section write" on public.sticker_changes for all to authenticated using (can_any('{/stickers}')) with check (can_any('{/stickers}'));

-- Доходы — только «Доходы»
create policy "section access" on public.revenue_accounts for all to authenticated using (can_any('{/income}')) with check (can_any('{/income}'));
create policy "section access" on public.revenue_cars for all to authenticated using (can_any('{/income}')) with check (can_any('{/income}'));
create policy "section access" on public.revenue_entries for all to authenticated using (can_any('{/income}')) with check (can_any('{/income}'));
create policy "section access" on public.revenue_month_expenses for all to authenticated using (can_any('{/income}')) with check (can_any('{/income}'));
create policy "section access" on public.revenue_payments for all to authenticated using (can_any('{/income}')) with check (can_any('{/income}'));
create policy "section read" on public.tracker_archive for select to authenticated using (can_any('{/income}'));

-- Тех.обслуживание (раздел скрыт из меню) — только админ
create policy "section access" on public.maintenance for all to authenticated using (can_any('{/maintenance}')) with check (can_any('{/maintenance}'));

-- История: записывают все свои действия, читает — «История»
create policy "write own" on public.activity_log for insert to authenticated with check (user_id = auth.uid() and is_member());
create policy "section read" on public.activity_log for select to authenticated using (can_any('{/log}'));

-- Команда: свою строку видит каждый, всё — админ
create policy "own or admin read" on public.team_members for select to authenticated using (is_admin() or lower(email) = lower(auth.jwt() ->> 'email'));
create policy "admin write" on public.team_members for all to authenticated using (is_admin()) with check (is_admin());

-- Чеки (файлы) — «Расходы»
drop policy if exists "auth users can delete receipts" on storage.objects;
drop policy if exists "auth users can read receipts" on storage.objects;
drop policy if exists "auth users can upload receipts" on storage.objects;
create policy "receipts read" on storage.objects for select to authenticated using (bucket_id = 'receipts' and public.can_any('{/expenses}'));
create policy "receipts upload" on storage.objects for insert to authenticated with check (bucket_id = 'receipts' and public.can_any('{/expenses}'));
create policy "receipts delete" on storage.objects for delete to authenticated using (bucket_id = 'receipts' and public.can_any('{/expenses}'));

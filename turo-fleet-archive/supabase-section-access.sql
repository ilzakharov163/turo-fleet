-- Доступ к данным по разделам (галочки в «Команде» = profiles.permissions).
-- admin видит всё; у остальных пустой список = только /expenses (как в Sidebar).

create or replace function public.has_section(sections text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and (p.role = 'admin'
           or coalesce(nullif(p.permissions, '{}'), array['/expenses']) && sections)
  )
$$;
revoke execute on function public.has_section(text[]) from public, anon;
grant execute on function public.has_section(text[]) to authenticated;

-- Удаляем старые «полный доступ всем вошедшим»
do $$ declare r record; begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename in (
             'cars','car_blocks','expenses','claims','sticker_cars','sticker_changes',
             'revenue_accounts','revenue_cars','revenue_entries','revenue_month_expenses',
             'revenue_payments','tracker_archive','maintenance','team_members','activity_log')
  loop execute format('drop policy %I on public.%I', r.policyname, r.tablename); end loop;
end $$;

-- Машины и простои: читают все вошедшие (нужны для подписей во всех разделах)
create policy "read" on cars for select to authenticated using (true);
create policy "write" on cars for all to authenticated
  using (has_section('{/cars,/stickers}')) with check (has_section('{/cars,/stickers}'));
create policy "read" on car_blocks for select to authenticated using (true);
create policy "write" on car_blocks for all to authenticated
  using (has_section('{/calendar,/cars}')) with check (has_section('{/calendar,/cars}'));

-- Расходы
create policy "read" on expenses for select to authenticated using (has_section('{/expenses,/dashboard,/analytics}'));
create policy "write" on expenses for all to authenticated
  using (has_section('{/expenses}')) with check (has_section('{/expenses}'));

-- Клеймы
create policy "read" on claims for select to authenticated using (has_section('{/claims,/dashboard,/reports}'));
create policy "write" on claims for all to authenticated
  using (has_section('{/claims}')) with check (has_section('{/claims}'));

-- Наклейки
create policy "read" on sticker_cars for select to authenticated using (has_section('{/stickers,/dashboard}'));
create policy "write" on sticker_cars for all to authenticated
  using (has_section('{/stickers}')) with check (has_section('{/stickers}'));
create policy "read" on sticker_changes for select to authenticated using (has_section('{/stickers,/dashboard}'));
create policy "write" on sticker_changes for all to authenticated
  using (has_section('{/stickers}')) with check (has_section('{/stickers}'));

-- Доходы: только с галочкой «Доходы»
create policy "income" on revenue_accounts for all to authenticated using (has_section('{/income}')) with check (has_section('{/income}'));
create policy "income" on revenue_cars for all to authenticated using (has_section('{/income}')) with check (has_section('{/income}'));
create policy "income" on revenue_entries for all to authenticated using (has_section('{/income}')) with check (has_section('{/income}'));
create policy "income" on revenue_month_expenses for all to authenticated using (has_section('{/income}')) with check (has_section('{/income}'));
create policy "income" on revenue_payments for all to authenticated using (has_section('{/income}')) with check (has_section('{/income}'));
create policy "income read" on tracker_archive for select to authenticated using (has_section('{/income}'));

-- Служебное
create policy "admin" on maintenance for all to authenticated using (is_admin()) with check (is_admin());
create policy "admin" on team_members for all to authenticated using (is_admin()) with check (is_admin());
create policy "read own" on team_members for select to authenticated using (email = auth.jwt() ->> 'email');
create policy "write own" on activity_log for insert to authenticated with check (user_id = auth.uid());
create policy "read" on activity_log for select to authenticated using (has_section('{/log}'));

-- Чеки
drop policy if exists "auth users can read receipts" on storage.objects;
drop policy if exists "auth users can upload receipts" on storage.objects;
drop policy if exists "auth users can delete receipts" on storage.objects;
create policy "receipts read" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and has_section('{/expenses}'));
create policy "receipts upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and has_section('{/expenses}'));
create policy "receipts delete" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and has_section('{/expenses}'));

-- Предупреждения Supabase
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
alter function public.update_updated_at_column() set search_path = public;

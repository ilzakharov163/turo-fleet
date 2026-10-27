---
name: new-table
description: Добавить новую таблицу (или колонку) в базу Supabase проекта по правилам: сначала посмотреть схему, затем миграция с RLS по разделам через can_any(...), запись в supabase-rls-sections.sql и типы. Использовать при любом изменении схемы базы.
disable-model-invocation: true
argument-hint: "[что хранить и в каком разделе]"
---

# Новая таблица в Supabase

Задача: $ARGUMENTS

Проект Supabase: `fsvttaesxlwhndcwtqqz`. Код: `turo-fleet-archive/`.

## Шаги

1. **Посмотреть, что уже есть.** `list_tables` (схема `public`) и, если нужно, `list_migrations`. Проверить, нет ли уже подходящей таблицы или колонки — лучше дополнить существующую.
2. **Решить, какие разделы читают и пишут.** Ключи разделов — пути меню: `/cars`, `/calendar`, `/expenses`, `/income`, `/claims`, `/stickers`, `/reports`, `/analytics`, `/dashboard`, `/log`. Если данные показываются в другом разделе (Дашборд, Отчёты, Карточка машины) — добавить его в список чтения.
3. **Показать владельцу план простыми словами** (что за таблица, какие поля, кто видит, кто меняет) и дождаться «да». Миграция меняет живую базу.
4. **Применить миграцию** `apply_migration` с понятным именем (`snake_case`). В одной миграции:
   ```sql
   create table public.<name> (
     id uuid primary key default gen_random_uuid(),
     ...,
     created_at timestamptz not null default now()
   );
   alter table public.<name> enable row level security;
   create policy "section read" on public.<name> for select to authenticated using (can_any('{/раздел,/другие}'));
   create policy "section write" on public.<name> for all to authenticated using (can_any('{/раздел}')) with check (can_any('{/раздел}'));
   ```
   Никогда не делать политику «полный доступ всем вошедшим» (`using (true)`). Только админ — `can_any('{/maintenance}')` или `is_admin()`.
5. **Дописать политики в `turo-fleet-archive/supabase-rls-sections.sql`** в стиле файла: комментарий по-русски над блоком.
6. **Проверить:** `get_advisors` (type `security`) — не должно быть новых предупреждений про эту таблицу.
7. **Код:** тип в `src/types/index.ts`; запись в базу через `createClient()` из `@/lib/supabase`; действия логировать `log(action, entity, id, details)` из `@/lib/logger`.
8. **Обновить `CLAUDE.md`** (раздел «Безопасность и доступ» — карта таблиц, и описание раздела) — коротко, с датой.

Данные в существующих таблицах не менять и не удалять без явного согласия владельца.

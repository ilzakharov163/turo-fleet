-- Агенты и Telegram-бот (миграция agents_telegram, 2026-10-31).
-- Бот работает на сервере с сервисным ключом; права проверяет сам код (lib/agent/access.ts — те же правила, что can_any).
-- Таблицы бота сайт напрямую почти не читает: привязку видит сам человек, журнал агентов — только админ.

-- Привязка Telegram к пользователю сайта (один Telegram = один человек)
create table if not exists public.telegram_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chat_id bigint not null unique,
  username text,
  notify_expenses boolean not null default true,   -- админу: сообщать о расходах сотрудников
  linked_at timestamptz not null default now()
);

-- Одноразовые коды привязки (Профиль → «Подключить Telegram»), живут 15 минут
create table if not exists public.telegram_link_codes (
  code text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null
);

-- Короткая история переписки с ботом (последние сообщения — чтобы он понимал ответы на свои вопросы)
create table if not exists public.agent_chats (
  chat_id bigint primary key,
  history jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

-- Действия, ждущие кнопки «Записать»
create table if not exists public.agent_pending (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  actions jsonb not null,             -- [{ tool, input, summary }]
  status text not null default 'waiting' check (status in ('waiting', 'done', 'cancelled')),
  created_at timestamptz not null default now()
);

-- Журнал агентов: каждый запуск и его шаги (страница «Агенты»)
create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent text not null,                -- 'bookkeeper' | 'auditor' | 'advisor'
  update_id bigint unique,            -- Telegram update — защита от повторной обработки
  user_id uuid references auth.users(id) on delete set null,
  chat_id bigint,
  input text,
  output text,
  status text not null default 'running' check (status in ('running', 'done', 'waiting', 'error')),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.agent_steps (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  kind text not null,                 -- 'input' | 'voice' | 'photo' | 'tool' | 'confirm' | 'write' | 'error' | 'reply'
  text text not null,
  data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists agent_steps_run on public.agent_steps(run_id, id);
create index if not exists agent_runs_created on public.agent_runs(created_at desc);

alter table public.telegram_links enable row level security;
alter table public.telegram_link_codes enable row level security;
alter table public.agent_chats enable row level security;
alter table public.agent_pending enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_steps enable row level security;

-- Своя привязка видна самому человеку (Профиль), все — админу; отвязать себя можно
create policy "own or admin read" on public.telegram_links for select to authenticated using (user_id = auth.uid() or is_admin());
create policy "own delete" on public.telegram_links for delete to authenticated using (user_id = auth.uid() or is_admin());
create policy "own update" on public.telegram_links for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Журнал агентов — только админ (страница «Агенты»)
create policy "admin read" on public.agent_runs for select to authenticated using (is_admin());
create policy "admin read" on public.agent_steps for select to authenticated using (is_admin());

-- telegram_link_codes, agent_chats, agent_pending — без политик: только сервер (сервисный ключ)

# Инструкция по настройке Fleet Manager

## 1. Создать проект в Supabase
1. Зайди на supabase.com → New project
2. Запомни URL и anon key (Settings → API)

## 2. Заполнить .env.local
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

## 3. Создать базу данных
Открой Supabase → SQL Editor → вставь содержимое файла `supabase-schema.sql` → Run

## 4. Создать первого пользователя
Supabase → Authentication → Users → Add user
- Введи свой email и пароль
- Подтвердить email (или отключи подтверждение в Auth → Settings → Email confirmations OFF)

## 5. Настроить Google Drive бэкап (опционально)
- Supabase → Storage → receipts bucket уже создан
- Для автобэкапа на Google Drive нужен отдельный скрипт (можно добавить позже)

## 6. Запустить локально
```bash
npm install
npm run dev
```
Открой http://localhost:3000

## 7. Деплой на Vercel
```bash
npm install -g vercel
vercel
```
Добавь переменные окружения в Vercel Dashboard → Settings → Environment Variables

## Зарплатная логика
- 3–4 активных недели в месяце → $150
- 2 активных недели → $75  
- 1 неделя и меньше → $0

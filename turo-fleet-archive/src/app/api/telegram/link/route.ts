import { randomBytes } from 'node:crypto'
import { createClient } from '@/lib/supabase-server'
import { serviceDb } from '@/lib/agent/server'

// Профиль → «Подключить Telegram»: одноразовый код для ссылки t.me/<бот>?start=<код> (живёт 15 минут).
// Только для вошедшего пользователя — код привязывает Telegram именно к нему.
export async function POST() {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return Response.json({ error: 'Нужно войти' }, { status: 401 })
  const bot = process.env.TELEGRAM_BOT_USERNAME
  if (!bot) return Response.json({ error: 'Бот ещё не настроен' }, { status: 503 })
  const db = serviceDb()
  const code = randomBytes(12).toString('base64url')
  await db.from('telegram_link_codes').delete().eq('user_id', user.id)
  const { error } = await db.from('telegram_link_codes').insert({ code, user_id: user.id, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() })
  if (error) return Response.json({ error: 'Не получилось' }, { status: 500 })
  return Response.json({ url: `https://t.me/${bot.replace(/^@/, '')}?start=${code}` })
}

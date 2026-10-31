import { createClient } from '../supabase-server'
import { serviceDb } from './server'

// Запрос от вошедшего на сайт владельца (admin) — для кнопок «Включить бота», «Запустить сейчас»
export async function isAdminRequest() {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return false
  const { data } = await serviceDb().from('profiles').select('role').eq('id', user.id).maybeSingle()
  return data?.role === 'admin'
}

// Запрос от расписания Vercel (Cron присылает Authorization: Bearer CRON_SECRET)
export const isCronRequest = (request: Request) => !!process.env.CRON_SECRET && request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`

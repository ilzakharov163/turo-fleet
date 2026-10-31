import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { accessFrom, type Access } from '../core'

// Сервер агентов: база с сервисным ключом (RLS не действует — права проверяет код агента, lib/agent/tools*)
// и «кто пишет боту» по Telegram chat_id.

let db: SupabaseClient | null = null
export function serviceDb(): SupabaseClient {
  if (!db) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('Нет NEXT_PUBLIC_SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY')
    db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  }
  return db
}

export interface Actor extends Access { userId: string; email: string; name: string; chatId: number }

// Человек, привязавший этот Telegram, с его правами; null — чужой
export async function actorByChat(db: SupabaseClient, chatId: number): Promise<Actor | null> {
  const { data: link } = await db.from('telegram_links').select('user_id').eq('chat_id', chatId).maybeSingle()
  if (!link) return null
  const [{ data: profile }, { data: user }] = await Promise.all([
    db.from('profiles').select('role, permissions, full_name').eq('id', link.user_id).maybeSingle(),
    db.auth.admin.getUserById(link.user_id),
  ])
  if (!profile || !user?.user) return null
  const email = user.user.email || ''
  return { ...accessFrom(profile.role, profile.permissions), userId: link.user_id, email, name: displayName(profile.full_name, user.user.user_metadata) || email, chatId }
}

// Привязать Telegram по коду из Профиля. Возвращает имя человека ('' — не задано) или null (код неверный / устарел).
export async function linkByCode(db: SupabaseClient, code: string, chatId: number, username: string | null): Promise<string | null> {
  const { data: row } = await db.from('telegram_link_codes').select('user_id, expires_at').eq('code', code).maybeSingle()
  if (!row || new Date(row.expires_at) < new Date()) return null
  await db.from('telegram_link_codes').delete().eq('code', code)
  // Один Telegram — один человек: старая привязка этого чата или этого человека заменяется
  await db.from('telegram_links').delete().or(`chat_id.eq.${chatId},user_id.eq.${row.user_id}`)
  const { error } = await db.from('telegram_links').insert({ user_id: row.user_id, chat_id: chatId, username })
  if (error) return null
  const [{ data: profile }, { data: user }] = await Promise.all([
    db.from('profiles').select('full_name').eq('id', row.user_id).maybeSingle(),
    db.auth.admin.getUserById(row.user_id),
  ])
  return displayName(profile?.full_name, user?.user?.user_metadata)
}

// Имя человека: из «Команды» (profiles.full_name) или из Профиля (имя входа); '' — не задано
const displayName = (fullName: string | null | undefined, meta: Record<string, unknown> | undefined) =>
  (fullName || (typeof meta?.full_name === 'string' ? meta.full_name : '') || '').trim()

// Сегодня по времени парка (Лос-Анджелес), 'yyyy-MM-dd'
export function todayLA(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'America/Los_Angeles' }).format(now)
}

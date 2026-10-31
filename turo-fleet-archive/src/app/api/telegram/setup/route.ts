import { createClient } from '@/lib/supabase-server'
import { serviceDb } from '@/lib/agent/server'

// Профиль → «Включить бота» (только админ): сайт сам говорит Telegram, куда присылать сообщения,
// беря токен и секрет из переменных Vercel. GET — состояние, POST — подключить.

async function isAdmin() {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return false
  const { data } = await serviceDb().from('profiles').select('role').eq('id', user.id).maybeSingle()
  return data?.role === 'admin'
}

async function tg(method: string, body?: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
  })
  return res.json().catch(() => null) as Promise<{ ok: boolean; result?: Record<string, unknown>; description?: string } | null>
}

const missing = () => ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME', 'TELEGRAM_WEBHOOK_SECRET', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY'].filter(k => !process.env[k])

export async function GET(request: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Только для админа' }, { status: 403 })
  const lack = missing()
  if (lack.includes('TELEGRAM_BOT_TOKEN')) return Response.json({ connected: false, missing: lack })
  const info = await tg('getWebhookInfo')
  const url = `${new URL(request.url).origin}/api/telegram`
  return Response.json({
    connected: info?.ok && info.result?.url === url, missing: lack,
    lastError: info?.result?.last_error_message || null, pending: info?.result?.pending_update_count ?? 0,
  })
}

export async function POST(request: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Только для админа' }, { status: 403 })
  const lack = missing()
  if (lack.length) return Response.json({ error: `В Vercel не хватает: ${lack.join(', ')}` }, { status: 400 })
  const res = await tg('setWebhook', {
    url: `${new URL(request.url).origin}/api/telegram`,
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  })
  if (!res?.ok) return Response.json({ error: `Telegram: ${res?.description || 'нет ответа'}` }, { status: 502 })
  return Response.json({ connected: true })
}

import { isAdminRequest as isAdmin } from '@/lib/agent/admin'

// Профиль → «Включить бота» (только админ): сайт сам говорит Telegram, куда присылать сообщения,
// беря токен и секрет из переменных Vercel. GET — состояние, POST — подключить.

async function tg(method: string, body?: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
  })
  return res.json().catch(() => null) as Promise<{ ok: boolean; result?: Record<string, unknown>; description?: string } | null>
}

const missing = () => ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME', 'TELEGRAM_WEBHOOK_SECRET', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET'].filter(k => !process.env[k])

export async function GET(request: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Только для админа' }, { status: 403 })
  const lack = missing()
  if (lack.includes('TELEGRAM_BOT_TOKEN')) return Response.json({ connected: false, missing: lack })
  const info = await tg('getWebhookInfo')
  const url = `${new URL(request.url).origin}/api/telegram`
  // Токен не принят — так и говорим (иначе карточка молча пишет «не подключён»)
  if (!info?.ok) return Response.json({ connected: false, missing: lack, lastError: `Telegram не принял токен бота (${info?.description || 'нет ответа'}) — проверьте TELEGRAM_BOT_TOKEN в Vercel` })
  const current = String(info.result?.url || '')
  return Response.json({
    connected: current === url, missing: lack,
    lastError: info.result?.last_error_message || (current && current !== url ? `Бот подключён к другому адресу: ${current}` : null),
    pending: info.result?.pending_update_count ?? 0,
  })
}

export async function POST(request: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Только для админа' }, { status: 403 })
  const lack = missing().filter(k => k !== 'CRON_SECRET')   // расписанию агентов он нужен, боту — нет
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

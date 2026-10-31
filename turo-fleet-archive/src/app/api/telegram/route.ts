import { after } from 'next/server'
import { serviceDb } from '@/lib/agent/server'
import { handleUpdate } from '@/lib/agent/bot'

// Сюда Telegram присылает сообщения боту (webhook). Проверяем секрет из setWebhook,
// сразу отвечаем 200 (иначе Telegram пришлёт то же сообщение повторно), а работу делаем после ответа.
export const maxDuration = 120

export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret || request.headers.get('x-telegram-bot-api-secret-token') !== secret) return new Response('forbidden', { status: 403 })
  const update = await request.json().catch(() => null)
  if (!update || typeof update !== 'object') return new Response('bad request', { status: 400 })
  after(async () => {
    try { await handleUpdate(serviceDb(), update) } catch (e) { console.error('telegram webhook', e) }
  })
  return new Response('ok')
}

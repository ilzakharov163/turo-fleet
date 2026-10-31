// Telegram Bot API: отправка сообщений, кнопки, скачивание голосовых и фото.

type Json = Record<string, unknown>

export interface TgButton { text: string; callback_data: string }

async function api<T = Json>(method: string, body: Json): Promise<T | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('Нет TELEGRAM_BOT_TOKEN')
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null) as { ok: boolean; result: T; description?: string } | null
  if (!json?.ok) { console.error('telegram', method, json?.description); return null }
  return json.result
}

// Сообщение; кнопки — строками (каждый вложенный массив — один ряд)
export async function send(chatId: number, text: string, buttons?: TgButton[][]) {
  return api<{ message_id: number }>('sendMessage', {
    chat_id: chatId, text: text.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true,
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  })
}

// Заменить текст сообщения (после нажатия кнопки), кнопки убираются
export async function edit(chatId: number, messageId: number, text: string) {
  return api('editMessageText', { chat_id: chatId, message_id: messageId, text: text.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true })
}

export async function answerButton(callbackId: string, text?: string) {
  return api('answerCallbackQuery', { callback_query_id: callbackId, ...(text ? { text } : {}) })
}

export async function typing(chatId: number) {
  return api('sendChatAction', { chat_id: chatId, action: 'typing' })
}

// Скачать файл из Telegram (голосовое, фото) — до 20 МБ
export async function download(fileId: string): Promise<{ bytes: Buffer; path: string } | null> {
  const file = await api<{ file_path: string }>('getFile', { file_id: fileId })
  if (!file?.file_path) return null
  const res = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`)
  if (!res.ok) return null
  return { bytes: Buffer.from(await res.arrayBuffer()), path: file.file_path }
}

// Экранирование для parse_mode HTML
export const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

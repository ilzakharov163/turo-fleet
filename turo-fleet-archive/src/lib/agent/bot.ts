import type { SupabaseClient } from '@supabase/supabase-js'
import { actorByChat, linkByCode, type Actor } from './server'
import { send, edit, answerButton, typing, download, esc, type TgButton } from './telegram'
import { transcribe } from './voice'
import { runBookkeeper, runPending, type HistoryItem, type PendingAction, type Step } from './agent'
import type { Photo } from './tools'

// Telegram → агент-учётчик: сообщения (текст, голос, фото чека), кнопки «Записать / Исправить / Отменить».
// Каждый запуск пишется в agent_runs / agent_steps (страница «Агенты»).

/* eslint-disable @typescript-eslint/no-explicit-any -- объекты Telegram Update без типов */
type Update = Record<string, any>

const HISTORY = 16                      // сколько последних реплик помнить
const UNDO_HOURS = 24                   // «Отменить» расход — в течение суток

export async function handleUpdate(db: SupabaseClient, update: Update) {
  if (update.callback_query) return onButton(db, update.callback_query)
  const msg = update.message
  if (!msg?.chat?.id || msg.chat.type !== 'private') return
  const chatId: number = msg.chat.id
  const text: string = (msg.text || msg.caption || '').trim()

  if (text.startsWith('/start')) {
    const code = text.split(/\s+/)[1]
    if (!code) return send(chatId, 'Здравствуйте! Чтобы я вас узнал, откройте сайт → Настройки → Профиль → «Подключить Telegram».')
    const name = await linkByCode(db, code, chatId, msg.from?.username || null)
    return send(chatId, name ? `Готово, ${esc(name)}! Пишите или говорите, что произошло: расход, клейм, простой, выплата — я внесу в приложение.` : 'Код не подошёл или устарел. Получите новый на сайте: Профиль → «Подключить Telegram».')
  }

  const actor = await actorByChat(db, chatId)
  if (!actor) return send(chatId, 'Я вас пока не знаю. Подключите Telegram на сайте: Настройки → Профиль → «Подключить Telegram».')

  // Повтор того же обновления от Telegram — пропускаем
  const { data: run, error } = await db.from('agent_runs').insert({ agent: 'bookkeeper', update_id: update.update_id, user_id: actor.userId, chat_id: chatId, input: text || null }).select('id').single()
  if (error || !run) return
  const steps: Step[] = []
  await typing(chatId)

  try {
    let said = text
    if (msg.voice || msg.audio) {
      const file = await download((msg.voice || msg.audio).file_id)
      const heard = file ? await transcribe(file.bytes) : null
      if (!heard) {
        await send(chatId, 'Не получилось разобрать голосовое — попробуйте ещё раз или напишите текстом.')
        return finish(db, run.id, steps, 'error', 'голос не распознан')
      }
      steps.push({ kind: 'voice', text: heard })
      await send(chatId, `🎙 <i>${esc(heard)}</i>`)
      said = [text, heard].filter(Boolean).join('\n')
    }

    let photo: Photo | null = null
    const image = msg.photo?.length ? msg.photo[msg.photo.length - 1] : msg.document?.mime_type?.startsWith('image/') ? msg.document : null
    if (image) {
      const file = await download(image.file_id)
      if (file) photo = { bytes: file.bytes, mime: msg.document?.mime_type === 'image/png' ? 'image/png' : 'image/jpeg' }
      steps.push({ kind: 'photo', text: photo ? 'фото чека' : 'фото не скачалось' })
    }
    if (!said && !photo) return finish(db, run.id, steps, 'done', 'пустое сообщение')

    const history = await loadHistory(db, chatId)
    const result = await runBookkeeper(db, actor, { text: said, photo, history })
    steps.push(...result.steps)

    const buttons: TgButton[][] = result.undo.map(u => [{ text: `↩️ Отменить: ${u.label.slice(0, 40)}`, callback_data: `undo:${u.id}` }])
    await send(chatId, esc(result.reply), buttons.length ? buttons : undefined)

    if (result.pending.length) {
      const { data: p } = await db.from('agent_pending').insert({ chat_id: chatId, user_id: actor.userId, actions: result.pending }).select('id').single()
      if (p) await send(chatId, `<b>Записать?</b>\n${result.pending.map(a => `• ${esc(a.summary)}`).join('\n')}`, [[{ text: '✅ Записать', callback_data: `ok:${p.id}` }, { text: '✏️ Исправить', callback_data: `no:${p.id}` }]])
      steps.push({ kind: 'confirm', text: result.pending.map(a => a.summary).join('; ') })
    }

    await saveHistory(db, chatId, [...history,
      { role: 'user', text: `${photo ? '[фото чека] ' : ''}${said}` },
      { role: 'assistant', text: result.reply + (result.pending.length ? `\n[ждёт «Записать»: ${result.pending.map(a => a.summary).join('; ')}]` : '') },
    ])
    if (actor.role !== 'admin' && result.undo.length) await notifyAdmins(db, actor, result.undo.map(u => u.label))
    await db.from('agent_runs').update({ input_tokens: result.usage.input, output_tokens: result.usage.output }).eq('id', run.id)
    return finish(db, run.id, steps, result.pending.length ? 'waiting' : 'done', result.reply)
  } catch (e) {
    console.error('bot', e)
    await send(chatId, 'Что-то пошло не так, ничего не записано. Попробуйте ещё раз через минуту.')
    steps.push({ kind: 'error', text: String(e).slice(0, 500) })
    return finish(db, run.id, steps, 'error', null)
  }
}

async function onButton(db: SupabaseClient, q: Update) {
  const chatId: number = q.message?.chat?.id
  const messageId: number = q.message?.message_id
  const [kind, id] = String(q.data || '').split(':')
  const actor = chatId ? await actorByChat(db, chatId) : null
  if (!actor || !id) return answerButton(q.id, 'Нет доступа')

  if (kind === 'undo') return undoExpense(db, actor, q, id, chatId, messageId)

  // Забираем подготовленные действия ровно один раз (повторное нажатие ничего не сделает)
  const { data: p } = await db.from('agent_pending').update({ status: kind === 'ok' ? 'done' : 'cancelled' })
    .eq('id', id).eq('chat_id', chatId).eq('user_id', actor.userId).eq('status', 'waiting').select('actions').maybeSingle()
  if (!p) return answerButton(q.id, 'Уже обработано')
  await answerButton(q.id)
  if (kind !== 'ok') {
    await edit(chatId, messageId, 'Не записано. Напишите, что исправить.')
    return appendHistory(db, chatId, { role: 'assistant', text: '[человек нажал «Исправить» — ничего не записано, ждём уточнения]' })
  }
  const lines = await runPending(db, actor, p.actions as PendingAction[])
  await edit(chatId, messageId, lines.map(esc).join('\n'))
  const { data: run } = await db.from('agent_runs').insert({ agent: 'bookkeeper', user_id: actor.userId, chat_id: chatId, input: '«Записать»', output: lines.join('\n'), status: 'done', finished_at: new Date().toISOString() }).select('id').single()
  if (run) await db.from('agent_steps').insert(lines.map(l => ({ run_id: run.id, kind: 'write', text: l })))
  return appendHistory(db, chatId, { role: 'assistant', text: `[записано по кнопке]\n${lines.join('\n')}` })
}

async function undoExpense(db: SupabaseClient, actor: Actor, q: Update, id: string, chatId: number, messageId: number) {
  const { data: e } = await db.from('expenses').select('id, title, amount, files, created_by, created_at').eq('id', id).maybeSingle()
  if (!e) return answerButton(q.id, 'Расход уже удалён')
  const fresh = Date.now() - new Date(e.created_at).getTime() < UNDO_HOURS * 3600_000
  if ((e.created_by !== actor.userId && actor.role !== 'admin') || !fresh) return answerButton(q.id, 'Отменить уже нельзя — удалите на сайте')
  const { error } = await db.from('expenses').delete().eq('id', e.id)
  if (error) return answerButton(q.id, 'Не получилось')
  if (e.files?.length) await db.storage.from('receipts').remove(e.files)
  await db.from('activity_log').insert({ user_id: actor.userId, user_email: actor.email, action: 'delete', entity_type: 'expense', entity_id: e.id, details: { title: e.title, amount: e.amount, via: 'telegram', undo: true } })
  await answerButton(q.id, 'Отменено')
  await edit(chatId, messageId, `↩️ Расход отменён: ${esc(e.title)} · $${e.amount}`)
  return appendHistory(db, chatId, { role: 'assistant', text: `[расход «${e.title}» $${e.amount} отменён кнопкой]` })
}

// Владельцу — короткое сообщение о расходе сотрудника
async function notifyAdmins(db: SupabaseClient, actor: Actor, labels: string[]) {
  const { data: links } = await db.from('telegram_links').select('chat_id, user_id, notify_expenses').eq('notify_expenses', true)
  if (!links?.length) return
  const { data: admins } = await db.from('profiles').select('id').eq('role', 'admin').in('id', links.map(l => l.user_id))
  for (const l of links.filter(l => admins?.some(a => a.id === l.user_id) && l.chat_id !== actor.chatId))
    await send(l.chat_id, `🧾 ${esc(actor.name)} добавил(а) расход:\n${labels.map(x => `• ${esc(x)}`).join('\n')}`)
}

async function loadHistory(db: SupabaseClient, chatId: number): Promise<HistoryItem[]> {
  const { data } = await db.from('agent_chats').select('history, updated_at').eq('chat_id', chatId).maybeSingle()
  // Через 6 часов тишины начинаем разговор заново
  if (!data || Date.now() - new Date(data.updated_at).getTime() > 6 * 3600_000) return []
  return (data.history as HistoryItem[]) || []
}

async function saveHistory(db: SupabaseClient, chatId: number, items: HistoryItem[]) {
  // История начинается с реплики человека
  let tail = items.slice(-HISTORY)
  while (tail.length && tail[0].role !== 'user') tail = tail.slice(1)
  await db.from('agent_chats').upsert({ chat_id: chatId, history: tail, updated_at: new Date().toISOString() })
}

async function appendHistory(db: SupabaseClient, chatId: number, item: HistoryItem) {
  const { data } = await db.from('agent_chats').select('history').eq('chat_id', chatId).maybeSingle()
  await saveHistory(db, chatId, [...((data?.history as HistoryItem[]) || []), item])
}

async function finish(db: SupabaseClient, runId: string, steps: Step[], status: string, output: string | null) {
  if (steps.length) await db.from('agent_steps').insert(steps.map(s => ({ run_id: runId, kind: s.kind, text: s.text, data: s.data ?? null })))
  await db.from('agent_runs').update({ status, output, finished_at: new Date().toISOString() }).eq('id', runId)
}

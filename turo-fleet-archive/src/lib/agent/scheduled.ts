import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MODEL, type HistoryItem } from './agent'
import { send, esc } from './telegram'

// Общее для агентов по расписанию (Ревизор, Советник): журнал запуска, вопрос к Claude без инструментов,
// сообщение владельцам в Telegram (и в историю чата — чтобы Учётчик понял ответ «да, закрой»).

export type ScheduledAgent = 'auditor' | 'advisor'

export async function startRun(db: SupabaseClient, agent: ScheduledAgent, input: string) {
  const { data } = await db.from('agent_runs').insert({ agent, input }).select('id').single()
  return data?.id as string | undefined
}

export async function finishRun(db: SupabaseClient, runId: string | undefined, o: { status: 'done' | 'error'; output: string; steps: { kind: string; text: string }[]; usage?: { input: number; output: number } }) {
  if (!runId) return
  if (o.steps.length) await db.from('agent_steps').insert(o.steps.map(s => ({ run_id: runId, kind: s.kind, text: s.text })))
  await db.from('agent_runs').update({ status: o.status, output: o.output, finished_at: new Date().toISOString(), input_tokens: o.usage?.input || 0, output_tokens: o.usage?.output || 0 }).eq('id', runId)
}

let client: Anthropic | null = null

// Один вопрос к Claude, ответ — текст. Возвращает null, если Claude недоступен (тогда агент шлёт простой список).
export async function askClaude(system: string, prompt: string): Promise<{ text: string; usage: { input: number; output: number } } | null> {
  try {
    const res = await (client ||= new Anthropic()).beta.messages.create({
      model: MODEL, max_tokens: 16000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'medium' }, system, messages: [{ role: 'user', content: prompt }],
    })
    if (res.stop_reason === 'refusal') return null
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('\n').trim()
    return text ? { text, usage: { input: res.usage.input_tokens + (res.usage.cache_read_input_tokens || 0), output: res.usage.output_tokens } } : null
  } catch (e) {
    console.error('askClaude', e)
    return null
  }
}

// Чаты владельцев (admin), подключивших Telegram
export async function adminChats(db: SupabaseClient): Promise<number[]> {
  const { data: links } = await db.from('telegram_links').select('chat_id, user_id')
  if (!links?.length) return []
  const { data: admins } = await db.from('profiles').select('id').eq('role', 'admin').in('id', links.map(l => l.user_id))
  return links.filter(l => admins?.some(a => a.id === l.user_id)).map(l => l.chat_id as number)
}

// Отправить владельцам и дописать в историю их чатов с ботом (ответ на сообщение подхватит Учётчик)
export async function tellAdmins(db: SupabaseClient, title: string, text: string) {
  const chats = await adminChats(db)
  for (const chatId of chats) {
    await send(chatId, `<b>${esc(title)}</b>\n${esc(text)}`)
    const { data } = await db.from('agent_chats').select('history').eq('chat_id', chatId).maybeSingle()
    const history = [...((data?.history as HistoryItem[]) || []), { role: 'assistant', text: `[${title}]\n${text}` } as HistoryItem].slice(-15)
    // История начинается с реплики человека — иначе ставим перед сообщением агента пометку
    const fixed = history[0]?.role === 'user' ? history : [{ role: 'user', text: '(сообщение от агента по расписанию)' } as HistoryItem, ...history]
    await db.from('agent_chats').upsert({ chat_id: chatId, history: fixed, updated_at: new Date().toISOString() })
  }
  return chats.length
}

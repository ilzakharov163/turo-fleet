import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logAs } from '../core'
import { allowed, fleetText, loadFleet, type AgentTool, type Input, type Photo, type ToolCtx } from './tools'
import { READ_TOOLS } from './tools-read'
import { WRITE_TOOLS } from './tools-write'
import { BOOKKEEPER_SYSTEM, contextBlock } from './prompt'
import { todayLA, type Actor } from './server'

// Агент-учётчик: одно сообщение человека → цикл «Claude думает → вызывает инструменты → отвечает».
// Действия confirm не выполняются здесь — они возвращаются как pending (кнопка «Записать»).

export const MODEL = 'claude-opus-5-5'
const MAX_STEPS = 8
const ALL_TOOLS: AgentTool[] = [...READ_TOOLS, ...WRITE_TOOLS]

export const toolByName = (name: string) => ALL_TOOLS.find(t => t.def.name === name)

export interface HistoryItem { role: 'user' | 'assistant'; text: string }
export interface PendingAction { tool: string; input: Input; summary: string }
export interface Step { kind: string; text: string; data?: unknown }

export interface AgentResult {
  reply: string
  pending: PendingAction[]
  undo: ToolCtx['undo']
  steps: Step[]
  usage: { input: number; output: number }
}

let client: Anthropic | null = null
const anthropic = () => (client ||= new Anthropic())

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']

// Контекст инструментов для этого человека (и для нажатия «Записать» — тот же код)
export async function toolCtx(db: SupabaseClient, actor: Actor, photo: Photo | null): Promise<ToolCtx> {
  const today = todayLA()
  return { db, actor, core: { db, log: logAs(db, { id: actor.userId, email: actor.email }, 'telegram') }, today, photo, cars: await loadFleet(db, today), undo: [] }
}

export async function runBookkeeper(db: SupabaseClient, actor: Actor, opts: { text: string; photo: Photo | null; history: HistoryItem[] }): Promise<AgentResult> {
  const ctx = await toolCtx(db, actor, opts.photo)
  const tools = ALL_TOOLS.filter(t => allowed(ctx, t))
  const steps: Step[] = []
  const pending: PendingAction[] = []
  const usage = { input: 0, output: 0 }

  const content: Anthropic.Beta.BetaContentBlockParam[] = []
  if (opts.photo) content.push({ type: 'image', source: { type: 'base64', media_type: opts.photo.mime as 'image/jpeg', data: opts.photo.bytes.toString('base64') } })
  content.push({ type: 'text', text: opts.text || (opts.photo ? 'Фото чека без подписи.' : '…') })

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...opts.history.map(h => ({ role: h.role, content: h.text }) as Anthropic.Beta.BetaMessageParam),
    { role: 'user', content },
  ]
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: BOOKKEEPER_SYSTEM, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: contextBlock({ today: ctx.today, weekday: WEEKDAYS[new Date(`${ctx.today}T12:00:00Z`).getUTCDay()], name: actor.name, role: actor.role, perms: actor.perms, fleet: fleetText(ctx.cars) }) },
  ]

  for (let i = 0; i < MAX_STEPS; i++) {
    const res = await anthropic().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system,
      tools: tools.map(t => t.def),
      messages,
    })
    usage.input += res.usage.input_tokens + (res.usage.cache_read_input_tokens || 0) + (res.usage.cache_creation_input_tokens || 0)
    usage.output += res.usage.output_tokens

    if (res.stop_reason === 'refusal') return { reply: 'С этим я помочь не могу.', pending, undo: ctx.undo, steps, usage }
    if (res.stop_reason === 'max_tokens') return { reply: 'Слишком длинный ответ получился — спросите, пожалуйста, короче.', pending, undo: ctx.undo, steps, usage }

    messages.push({ role: 'assistant', content: res.content })
    const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
    if (res.stop_reason !== 'tool_use' || !calls.length) {
      const reply = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('\n').trim()
      return { reply: reply || (pending.length ? 'Подготовил — проверьте и нажмите «Записать».' : 'Готово.'), pending, undo: ctx.undo, steps, usage }
    }

    // Все результаты инструментов — одним сообщением
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
    for (const call of calls) {
      const input = (call.input || {}) as Input
      const out = await runTool(ctx, call.name, input, pending)
      steps.push({ kind: 'tool', text: `${call.name}: ${out.text.slice(0, 300)}`, data: input })
      results.push({ type: 'tool_result', tool_use_id: call.id, content: out.text, ...(out.error ? { is_error: true } : {}) })
    }
    messages.push({ role: 'user', content: results })
  }
  return { reply: 'Не получилось разобраться за несколько шагов — напишите, пожалуйста, проще.', pending, undo: ctx.undo, steps, usage }
}

async function runTool(ctx: ToolCtx, name: string, input: Input, pending: PendingAction[]): Promise<{ text: string; error?: boolean }> {
  const tool = toolByName(name)
  if (!tool) return { text: `Нет такого инструмента: ${name}`, error: true }
  if (!allowed(ctx, tool)) return { text: 'Нет доступа к этому разделу', error: true }
  try {
    if (tool.mode !== 'confirm') {
      const text = await tool.run(ctx, input)
      return { text, error: text.startsWith('Ошибка') }
    }
    const prep = await tool.prepare!(ctx, input)
    if ('error' in prep) return { text: `Ошибка: ${prep.error}`, error: true }
    pending.push({ tool: name, input, summary: prep.summary })
    return { text: `Подготовлено, ждёт кнопки «Записать»: ${prep.summary}` }
  } catch (e) {
    console.error('tool', name, e)
    return { text: 'Ошибка: что-то пошло не так', error: true }
  }
}

// Нажали «Записать»: выполняем подготовленные действия по порядку
export async function runPending(db: SupabaseClient, actor: Actor, actions: PendingAction[]): Promise<string[]> {
  const ctx = await toolCtx(db, actor, null)
  const out: string[] = []
  for (const a of actions) {
    const tool = toolByName(a.tool)
    if (!tool || !allowed(ctx, tool)) { out.push(`✗ ${a.summary} — нет доступа`); continue }
    try {
      const text = await tool.run(ctx, a.input)
      out.push(`${text.startsWith('Ошибка') ? '✗' : '✓'} ${a.summary}${text.startsWith('Ошибка') ? ` — ${text.replace(/^Ошибка:\s*/, '')}` : ''}`)
    } catch (e) {
      console.error('pending', a.tool, e)
      out.push(`✗ ${a.summary} — что-то пошло не так`)
    }
  }
  return out
}

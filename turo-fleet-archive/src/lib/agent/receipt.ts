import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MODEL } from './agent'

// Чтение чека / скриншота (такси, Budget, тикет): итоговая сумма, дата, где куплено.
// Ответ строго по схеме (structured outputs) — без разбора текста. Каждый вызов пишется в журнал агентов (стоимость видна).

export interface ReceiptData { amount: number | null; date: string | null; merchant: string | null }

const SCHEMA = {
  type: 'object',
  properties: {
    amount: { type: ['number', 'null'], description: 'Итоговая оплаченная сумма в долларах (Total / Amount paid / Итого), с чаевыми и налогом. null — суммы на фото нет.' },
    date: { type: ['string', 'null'], description: 'Дата покупки или поездки в формате YYYY-MM-DD. null — даты нет.' },
    merchant: { type: ['string', 'null'], description: 'Где куплено: магазин, заправка, Uber/Lyft, Budget и т.п. null — непонятно.' },
  },
  required: ['amount', 'date', 'merchant'],
  additionalProperties: false,
}

let client: Anthropic | null = null

export async function readReceipt(db: SupabaseClient, userId: string, file: { bytes: Buffer; mime: string }): Promise<ReceiptData | null> {
  const source = file.mime === 'application/pdf'
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: file.bytes.toString('base64') } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: (file.mime === 'image/png' ? 'image/png' : 'image/jpeg') as 'image/jpeg', data: file.bytes.toString('base64') } }
  try {
    const res = await (client ||= new Anthropic()).beta.messages.create({
      model: MODEL, max_tokens: 2000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [source, { type: 'text', text: 'Это чек или скриншот оплаты (расход автопарка). Найди итоговую оплаченную сумму, дату и где куплено.' }] }],
    })
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('')
    const parsed = res.stop_reason === 'end_turn' && text ? JSON.parse(text) as ReceiptData : null
    const data: ReceiptData | null = parsed && {
      amount: typeof parsed.amount === 'number' && parsed.amount > 0 && parsed.amount < 100000 ? Math.round(parsed.amount * 100) / 100 : null,
      date: typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null,
      merchant: typeof parsed.merchant === 'string' ? parsed.merchant.slice(0, 80) : null,
    }
    await db.from('agent_runs').insert({
      agent: 'reader', user_id: userId, input: 'Фото чека в «Расходах»', status: data ? 'done' : 'error',
      output: data ? `${data.amount != null ? `$${data.amount}` : 'сумма не найдена'}${data.date ? ` · ${data.date}` : ''}${data.merchant ? ` · ${data.merchant}` : ''}` : 'не прочитал',
      input_tokens: res.usage.input_tokens + (res.usage.cache_read_input_tokens || 0), output_tokens: res.usage.output_tokens, finished_at: new Date().toISOString(),
    })
    return data
  } catch (e) {
    console.error('readReceipt', e)
    return null
  }
}

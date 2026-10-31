import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { canAny, type Ctx } from '../core'
import { inFleet } from '../calc'
import type { Actor } from './server'

// Инструменты агента-учётчика. Каждый инструмент = одно действие сайта.
// mode: read — только чтение; instant — пишет сразу (с кнопкой «Отменить»); confirm — сначала кнопка «Записать».
// perms — нужна хотя бы одна из галочек (как на сайте и в RLS базы).

export interface Photo { bytes: Buffer; mime: string }

export interface ToolCtx {
  db: SupabaseClient
  actor: Actor
  core: Ctx              // база + «История» от имени этого человека (через Telegram)
  today: string          // 'yyyy-MM-dd' по Лос-Анджелесу
  photos: Photo[]        // фото из этого сообщения (чек; альбом — инвойс + кассовый чек)
  cars: FleetCar[]
  undo: { kind: 'expense'; id: string; label: string }[]   // что записано сразу — для кнопки «Отменить»
}

export type Input = Record<string, unknown>

export interface AgentTool {
  def: Anthropic.Beta.BetaTool
  perms: string[]
  mode: 'read' | 'instant' | 'confirm'
  managersOnly?: boolean   // не для сотрудников (role employee): им бот только записывает расходы
  // confirm: проверить и описать действие для кнопки (ничего не пишет)
  prepare?: (ctx: ToolCtx, input: Input) => Promise<{ summary: string } | { error: string }>
  // read/instant — выполнить сейчас; confirm — после нажатия «Записать». Возвращает текст результата.
  run: (ctx: ToolCtx, input: Input) => Promise<string>
}

export const allowed = (ctx: Pick<ToolCtx, 'actor'>, t: Pick<AgentTool, 'perms' | 'managersOnly'>) =>
  canAny(ctx.actor, t.perms) && !(t.managersOnly && ctx.actor.role === 'employee')

// ── Парк для подсказки агенту ──

export interface FleetCar {
  id: string; make: string; model: string; plate: string
  oldPlates: string[]; idleSince: string | null; idleReason: string | null; account: string | null
}

export const carLabel = (c: Pick<FleetCar, 'make' | 'model' | 'plate'>) => `${c.make} ${c.model} ${c.plate}`

export async function loadFleet(db: SupabaseClient, today: string): Promise<FleetCar[]> {
  const [carsRes, blocksRes, platesRes, rcRes, accRes] = await Promise.all([
    db.from('cars').select('id, make, model, plate, delisted, removed_from').order('make').order('model'),
    db.from('car_blocks').select('car_id, start_date, end_date, reason').lte('start_date', today).or(`end_date.is.null,end_date.gte.${today}`),
    db.from('sticker_changes').select('car_id, old_plate').not('old_plate', 'is', null),
    db.from('revenue_cars').select('car_id, account, added_from, sold_from').not('car_id', 'is', null),
    db.from('revenue_accounts').select('key, label'),
  ])
  const period = `${today.slice(0, 8)}01`
  const labels = Object.fromEntries(((accRes.data || []) as { key: string; label: string }[]).map(a => [a.key, a.label]))
  return ((carsRes.data || []) as { id: string; make: string; model: string; plate: string; delisted: boolean; removed_from: string | null }[])
    .filter(c => inFleet(c, period))
    .map(c => {
      const b = ((blocksRes.data || []) as { car_id: string; start_date: string; reason: string | null }[]).find(x => x.car_id === c.id)
      const rc = ((rcRes.data || []) as { car_id: string; account: string; added_from: string; sold_from: string | null }[])
        .filter(r => r.car_id === c.id).sort((a, b) => b.added_from.localeCompare(a.added_from))
        .find(r => r.added_from <= period && (!r.sold_from || period < r.sold_from))
      return {
        id: c.id, make: c.make, model: c.model, plate: c.plate,
        oldPlates: ((platesRes.data || []) as { car_id: string; old_plate: string }[]).filter(p => p.car_id === c.id && p.old_plate.trim()).map(p => p.old_plate),
        idleSince: b?.start_date || null, idleReason: b?.reason || null, account: rc ? labels[rc.account] || rc.account : null,
      }
    })
}

// Парк одной строкой на машину — в подсказку агенту
export const fleetText = (cars: FleetCar[]) => cars.map(c =>
  `${c.id} | ${carLabel(c)}${c.oldPlates.length ? ` (был ${c.oldPlates.join(', ')})` : ''} | ${c.idleSince ? `в простое с ${c.idleSince}${c.idleReason ? `: ${c.idleReason}` : ''}` : 'в работе'}${c.account ? ` | аккаунт ${c.account}` : ''}`,
).join('\n')

// ── Проверка входных данных ──

export const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
export const optStr = (v: unknown) => str(v) || null
export const money = (v: unknown) => { const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN }
export const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
export const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}$/.test(v)
export const dateOr = (v: unknown, today: string) => (isDate(v) ? v : today)
export const monthOr = (v: unknown, today: string) => `${isMonth(v) ? v : today.slice(0, 7)}-01`
export const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

export function carOf(ctx: ToolCtx, id: unknown): FleetCar | null {
  return ctx.cars.find(c => c.id === id) || null
}

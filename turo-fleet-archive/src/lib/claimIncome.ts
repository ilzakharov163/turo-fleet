'use client'

import { createClient } from './supabase'
import { log } from './logger'

// Связь «Клеймы → Доходы»: сумма Initial / Supplement из клейма записывается строкой клейма
// (claim_items) в запись «Доходов» машины за выбранный месяц. Один клейм = одна строка (claim_id):
// Initial идёт в колонку claim, Supplement — в supplement + pct. Повторный ввод заменяет сумму,
// снятие галочки обнуляет её (строка без сумм удаляется).

export type ClaimKind = 'initial' | 'supplement'
export interface ClaimItemRow { claim: number; supplement: number; pct: number; claim_id?: string }

interface RevCar { id: string; account: string; added_from: string; sold_from: string | null }

// Запись «Доходов» этой машины, которая числится в этом месяце (period = 'yyyy-MM-01')
async function revenueCarFor(carId: string, period: string): Promise<RevCar | null> {
  const { data } = await createClient().from('revenue_cars').select('id, account, added_from, sold_from').eq('car_id', carId)
  const list = (data || []) as RevCar[]
  return list.find(c => c.added_from <= period && (!c.sold_from || period < c.sold_from)) || list.find(c => c.added_from <= period) || null
}

async function writeItems(revenueCarId: string, period: string, change: (items: ClaimItemRow[]) => ClaimItemRow[]) {
  const supabase = createClient()
  const { data: cur } = await supabase.from('revenue_entries').select('id, claim_items').eq('revenue_car_id', revenueCarId).eq('period', period).maybeSingle()
  const items = change(((cur?.claim_items as ClaimItemRow[]) || []).map(i => ({ ...i })))
  if (cur) {
    const { error } = await supabase.from('revenue_entries').update({ claim_items: items, updated_at: new Date().toISOString() }).eq('id', cur.id)
    return !error
  }
  if (!items.length) return true
  const { error } = await supabase.from('revenue_entries').insert({ revenue_car_id: revenueCarId, period, claim_items: items })
  return !error
}

// Записать сумму клейма в «Доходы». Возвращает текст ошибки или null.
export async function putClaimPayment(opts: {
  claimId: string; carId: string | null; kind: ClaimKind; amount: number; pct?: number; period: string
  prevPeriod?: string | null   // если сумма раньше была в другом месяце — убрать её оттуда
}): Promise<string | null> {
  if (!opts.carId) return 'У клейма не выбрана машина'
  const rc = await revenueCarFor(opts.carId, opts.period)
  if (!rc) return 'Эта машина не привязана к «Доходам» в этом месяце'
  if (opts.prevPeriod && opts.prevPeriod !== opts.period) {
    const prevRc = await revenueCarFor(opts.carId, opts.prevPeriod)
    if (prevRc) await writeItems(prevRc.id, opts.prevPeriod, items => setPart(items, opts.claimId, opts.kind, 0, 0))
  }
  const ok = await writeItems(rc.id, opts.period, items => setPart(items, opts.claimId, opts.kind, opts.amount, opts.pct ?? 0.2))
  if (!ok) return 'Не удалось записать в «Доходы»'
  await log('update', 'revenue_entry', rc.id, { period: opts.period, from_claim: opts.claimId, kind: opts.kind, amount: opts.amount })
  return null
}

// Убрать сумму клейма из «Доходов»
export async function dropClaimPayment(opts: { claimId: string; carId: string | null; kind: ClaimKind; period: string | null }) {
  if (!opts.carId || !opts.period) return true
  const rc = await revenueCarFor(opts.carId, opts.period)
  if (!rc) return true
  return writeItems(rc.id, opts.period, items => setPart(items, opts.claimId, opts.kind, 0, 0))
}

// Поставить сумму Initial или Supplement в строку этого клейма (0 — убрать)
function setPart(items: ClaimItemRow[], claimId: string, kind: ClaimKind, amount: number, pct: number) {
  const idx = items.findIndex(i => i.claim_id === claimId)
  const row: ClaimItemRow = idx >= 0 ? items[idx] : { claim: 0, supplement: 0, pct: 0, claim_id: claimId }
  if (kind === 'initial') row.claim = amount
  else { row.supplement = amount; row.pct = amount ? pct : 0 }
  if (idx < 0 && amount) items.push(row)
  return items.filter(i => i.claim || i.supplement)
}

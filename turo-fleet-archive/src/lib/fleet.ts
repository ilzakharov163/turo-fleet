'use client'

import { createClient } from './supabase'
import { log } from './logger'

// «Продана или разбита»: машина уходит со следующего месяца сразу везде —
// из парка (cars.removed_from → списки, счётчики, зарплата) и из «Доходов» (revenue_cars.sold_from).
// В текущем месяце остаётся как обычно. canFleet / canIncome — есть ли права на эти разделы.
export async function removeCarFrom(opts: { carId: string | null; revenueCarId?: string | null; from: string; canFleet: boolean; canIncome: boolean }) {
  const supabase = createClient()
  if (opts.carId && opts.canFleet) {
    const { error } = await supabase.from('cars').update({ removed_from: opts.from, updated_at: new Date().toISOString() }).eq('id', opts.carId)
    if (error) return false
    await log('update', 'car', opts.carId, { removed_from: opts.from })
  }
  if (opts.canIncome) {
    // Все записи «Доходов», привязанные к этой машине, плюс та, из которой нажали (даже если не привязана)
    let q = supabase.from('revenue_cars').update({ sold_from: opts.from }).is('sold_from', null)
    q = opts.carId && opts.revenueCarId ? q.or(`car_id.eq.${opts.carId},id.eq.${opts.revenueCarId}`)
      : opts.carId ? q.eq('car_id', opts.carId) : q.eq('id', opts.revenueCarId!)
    const { error } = await q
    if (error) return false
    if (opts.revenueCarId) await log('update', 'revenue_car', opts.revenueCarId, { sold_from: opts.from })
  }
  return true
}

// Вернуть машину: снимаем отметку и в парке, и в «Доходах» (только те записи, что были убраны тем же месяцем)
export async function restoreCar(opts: { carId: string | null; revenueCarId?: string | null; from: string | null; canFleet: boolean; canIncome: boolean }) {
  const supabase = createClient()
  if (opts.carId && opts.canFleet) {
    const { error } = await supabase.from('cars').update({ removed_from: null, updated_at: new Date().toISOString() }).eq('id', opts.carId)
    if (error) return false
    await log('update', 'car', opts.carId, { removed_from: null })
  }
  if (opts.canIncome && opts.from) {
    let q = supabase.from('revenue_cars').update({ sold_from: null }).eq('sold_from', opts.from)
    q = opts.carId && opts.revenueCarId ? q.or(`car_id.eq.${opts.carId},id.eq.${opts.revenueCarId}`)
      : opts.carId ? q.eq('car_id', opts.carId) : q.eq('id', opts.revenueCarId!)
    const { error } = await q
    if (error) return false
  }
  return true
}

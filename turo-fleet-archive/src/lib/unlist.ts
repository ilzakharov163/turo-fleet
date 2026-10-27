'use client'

import { createClient } from './supabase'
import { log } from './logger'

// Снять машину с листинга по клейму: простой с даты (причина «Клейм № … — описание»),
// у клейма still_listed=false. Если машина на эту дату уже в простое — новый простой не создаётся.
// Возвращает true, если всё записалось.
export async function unlistByClaim(opts: {
  carId: string; claimId: string; claimNumber: string | null; description: string | null
  date: string; endDate?: string | null
}): Promise<boolean> {
  const supabase = createClient()
  const { data: cur } = await supabase.from('car_blocks').select('id').eq('car_id', opts.carId)
    .lte('start_date', opts.date).or(`end_date.is.null,end_date.gte.${opts.date}`).limit(1)
  if (!cur?.length) {
    const reason = `Клейм${opts.claimNumber ? ` № ${opts.claimNumber}` : ''}${opts.description ? ` — ${opts.description}` : ''}`
    const { data, error } = await supabase.from('car_blocks')
      .insert({ car_id: opts.carId, start_date: opts.date, end_date: opts.endDate || null, reason }).select('id').single()
    if (error) return false
    await log('create', 'car_block', data?.id || '', { car_id: opts.carId, start_date: opts.date, end_date: opts.endDate || null, reason, from_claim: opts.claimId })
  }
  const { error } = await supabase.from('claims').update({ still_listed: false }).eq('id', opts.claimId)
  if (error) return false
  await log('update', 'claim', opts.claimId, { still_listed: false, unlisted_from: opts.date })
  return true
}

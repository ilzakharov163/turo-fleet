'use client'

import { createClient } from './supabase'

// Перевод номеров в латиницу и сравнение — общие с сервером (lib/core.ts)
export { normPlate, latinPlate, hasCyrillic } from './core'

// История номеров машин: «Наклейки → Замена номеров» пишет old_plate → new_plate в sticker_changes.
// Ранние записи (до 27.10.2026) без номеров — их здесь нет.

export interface PlateChange { car_id: string; changed_date: string; old_plate: string; new_plate: string | null }

export async function loadPlateHistory(): Promise<PlateChange[]> {
  const { data } = await createClient().from('sticker_changes').select('car_id, changed_date, old_plate, new_plate')
    .not('old_plate', 'is', null).order('changed_date', { ascending: false })
  return ((data || []) as PlateChange[]).filter(x => x.old_plate.trim())
}

// Прежние номера машины: car_id → [старые номера, новые первыми]
export function oldPlatesByCar(list: PlateChange[]): Record<string, string[]> {
  const m: Record<string, string[]> = {}
  for (const x of list) (m[x.car_id] ||= []).push(x.old_plate)
  return m
}

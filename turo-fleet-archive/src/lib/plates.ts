'use client'

import { createClient } from './supabase'

// История номеров машин: «Наклейки → Замена номеров» пишет old_plate → new_plate в sticker_changes.
// Ранние записи (до 27.10.2026) без номеров — их здесь нет.

export interface PlateChange { car_id: string; changed_date: string; old_plate: string; new_plate: string | null }

// Русские буквы, похожие на латинские (номер могли набрать в русской раскладке)
const LOOKALIKE: Record<string, string> = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X' }

// Номер для сравнения: заглавные, без пробелов и дефисов, русские «двойники» → латиница
export const normPlate = (s: string | null | undefined) =>
  (s || '').toUpperCase().replace(/[\s-]/g, '').replace(/[АВЕКМНОРСТУХ]/g, ch => LOOKALIKE[ch] || ch)

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

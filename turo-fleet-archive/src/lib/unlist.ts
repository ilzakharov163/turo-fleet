'use client'

import { createClient } from './supabase'
import { log } from './logger'
import * as core from './core'
import type { Block } from './core'

// Простои и клеймы на сайте: общий код в lib/core.ts, здесь — база и «История» текущего пользователя.
const ctx = (): core.Ctx => ({ db: createClient(), log })

// Снять машину с листинга по клейму (простой с даты + still_listed=false). Возвращает true, если всё записалось.
export const unlistByClaim = (opts: Parameters<typeof core.unlistByClaim>[1]) => core.unlistByClaim(ctx(), opts)

// «В простой» по клейму или другой причине — см. core.putIdle
export const putIdle = (opts: Parameters<typeof core.putIdle>[1]) => core.putIdle(ctx(), opts)

// Вернуть в работу с даты: простой заканчивается накануне
export const endIdle = (opts: Parameters<typeof core.endIdle>[1]) => core.endIdle(ctx(), opts)

// Простой машины на дату по клейму (сначала с номером клейма в причине)
export const claimBlockOn = (c: { car_id: string | null; claim_number: string | null }, date: string) => core.claimBlockOn(createClient(), c, date)

// «Завершить» клейм (и, если нужно, вернуть машину в работу)
export const completeClaim = (opts: Parameters<typeof core.completeClaim>[1]) => core.completeClaim(ctx(), opts)

export type { Block }

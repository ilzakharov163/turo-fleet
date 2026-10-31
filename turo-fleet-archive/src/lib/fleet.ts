'use client'

import { createClient } from './supabase'
import { log } from './logger'
import * as core from './core'

// «Продана или разбита» на сайте: общий код в lib/core.ts, здесь — база и «История» текущего пользователя.
const ctx = (): core.Ctx => ({ db: createClient(), log })

// Убрать машину со следующего месяца сразу из парка и из «Доходов»
export const removeCarFrom = (opts: Parameters<typeof core.removeCarFrom>[1]) => core.removeCarFrom(ctx(), opts)

// Вернуть машину в парк и в «Доходы»
export const restoreCar = (opts: Parameters<typeof core.restoreCar>[1]) => core.restoreCar(ctx(), opts)

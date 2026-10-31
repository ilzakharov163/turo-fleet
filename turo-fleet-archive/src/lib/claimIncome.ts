'use client'

import { createClient } from './supabase'
import { log } from './logger'
import * as core from './core'

// Связь «Клеймы → Доходы» на сайте: общий код в lib/core.ts, здесь — база и «История» текущего пользователя.
const ctx = (): core.Ctx => ({ db: createClient(), log })

export type { ClaimKind, ClaimItemRow } from './core'

// Записать сумму клейма в «Доходы». Возвращает текст ошибки или null.
export const putClaimPayment = (opts: Parameters<typeof core.putClaimPayment>[1]) => core.putClaimPayment(ctx(), opts)

// Initial / Supplement получен: сумма в клейме + строка в «Доходах» (если есть доступ)
export const recordClaimPayment = (opts: Parameters<typeof core.recordClaimPayment>[1]) => core.recordClaimPayment(ctx(), opts)

// Убрать сумму клейма из «Доходов»
export const dropClaimPayment = (opts: Parameters<typeof core.dropClaimPayment>[1]) => core.dropClaimPayment(ctx(), opts)

'use client'

import { format } from 'date-fns'
import { createClient } from './supabase'
import { ACCOUNT_COLORS } from './accountColors'

// На каком аккаунте «Доходов» машина: запись revenue_cars, что числится в текущем месяце, иначе последняя.
// Без доступа к «Доходам» запросы вернут ошибку — тогда аккаунтов просто нет.

export interface CarAccount { key: string; label: string; dot: string }

export async function loadCarAccounts(): Promise<{ accounts: CarAccount[]; byCar: Record<string, CarAccount> }> {
  const supabase = createClient()
  const [rcRes, accRes] = await Promise.all([
    supabase.from('revenue_cars').select('car_id, account, added_from, sold_from').not('car_id', 'is', null),
    supabase.from('revenue_accounts').select('key, label').order('sort'),
  ])
  const accounts = ((accRes.data || []) as { key: string; label: string }[])
    .map((a, i) => ({ key: a.key, label: a.label, dot: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length].dot }))
  const now = format(new Date(), 'yyyy-MM-01')
  const byCar: Record<string, CarAccount> = {}
  // Сначала старые записи, потом те, что числятся в текущем месяце, — они перезаписывают
  const rcs = ((rcRes.data || []) as { car_id: string; account: string; added_from: string; sold_from: string | null }[])
    .map(rc => ({ rc, cur: rc.added_from <= now && (!rc.sold_from || now < rc.sold_from) }))
    .sort((a, b) => Number(a.cur) - Number(b.cur) || a.rc.added_from.localeCompare(b.rc.added_from))
  for (const { rc } of rcs) {
    const acc = accounts.find(a => a.key === rc.account)
    if (acc) byCar[rc.car_id] = acc
  }
  return { accounts, byCar }
}

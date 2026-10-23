'use client'

import { useEffect, useMemo, useState } from 'react'
import { Send, Copy, Check, Download } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { createClient } from '@/lib/supabase'
import { notify } from '@/lib/ui'
import { calcEntry, num, type RevenueEntry } from '@/lib/calc'
import MonthPicker from '@/components/ui/MonthPicker'

// Отчёт «Прибыль по машинам»: итог каждой машины (как в «Доходах») за месяц или за всё время.
// Одна машина парка может быть в нескольких аккаунтах — объединяем по car_id; непривязанные — отдельно.

interface Acc { key: string; label: string; active_from: string; active_until: string | null }
interface RCar { id: string; account: string; name: string; car_id: string | null; added_from: string; sold_from: string | null; car: { make: string; model: string; plate: string; removed_from: string | null } | null }
interface Entry extends RevenueEntry { revenue_car_id: string; period: string }

interface Row {
  key: string
  name: string
  plate: string
  accounts: string[]
  months: string[]          // месяцы с данными
  gross: number
  claims: number            // клеймы после вычета
  costs: number             // ремонт + прочее
  payments: number          // платежи за машину
  net: number
  gone: boolean             // продана / разбита / аккаунт закрыт
}

type Cell = string | number
const usd = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
const mName = (p: string, f = 'LLLL yyyy') => format(parseISO(p), f, { locale: ru })
const monthsWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'месяц' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'месяца' : 'месяцев')

export default function CarProfitView() {
  const [loading, setLoading] = useState(true)
  const [accs, setAccs] = useState<Acc[]>([])
  const [rcars, setRcars] = useState<RCar[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [mode, setMode] = useState<'month' | 'all'>('month')
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.from('revenue_accounts').select('key, label, active_from, active_until'),
      supabase.from('revenue_cars').select('id, account, name, car_id, added_from, sold_from, car:cars(make, model, plate, removed_from)'),
      supabase.from('revenue_entries').select('revenue_car_id, period, gross, repair, claim_items, other_items, payment'),
    ]).then(([a, c, e]) => {
      setAccs((a.data || []) as Acc[])
      setRcars((c.data || []) as unknown as RCar[])
      setEntries((e.data || []) as Entry[])
      setLoading(false)
    })
  }, [])

  const firstMonth = useMemo(() => entries.map(e => e.period).sort()[0]?.slice(0, 7) || month, [entries, month])
  const curMonth = format(new Date(), 'yyyy-MM')
  const period = `${month}-01`

  const rows = useMemo(() => {
    const accLabel = (k: string) => accs.find(a => a.key === k)?.label || k
    const accActive = (k: string, p: string) => { const a = accs.find(x => x.key === k); return !!a && a.active_from <= p && (!a.active_until || p <= a.active_until) }
    const byKey = new Map<string, Row>()
    for (const rc of rcars) {
      const own = entries.filter(e => e.revenue_car_id === rc.id && (mode === 'all' || e.period === period))
      // В месячном режиме показываем и машины без данных, если они в этом месяце числились в работающем аккаунте
      const visible = mode === 'month' && rc.added_from <= period && (!rc.sold_from || period < rc.sold_from) && accActive(rc.account, period)
      if (!own.length && !visible) continue
      const key = rc.car_id || rc.id
      const row = byKey.get(key) || {
        key,
        name: rc.car ? `${rc.car.make} ${rc.car.model}` : rc.name,
        plate: rc.car?.plate || '',
        accounts: [], months: [], gross: 0, claims: 0, costs: 0, payments: 0, net: 0, gone: true,
      }
      if (!row.accounts.includes(accLabel(rc.account))) row.accounts.push(accLabel(rc.account))
      for (const e of own) {
        const t = calcEntry(e)
        row.gross += t.gross
        row.claims += t.claim + t.supp - t.ded
        row.costs += t.repair + t.other
        row.payments += t.payment
        row.net += t.net
        if (!row.months.includes(e.period)) row.months.push(e.period)
      }
      // «Ушла»: все записи этой машины убраны, или машина убрана из парка, или аккаунт закрыт
      const stillHere = (!rc.sold_from || rc.sold_from > `${curMonth}-01`) && accActive(rc.account, `${curMonth}-01`) && !(rc.car?.removed_from && rc.car.removed_from <= `${curMonth}-01`)
      if (stillHere) row.gone = false
      byKey.set(key, row)
    }
    return [...byKey.values()].map(r => ({ ...r, months: r.months.sort() })).sort((a, b) => b.net - a.net || a.name.localeCompare(b.name, 'ru'))
  }, [accs, rcars, entries, mode, period, curMonth])

  const total = rows.reduce((s, r) => s + r.net, 0)
  const allMonths = [...new Set(rows.flatMap(r => r.months))].sort()
  const title = mode === 'all'
    ? `Прибыль по машинам за всё время${allMonths.length ? ` (${mName(allMonths[0], 'LLLL yyyy')} — ${mName(allMonths[allMonths.length - 1], 'LLLL yyyy')}, ${allMonths.length} ${monthsWord(allMonths.length)})` : ''}`
    : `Прибыль по машинам за ${mName(period)}`

  const text = [
    `🚗 ${title}`,
    '',
    ...rows.map((r, i) => {
      const extra = mode === 'all' ? ` · ${r.months.length} ${monthsWord(r.months.length)} · в среднем ${usd(r.months.length ? r.net / r.months.length : 0)}/мес` : ''
      return `${i + 1}. ${r.name}${r.plate ? ` ${r.plate}` : ''} — ${usd(r.net)}${extra}${r.gone ? ' (уже нет)' : ''}`
    }),
    '',
    `Итого: ${usd(total)} · машин: ${rows.length}`,
  ].join('\n')

  function csv(): Cell[][] {
    const head: Cell[] = ['№', 'Машина', 'Номер', 'Аккаунт', ...(mode === 'all' ? ['Месяцев', 'С', 'По'] : []), 'Gross', 'Клеймы (после вычета)', 'Ремонт и прочее', 'Платежи', 'Итог', ...(mode === 'all' ? ['В среднем за месяц'] : []), 'Статус']
    return [
      [title], [],
      head,
      ...rows.map((r, i) => [
        i + 1, r.name, r.plate, r.accounts.join(', '),
        ...(mode === 'all' ? [r.months.length, r.months[0] ? mName(r.months[0], 'LLL yyyy') : '', r.months.length ? mName(r.months[r.months.length - 1], 'LLL yyyy') : ''] : []),
        round(r.gross), round(r.claims), round(-r.costs), round(-r.payments), round(r.net),
        ...(mode === 'all' ? [round(r.months.length ? r.net / r.months.length : 0)] : []),
        r.gone ? 'уже нет' : 'в работе',
      ] as Cell[]),
      [], ['Итого', '', '', '', ...(mode === 'all' ? ['', '', ''] : []), round(rows.reduce((s, r) => s + r.gross, 0)), round(rows.reduce((s, r) => s + r.claims, 0)), round(-rows.reduce((s, r) => s + r.costs, 0)), round(-rows.reduce((s, r) => s + r.payments, 0)), round(total)],
    ]
  }

  async function share() {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share({ text }) } catch { /* отменено */ }
      return
    }
    copy()
  }
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch { notify('Не удалось скопировать — попробуй ещё раз', 'error') }
  }
  function excel() {
    const esc = (v: Cell) => `"${String(v).replace(/"/g, '""')}"`
    const blob = new Blob(['﻿' + csv().map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = mode === 'all' ? `pribyl-mashin-vse-${format(new Date(), 'yyyy-MM-dd')}.csv` : `pribyl-mashin-${month}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const seg = (on: boolean) => `h-9 px-3.5 rounded-lg text-sm font-medium transition-colors ${on ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`

  return (
    <div className="space-y-4">
      {/* Режим и месяц */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex p-1 bg-gray-100 rounded-xl">
          <button onClick={() => setMode('month')} className={seg(mode === 'month')}>За месяц</button>
          <button onClick={() => setMode('all')} className={seg(mode === 'all')}>За всё время</button>
        </div>
        {mode === 'month' && <MonthPicker value={month} onChange={setMonth} min={firstMonth} max={curMonth} />}
        <div className="flex gap-2 sm:ml-auto w-full sm:w-auto">
          <button onClick={share} disabled={loading} className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 h-10 px-3.5 rounded-xl bg-[#229ED9] hover:bg-[#1c8cc2] disabled:opacity-50 text-white text-sm font-medium whitespace-nowrap"><Send size={15} /> Telegram</button>
          <button onClick={copy} disabled={loading} className="btn-secondary inline-flex items-center justify-center gap-1.5 h-10 px-3.5">{copied ? <><Check size={15} className="text-green-600" /> Скопировано</> : <><Copy size={15} /> Копировать</>}</button>
          <button onClick={excel} disabled={loading} className="btn-secondary inline-flex items-center justify-center gap-1.5 h-10 px-3.5"><Download size={15} /> Excel</button>
        </div>
      </div>

      {/* Итоги */}
      <div className="bg-white rounded-[18px] border border-gray-100/80 card-shadow p-4 sm:p-5">
        <p className="text-sm text-gray-500">{title.replace('Прибыль по машинам', 'Чистая прибыль машин')}</p>
        {loading ? <div className="skeleton h-9 w-40 mt-1.5" /> : (
          <>
            <p className={`text-3xl font-bold tracking-tight tabular-nums mt-1 ${total < 0 ? 'text-red-600' : 'text-gray-900'}`}>{usd(total)}</p>
            <p className="text-xs text-gray-400 mt-1">
              машин: {rows.length}
              {rows.filter(r => r.net < 0).length > 0 && <> · в минусе: <span className="text-red-500">{rows.filter(r => r.net < 0).length}</span></>}
              {' · '}итог машины — с её платежом, до расходов компании, зарплаты и общих платежей
            </p>
          </>
        )}
      </div>

      {/* Список */}
      <div className="bg-white rounded-[18px] border border-gray-100/80 card-shadow overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-2">{[0, 1, 2, 3, 4].map(i => <div key={i} className="skeleton h-12" />)}</div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400">Нет данных за этот период</p>
        ) : (
          <>
            {/* Телефон — карточки */}
            <ul className="sm:hidden divide-y divide-gray-100">
              {rows.map((r, i) => (
                <li key={r.key} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate"><span className="text-gray-400 font-normal tabular-nums">{i + 1}.</span> {r.name}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {r.plate && <span className="font-mono font-semibold text-gray-600">{r.plate}</span>}{r.plate ? ' · ' : ''}{r.accounts.join(', ')}
                        {r.gone && <span className="text-orange-500"> · уже нет</span>}
                      </p>
                    </div>
                    <span className={`text-base font-bold tabular-nums whitespace-nowrap ${r.net < 0 ? 'text-red-600' : 'text-gray-900'}`}>{usd(r.net)}</span>
                  </div>
                  {r.payments > 0 && <p className="text-xs text-gray-400 mt-1">платежи −{usd(r.payments)}</p>}
                  {mode === 'all' && (
                    <p className="text-xs text-gray-400 mt-1">
                      {r.months.length} {monthsWord(r.months.length)}{r.months.length ? ` (${mName(r.months[0], 'LLL')} — ${mName(r.months[r.months.length - 1], 'LLL yyyy')})` : ''} · в среднем {usd(r.months.length ? r.net / r.months.length : 0)}/мес
                    </p>
                  )}
                </li>
              ))}
            </ul>

            {/* Компьютер — таблица */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3 font-medium w-10">№</th>
                    <th className="px-4 py-3 font-medium">Машина</th>
                    <th className="px-4 py-3 font-medium">Аккаунт</th>
                    {mode === 'all' && <th className="px-4 py-3 font-medium">Месяцев</th>}
                    <th className="px-4 py-3 font-medium text-right">Gross</th>
                    <th className="px-4 py-3 font-medium text-right">Клеймы</th>
                    <th className="px-4 py-3 font-medium text-right">Ремонт и прочее</th>
                    <th className="px-4 py-3 font-medium text-right">Платежи</th>
                    <th className="px-4 py-3 font-medium text-right">Итог</th>
                    {mode === 'all' && <th className="px-4 py-3 font-medium text-right">В среднем / мес</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r, i) => (
                    <tr key={r.key} className={r.gone ? 'text-gray-400' : ''}>
                      <td className="px-4 py-2.5 text-gray-400">{i + 1}</td>
                      <td className="px-4 py-2.5">
                        <span className={`font-medium ${r.gone ? '' : 'text-gray-900'}`}>{r.name}</span>
                        {r.plate && <span className="ml-1.5 font-mono text-xs font-semibold text-gray-500">{r.plate}</span>}
                        {r.gone && <span className="ml-2 text-xs text-orange-500">уже нет</span>}
                      </td>
                      <td className="px-4 py-2.5 text-gray-500">{r.accounts.join(', ')}</td>
                      {mode === 'all' && <td className="px-4 py-2.5 text-gray-500">{r.months.length}{r.months.length ? <span className="text-xs text-gray-400"> · {mName(r.months[0], 'LLL')}–{mName(r.months[r.months.length - 1], 'LLL')}</span> : null}</td>}
                      <td className="px-4 py-2.5 text-right">{r.gross ? usd(r.gross) : '—'}</td>
                      <td className="px-4 py-2.5 text-right">{r.claims ? usd(r.claims) : '—'}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{r.costs ? `−${usd(r.costs)}` : '—'}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{r.payments ? `−${usd(r.payments)}` : '—'}</td>
                      <td className={`px-4 py-2.5 text-right font-semibold ${r.net < 0 ? 'text-red-600' : r.gone ? '' : 'text-gray-900'}`}>{usd(r.net)}</td>
                      {mode === 'all' && <td className="px-4 py-2.5 text-right text-gray-500">{usd(r.months.length ? r.net / r.months.length : 0)}</td>}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 font-semibold text-gray-900">
                    <td className="px-4 py-3" colSpan={mode === 'all' ? 4 : 3}>Итого · машин: {rows.length}</td>
                    <td className="px-4 py-3 text-right">{usd(rows.reduce((s, r) => s + r.gross, 0))}</td>
                    <td className="px-4 py-3 text-right">{usd(rows.reduce((s, r) => s + r.claims, 0))}</td>
                    <td className="px-4 py-3 text-right text-gray-500">−{usd(rows.reduce((s, r) => s + r.costs, 0))}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{rows.some(r => r.payments) ? `−${usd(rows.reduce((s, r) => s + r.payments, 0))}` : '—'}</td>
                    <td className={`px-4 py-3 text-right ${total < 0 ? 'text-red-600' : ''}`}>{usd(total)}</td>
                    {mode === 'all' && <td />}
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const round = (v: number) => Math.round(num(v) * 100) / 100

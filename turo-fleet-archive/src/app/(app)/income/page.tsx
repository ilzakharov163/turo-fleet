'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import { log } from '@/lib/logger'
import { Car } from '@/types'
import {
  ChevronLeft, ChevronRight, ChevronDown, Plus, X, Trash2, Send, Copy, Check, Download,
  Wallet, TrendingUp, TrendingDown, Receipt, Users, CarFront, Link2, Archive,
} from 'lucide-react'
import {
  format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isWithinInterval, addMonths, subMonths,
} from 'date-fns'
import { ru } from 'date-fns/locale'

// ── Типы ──
type ClaimItem = { claim: number; supplement: number; pct: number }
type OtherItem = { desc: string; amount: number }

interface Account { key: string; label: string; sort: number; active_from: string; active_until: string | null }
interface RCar {
  id: string; account: string; name: string; car_id: string | null
  added_from: string; sold_from: string | null; sort: number
  car?: { make: string; model: string; plate: string } | null
}
interface Entry {
  id?: string; revenue_car_id: string; period: string
  gross: number; repair: number; claim_items: ClaimItem[]; other_items: OtherItem[]
}
interface MonthExp { period: string; salary1: number; salary2: number; items: OtherItem[] }
interface Block { car_id: string; start_date: string; end_date: string | null }

type Cell = string | number

// ── Расчёты (та же логика, что в TuroTracker) ──
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
function calc(e?: Entry | null) {
  const items = e?.claim_items || []
  const gross = n(e?.gross)
  const claim = items.reduce((s, c) => s + n(c.claim), 0)
  const supp = items.reduce((s, c) => s + n(c.supplement), 0)
  const ded = items.reduce((s, c) => s + n(c.supplement) * n(c.pct), 0)
  const repair = n(e?.repair)
  const other = (e?.other_items || []).reduce((s, o) => s + n(o.amount), 0)
  const net = gross + claim + supp - ded - repair - other
  return { gross, claim, supp, ded, repair, other, net }
}
type Totals = ReturnType<typeof calc>
const zero = (): Totals => ({ gross: 0, claim: 0, supp: 0, ded: 0, repair: 0, other: 0, net: 0 })
const add = (a: Totals, b: Totals): Totals => ({
  gross: a.gross + b.gross, claim: a.claim + b.claim, supp: a.supp + b.supp, ded: a.ded + b.ded,
  repair: a.repair + b.repair, other: a.other + b.other, net: a.net + b.net,
})
const expTotal = (m?: MonthExp | null) => n(m?.salary1) + n(m?.salary2) + (m?.items || []).reduce((s, i) => s + n(i.amount), 0)

const money = (v: number) => {
  const r = Math.round(v * 100) / 100
  const s = Math.abs(r).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  return `${r < 0 ? '−' : ''}$${s}`
}
const pctLabel = (p: number) => `${Math.round(n(p) * 1000) / 10}%`

const carVisible = (c: RCar, p: string) => c.added_from <= p && (!c.sold_from || p < c.sold_from)
const accActive = (a: Account, p: string) => a.active_from <= p && (!a.active_until || p <= a.active_until)

function calcSalary(inactive: number, total: number) {
  if (inactive >= total) return 0
  if (inactive >= 14) return 75
  return 150
}
const blockEnd = (b: Block) => (b.end_date ? parseISO(b.end_date) : new Date(9999, 0))

function downloadCsv(rows: Cell[][], file: string) {
  const esc = (v: Cell) => `"${String(v).replace(/"/g, '""')}"`
  const csv = '\uFEFF' + rows.map(r => r.map(esc).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = file; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function copyText(text: string, done: () => void) {
  try { await navigator.clipboard.writeText(text); done() } catch { /* ignore */ }
}
async function shareText(text: string, done: () => void) {
  if (typeof navigator !== 'undefined' && navigator.share) {
    try { await navigator.share({ text }) } catch { /* отменено */ }
    return
  }
  copyText(text, done)
}

const inputCls = 'w-full px-2.5 py-2 rounded-lg border border-gray-200 bg-white text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-500'
const btnGhost = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-white border border-gray-200 hover:bg-gray-100 text-gray-700 text-sm font-medium transition-colors'

// ── Редактор одной машины за месяц ──
function EntryEditor({ entry, onSave, onCancel }: { entry: Entry; onSave: (e: Entry) => Promise<void>; onCancel: () => void }) {
  const [gross, setGross] = useState(entry.gross ? String(entry.gross) : '')
  const [repair, setRepair] = useState(entry.repair ? String(entry.repair) : '')
  const [claims, setClaims] = useState(entry.claim_items.map(c => ({
    claim: c.claim ? String(c.claim) : '', supplement: c.supplement ? String(c.supplement) : '', pct: c.pct ? String(Math.round(n(c.pct) * 1000) / 10) : '',
  })))
  const [others, setOthers] = useState(entry.other_items.map(o => ({ desc: o.desc, amount: o.amount ? String(o.amount) : '' })))
  const [saving, setSaving] = useState(false)

  const draft: Entry = {
    ...entry,
    gross: n(gross), repair: n(repair),
    claim_items: claims.filter(c => c.claim || c.supplement).map(c => ({ claim: n(c.claim), supplement: n(c.supplement), pct: n(c.pct) / 100 })),
    other_items: others.filter(o => o.desc.trim() || o.amount).map(o => ({ desc: o.desc.trim(), amount: n(o.amount) })),
  }
  const t = calc(draft)

  async function save() {
    setSaving(true)
    await onSave(draft)
    setSaving(false)
  }

  return (
    <div className="border-t border-gray-100 bg-gray-50/60 px-3 sm:px-4 py-4 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xs font-medium text-gray-500 mb-1">Gross (доход Turo)</span>
          <input inputMode="decimal" value={gross} onChange={e => setGross(e.target.value)} placeholder="0" className={inputCls} />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-500 mb-1">Ремонт</span>
          <input inputMode="decimal" value={repair} onChange={e => setRepair(e.target.value)} placeholder="0" className={inputCls} />
        </label>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Клеймы</span>
          <button type="button" onClick={() => setClaims(c => [...c, { claim: '', supplement: '', pct: '20' }])} className="text-xs font-medium text-indigo-600 hover:underline inline-flex items-center gap-1"><Plus size={13} /> клейм</button>
        </div>
        {claims.length === 0 && <p className="text-xs text-gray-400">Нет клеймов</p>}
        <div className="space-y-2">
          {claims.map((c, i) => {
            const ded = n(c.supplement) * n(c.pct) / 100
            return (
              <div key={i} className="grid grid-cols-[1fr_1fr_64px_28px] gap-2 items-end">
                <label className="block min-w-0">
                  {i === 0 && <span className="block text-[11px] text-gray-400 mb-1">Initial</span>}
                  <input inputMode="decimal" value={c.claim} onChange={e => setClaims(cs => cs.map((x, j) => j === i ? { ...x, claim: e.target.value } : x))} placeholder="0" className={inputCls} />
                </label>
                <label className="block min-w-0">
                  {i === 0 && <span className="block text-[11px] text-gray-400 mb-1">Supplement</span>}
                  <input inputMode="decimal" value={c.supplement} onChange={e => setClaims(cs => cs.map((x, j) => j === i ? { ...x, supplement: e.target.value } : x))} placeholder="0" className={inputCls} />
                </label>
                <label className="block min-w-0">
                  {i === 0 && <span className="block text-[11px] text-gray-400 mb-1">% вычета</span>}
                  <input inputMode="decimal" value={c.pct} onChange={e => setClaims(cs => cs.map((x, j) => j === i ? { ...x, pct: e.target.value } : x))} placeholder="0" className={inputCls} title={ded ? `Вычет ${money(ded)}` : undefined} />
                </label>
                <button type="button" onClick={() => setClaims(cs => cs.filter((_, j) => j !== i))} className="h-9 flex items-center justify-center text-gray-300 hover:text-red-500" aria-label="Убрать клейм"><X size={16} /></button>
              </div>
            )
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Прочие расходы по машине</span>
          <button type="button" onClick={() => setOthers(o => [...o, { desc: '', amount: '' }])} className="text-xs font-medium text-indigo-600 hover:underline inline-flex items-center gap-1"><Plus size={13} /> расход</button>
        </div>
        {others.length === 0 && <p className="text-xs text-gray-400">Нет</p>}
        <div className="space-y-2">
          {others.map((o, i) => (
            <div key={i} className="grid grid-cols-[1fr_100px_28px] gap-2">
              <input value={o.desc} onChange={e => setOthers(os => os.map((x, j) => j === i ? { ...x, desc: e.target.value } : x))} placeholder="Что (такс, негатив, репо…)" className={inputCls} />
              <input inputMode="decimal" value={o.amount} onChange={e => setOthers(os => os.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} placeholder="0" className={inputCls} />
              <button type="button" onClick={() => setOthers(os => os.filter((_, j) => j !== i))} className="flex items-center justify-center text-gray-300 hover:text-red-500" aria-label="Убрать расход"><X size={16} /></button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="text-xs text-gray-500 tabular-nums">
          {money(t.gross)} + {money(t.claim + t.supp)} клеймы − {money(t.ded)} вычет − {money(t.repair + t.other)} расходы ={' '}
          <b className={t.net < 0 ? 'text-red-600' : 'text-gray-900'}>{money(t.net)}</b>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className={btnGhost}>Отмена</button>
          <button type="button" onClick={save} disabled={saving} className="px-4 py-2 rounded-[10px] bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium">{saving ? 'Сохраняю…' : 'Сохранить'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Редактор расходов компании за месяц ──
function ExpensesEditor({ value, period, payroll, onSave }: { value: MonthExp; period: string; payroll: number; onSave: (m: MonthExp) => Promise<void> }) {
  const [s1, setS1] = useState(value.salary1 ? String(value.salary1) : '')
  const [s2, setS2] = useState(value.salary2 ? String(value.salary2) : '')
  const [items, setItems] = useState(value.items.map(i => ({ desc: i.desc, amount: i.amount ? String(i.amount) : '' })))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const draft: MonthExp = {
    period, salary1: n(s1), salary2: n(s2),
    items: items.filter(i => i.desc.trim() || i.amount).map(i => ({ desc: i.desc.trim(), amount: n(i.amount) })),
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify({ period, salary1: n(value.salary1), salary2: n(value.salary2), items: value.items.map(i => ({ desc: i.desc, amount: n(i.amount) })) })

  async function save() {
    setSaving(true)
    await onSave(draft)
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="bg-white rounded-[18px] border border-gray-100/80 card-shadow p-4 sm:p-5 space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xs font-medium text-gray-500 mb-1">Зарплата 1</span>
          <input inputMode="decimal" value={s1} onChange={e => setS1(e.target.value)} placeholder="0" className={inputCls} />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-500 mb-1">Зарплата 2</span>
          <input inputMode="decimal" value={s2} onChange={e => setS2(e.target.value)} placeholder="0" className={inputCls} />
        </label>
      </div>
      {payroll > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-indigo-50 border border-indigo-100 px-3 py-2.5 text-sm">
          <span className="text-indigo-900">Зарплата работника по календарю простоев: <b>{money(payroll)}</b></span>
          <button type="button" onClick={() => setS2(String(payroll))} className="text-xs font-medium text-indigo-700 hover:underline">Подставить в «Зарплата 2»</button>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Расходы компании</span>
          <button type="button" onClick={() => setItems(i => [...i, { desc: '', amount: '' }])} className="text-xs font-medium text-indigo-600 hover:underline inline-flex items-center gap-1"><Plus size={13} /> добавить</button>
        </div>
        {items.length === 0 && <p className="text-sm text-gray-400">Пока нет расходов</p>}
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-[1fr_110px_28px] gap-2">
              <input value={it.desc} onChange={e => setItems(xs => xs.map((x, j) => j === i ? { ...x, desc: e.target.value } : x))} placeholder="Описание" className={inputCls} />
              <input inputMode="decimal" value={it.amount} onChange={e => setItems(xs => xs.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} placeholder="0" className={inputCls} />
              <button type="button" onClick={() => setItems(xs => xs.filter((_, j) => j !== i))} className="flex items-center justify-center text-gray-300 hover:text-red-500" aria-label="Удалить строку"><X size={16} /></button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
        <span className="text-sm text-gray-600">Итого расходов: <b className="text-gray-900 tabular-nums">{money(expTotal(draft))}</b></span>
        <button type="button" onClick={save} disabled={saving || !dirty} className="px-4 py-2 rounded-[10px] bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-medium">
          {saving ? 'Сохраняю…' : saved ? 'Сохранено ✓' : 'Сохранить'}
        </button>
      </div>
    </div>
  )
}

// ── Страница ──
export default function IncomePage() {
  const [loading, setLoading] = useState(true)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [rcars, setRcars] = useState<RCar[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [monthExp, setMonthExp] = useState<MonthExp[]>([])
  const [fleet, setFleet] = useState<Car[]>([])
  const [blocks, setBlocks] = useState<Block[]>([])
  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()))
  const [tab, setTab] = useState<string>('summary')
  const [open, setOpen] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [addCar, setAddCar] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCarId, setNewCarId] = useState('')
  const [showArchive, setShowArchive] = useState(false)

  const load = useCallback(async () => {
    const supabase = createClient()
    const [a, c, e, m, f, b] = await Promise.all([
      supabase.from('revenue_accounts').select('*').order('sort'),
      supabase.from('revenue_cars').select('*, car:cars(make,model,plate)').order('sort'),
      supabase.from('revenue_entries').select('id, revenue_car_id, period, gross, repair, claim_items, other_items'),
      supabase.from('revenue_month_expenses').select('period, salary1, salary2, items'),
      supabase.from('cars').select('*'),
      supabase.from('car_blocks').select('car_id, start_date, end_date'),
    ])
    setAccounts((a.data as Account[]) || [])
    setRcars((c.data as RCar[]) || [])
    setEntries(((e.data as Entry[]) || []).map(x => ({ ...x, gross: n(x.gross), repair: n(x.repair) })))
    setMonthExp((m.data as MonthExp[]) || [])
    setFleet((f.data as Car[]) || [])
    setBlocks((b.data as Block[]) || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const period = format(month, 'yyyy-MM-01')
  const monthLabel = format(month, 'LLLL yyyy', { locale: ru })
  const isCurrent = period === format(new Date(), 'yyyy-MM-01')

  const entryOf = useCallback((carId: string, p: string) => entries.find(e => e.revenue_car_id === carId && e.period === p) || null, [entries])

  // Машины и аккаунты, видимые в месяце
  const carsIn = useCallback((acc: string, p: string) =>
    rcars.filter(c => c.account === acc && (carVisible(c, p) || entryOf(c.id, p))), [rcars, entryOf])
  const accountsIn = useCallback((p: string) =>
    accounts.filter(a => accActive(a, p) || rcars.some(c => c.account === a.key && entryOf(c.id, p))), [accounts, rcars, entryOf])

  const accTotals = useCallback((acc: string, p: string) =>
    carsIn(acc, p).reduce((t, c) => add(t, calc(entryOf(c.id, p))), zero()), [carsIn, entryOf])

  const monthSummary = useCallback((p: string) => {
    const accs = accountsIn(p).map(a => ({ a, t: accTotals(a.key, p), cars: carsIn(a.key, p).length }))
    const total = accs.reduce((t, x) => add(t, x.t), zero())
    const exp = monthExp.find(m => m.period === p) || null
    const expenses = expTotal(exp)
    return { accs, total, exp, expenses, profit: total.net - expenses }
  }, [accountsIn, accTotals, carsIn, monthExp])

  const sum = monthSummary(period)

  // Тренд за 6 месяцев
  const trend = useMemo(() => Array.from({ length: 6 }, (_, i) => {
    const m = subMonths(month, 5 - i)
    const p = format(m, 'yyyy-MM-01')
    const s = monthSummary(p)
    return { p, label: format(m, 'LLL', { locale: ru }), net: s.total.net, profit: s.profit, has: s.total.gross || s.total.net || s.expenses }
  }), [month, monthSummary])
  const trendMax = Math.max(1, ...trend.map(t => Math.max(Math.abs(t.net), Math.abs(t.profit))))

  // Зарплата работника по календарю (та же формула, что в календаре)
  const payroll = useMemo(() => {
    const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) })
    return fleet.filter(c => !c.delisted).reduce((s, car) => {
      const cb = blocks.filter(b => b.car_id === car.id)
      const inactive = days.filter(d => cb.some(b => isWithinInterval(d, { start: parseISO(b.start_date), end: blockEnd(b) }))).length
      return s + calcSalary(inactive, days.length)
    }, 0)
  }, [fleet, blocks, month])

  // Если выбран аккаунт, которого нет в этом месяце — вернуться на сводку
  useEffect(() => {
    if (loading) return
    if (tab !== 'summary' && tab !== 'expenses' && !sum.accs.some(x => x.a.key === tab)) setTab('summary')
  }, [loading, tab, sum.accs])
  useEffect(() => { setOpen(null) }, [period, tab])

  // ── Сохранение ──
  async function saveEntry(e: Entry) {
    const supabase = createClient()
    const payload = { revenue_car_id: e.revenue_car_id, period: e.period, gross: e.gross, repair: e.repair, claim_items: e.claim_items, other_items: e.other_items, updated_at: new Date().toISOString() }
    const { data, error } = await supabase.from('revenue_entries').upsert(payload, { onConflict: 'revenue_car_id,period' }).select('id').single()
    if (error) { alert(error.message); return }
    await log('update', 'revenue_entry', data?.id || e.revenue_car_id, { period: e.period, net: calc(e).net })
    setOpen(null)
    load()
  }
  async function saveExpenses(m: MonthExp) {
    const supabase = createClient()
    const { error } = await supabase.from('revenue_month_expenses').upsert({ ...m, updated_at: new Date().toISOString() }, { onConflict: 'period' })
    if (error) { alert(error.message); return }
    await log('update', 'revenue_month_expenses', m.period, { total: expTotal(m) })
    load()
  }
  async function createCar() {
    if (!newName.trim() || tab === 'summary' || tab === 'expenses') return
    const supabase = createClient()
    const sort = Math.max(-1, ...rcars.filter(c => c.account === tab).map(c => c.sort)) + 1
    const { error } = await supabase.from('revenue_cars').insert({ account: tab, name: newName.trim(), car_id: newCarId || null, added_from: period, sort })
    if (error) { alert(error.message); return }
    await log('create', 'revenue_car', newName.trim(), { account: tab, from: period })
    setAddCar(false); setNewName(''); setNewCarId('')
    load()
  }
  async function markSold(c: RCar) {
    const next = format(addMonths(month, 1), 'yyyy-MM-01')
    if (!confirm(`${c.name}: убрать из списка начиная с ${format(addMonths(month, 1), 'LLLL yyyy', { locale: ru })}? Данные за прошлые месяцы сохранятся.`)) return
    const supabase = createClient()
    const { error } = await supabase.from('revenue_cars').update({ sold_from: next }).eq('id', c.id)
    if (error) { alert(error.message); return }
    await log('update', 'revenue_car', c.id, { sold_from: next })
    load()
  }
  async function linkCar(c: RCar, carId: string) {
    const supabase = createClient()
    await supabase.from('revenue_cars').update({ car_id: carId || null }).eq('id', c.id)
    load()
  }

  // ── Telegram / Excel ──
  const reportText = [
    `💰 Доходы за ${monthLabel}`,
    '',
    ...sum.accs.map(x => `• ${x.a.label}: ${money(x.t.net)} (gross ${money(x.t.gross)})`),
    '',
    `Итого по аккаунтам: ${money(sum.total.net)}`,
    `Расходы компании: −${money(sum.expenses).replace('−', '')}`,
    `${sum.profit >= 0 ? '✅' : '🔻'} Чистая прибыль: ${money(sum.profit)}`,
  ].join('\n')

  function exportCsv() {
    const rows: Cell[][] = [['Аккаунт', 'Машина', 'Gross', 'Claim', 'Supplement', 'Вычет', 'Ремонт', 'Прочее', 'Итог']]
    for (const x of sum.accs) {
      for (const c of carsIn(x.a.key, period)) {
        const t = calc(entryOf(c.id, period))
        rows.push([x.a.label, c.name, t.gross, t.claim, t.supp, round2(t.ded), t.repair, t.other, round2(t.net)])
      }
      rows.push([x.a.label, 'ИТОГО', x.t.gross, x.t.claim, x.t.supp, round2(x.t.ded), x.t.repair, x.t.other, round2(x.t.net)])
    }
    rows.push([])
    rows.push(['Зарплата 1', '', n(sum.exp?.salary1)])
    rows.push(['Зарплата 2', '', n(sum.exp?.salary2)])
    for (const i of sum.exp?.items || []) rows.push(['Расход', i.desc, n(i.amount)])
    rows.push(['Расходы компании', '', sum.expenses])
    rows.push(['Чистая прибыль', '', round2(sum.profit)])
    downloadCsv(rows, `dohody-${format(month, 'yyyy-MM')}.csv`)
  }

  const activeAcc = sum.accs.find(x => x.a.key === tab)
  const accCars = activeAcc ? carsIn(activeAcc.a.key, period) : []
  const linkedIds = new Set(rcars.filter(c => c.car_id && (!c.sold_from || c.sold_from > period)).map(c => c.car_id))
  const freeFleet = fleet.filter(f => !linkedIds.has(f.id)).sort((a, b) => `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`))
  const archived = accounts.filter(a => !sum.accs.some(x => x.a.key === a.key))

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Доходы</h1>
          <p className="text-sm text-gray-400 mt-0.5">Доход по аккаунтам Turo, клеймы, расходы и чистая прибыль</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setMonth(m => subMonths(m, 1))} className="p-2 rounded-lg bg-white border border-gray-200 text-gray-500 hover:bg-gray-50" aria-label="Предыдущий месяц"><ChevronLeft size={16} /></button>
          <span className="min-w-[130px] text-center text-sm font-semibold text-gray-800 capitalize">{monthLabel}</span>
          <button onClick={() => setMonth(m => addMonths(m, 1))} className="p-2 rounded-lg bg-white border border-gray-200 text-gray-500 hover:bg-gray-50" aria-label="Следующий месяц"><ChevronRight size={16} /></button>
          {!isCurrent && <button onClick={() => setMonth(startOfMonth(new Date()))} className="text-xs font-medium text-[#4F46E5] hover:underline ml-1">Текущий</button>}
        </div>
      </div>

      {/* Tabs */}
      <div className="-mx-1 overflow-x-auto">
        <div className="flex gap-1.5 px-1 pb-1 min-w-max">
          {[{ key: 'summary', label: 'Сводка', value: null as number | null }, ...sum.accs.map(x => ({ key: x.a.key, label: x.a.label, value: x.t.net })), { key: 'expenses', label: 'Расходы', value: -sum.expenses }].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors border ${tab === t.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              {t.label}
              {t.value !== null && !loading && <span className={`ml-1.5 text-xs tabular-nums ${tab === t.key ? 'text-white/70' : t.value < 0 ? 'text-red-500' : 'text-gray-400'}`}>{money(t.value)}</span>}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-[18px] p-8 text-center text-sm text-gray-400 card-shadow">Загрузка…</div>
      ) : tab === 'summary' ? (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Gross', value: sum.total.gross, icon: Wallet, hint: `${sum.accs.reduce((s, x) => s + x.cars, 0)} машин` },
              { label: 'Клеймы (после вычета)', value: sum.total.claim + sum.total.supp - sum.total.ded, icon: Receipt, hint: `вычет ${money(sum.total.ded)}` },
              { label: 'Итого по аккаунтам', value: sum.total.net, icon: Users, hint: `ремонт и прочее ${money(sum.total.repair + sum.total.other)}` },
              { label: 'Чистая прибыль', value: sum.profit, icon: sum.profit >= 0 ? TrendingUp : TrendingDown, hint: `расходы компании ${money(sum.expenses)}`, strong: true },
            ].map(k => (
              <div key={k.label} className={`rounded-[18px] p-4 border card-shadow ${k.strong ? (k.value >= 0 ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-red-600 border-red-600 text-white') : 'bg-white border-gray-100/80'}`}>
                <div className={`flex items-center gap-1.5 text-xs font-medium ${k.strong ? 'text-white/80' : 'text-gray-500'}`}><k.icon size={14} /> {k.label}</div>
                <div className={`mt-1.5 text-xl sm:text-2xl font-bold tabular-nums ${k.strong ? '' : k.value < 0 ? 'text-red-600' : 'text-gray-900'}`}>{money(k.value)}</div>
                <div className={`mt-0.5 text-[11px] ${k.strong ? 'text-white/75' : 'text-gray-400'}`}>{k.hint}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* По аккаунтам */}
            <div className="xl:col-span-2 bg-white rounded-[18px] border border-gray-100/80 card-shadow overflow-hidden">
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <h2 className="text-base font-bold text-gray-900">По аккаунтам</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-gray-400 text-right">
                      <th className="text-left font-medium px-4 py-2">Аккаунт</th>
                      <th className="font-medium px-2 py-2">Gross</th>
                      <th className="font-medium px-2 py-2 hidden sm:table-cell">Клеймы</th>
                      <th className="font-medium px-2 py-2 hidden sm:table-cell">Вычет</th>
                      <th className="font-medium px-2 py-2 hidden md:table-cell">Ремонт+проч.</th>
                      <th className="font-medium px-4 py-2">Итог</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sum.accs.map(x => (
                      <tr key={x.a.key} onClick={() => setTab(x.a.key)} className="border-t border-gray-100 text-right hover:bg-gray-50 cursor-pointer">
                        <td className="text-left px-4 py-2.5"><span className="font-medium text-gray-900">{x.a.label}</span> <span className="text-xs text-gray-400">· {x.cars}</span></td>
                        <td className="px-2 py-2.5">{money(x.t.gross)}</td>
                        <td className="px-2 py-2.5 hidden sm:table-cell">{money(x.t.claim + x.t.supp)}</td>
                        <td className="px-2 py-2.5 hidden sm:table-cell text-gray-500">−{money(x.t.ded).replace('−', '')}</td>
                        <td className="px-2 py-2.5 hidden md:table-cell text-gray-500">−{money(x.t.repair + x.t.other).replace('−', '')}</td>
                        <td className={`px-4 py-2.5 font-semibold ${x.t.net < 0 ? 'text-red-600' : 'text-gray-900'}`}>{money(x.t.net)}</td>
                      </tr>
                    ))}
                    {sum.accs.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Нет данных за этот месяц</td></tr>}
                  </tbody>
                  <tfoot className="border-t-2 border-gray-200 text-right">
                    <tr>
                      <td className="text-left px-4 py-2 font-medium text-gray-600">Итого по аккаунтам</td>
                      <td className="px-2 py-2">{money(sum.total.gross)}</td>
                      <td className="px-2 py-2 hidden sm:table-cell">{money(sum.total.claim + sum.total.supp)}</td>
                      <td className="px-2 py-2 hidden sm:table-cell text-gray-500">−{money(sum.total.ded).replace('−', '')}</td>
                      <td className="px-2 py-2 hidden md:table-cell text-gray-500">−{money(sum.total.repair + sum.total.other).replace('−', '')}</td>
                      <td className="px-4 py-2 font-semibold">{money(sum.total.net)}</td>
                    </tr>
                    <tr className="cursor-pointer hover:bg-gray-50" onClick={() => setTab('expenses')}>
                      <td colSpan={6} className="px-4 py-2">
                        <div className="flex items-center justify-between gap-3 text-gray-600">
                          <span className="text-left">Расходы компании <span className="text-xs text-gray-400">(зарплаты {money(n(sum.exp?.salary1) + n(sum.exp?.salary2))} + {(sum.exp?.items || []).length} поз.)</span></span>
                          <span>−{money(sum.expenses).replace('−', '')}</span>
                        </div>
                      </td>
                    </tr>
                    <tr className={sum.profit < 0 ? 'bg-red-50' : 'bg-emerald-50'}>
                      <td colSpan={6} className="px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-bold text-gray-900">Чистая прибыль</span>
                          <span className={`font-bold ${sum.profit < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{money(sum.profit)}</span>
                        </div>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="flex flex-wrap gap-2 p-4 border-t border-gray-100">
                <button onClick={() => shareText(reportText, () => { setCopied(true); setTimeout(() => setCopied(false), 2000) })} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-[#229ED9] hover:bg-[#1c8cc2] text-white text-sm font-medium"><Send size={15} /> В Telegram</button>
                <button onClick={() => copyText(reportText, () => { setCopied(true); setTimeout(() => setCopied(false), 2000) })} className={btnGhost}>{copied ? <><Check size={15} className="text-green-600" /> Скопировано</> : <><Copy size={15} /> Копировать</>}</button>
                <button onClick={exportCsv} className={btnGhost}><Download size={15} /> Excel</button>
              </div>
            </div>

            {/* Тренд */}
            <div className="bg-white rounded-[18px] border border-gray-100/80 card-shadow p-4">
              <h2 className="text-base font-bold text-gray-900">6 месяцев</h2>
              <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-500">
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-indigo-300" /> по аккаунтам</span>
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-600" /> прибыль</span>
              </div>
              <div className="mt-4 space-y-3">
                {trend.map(t => (
                  <button key={t.p} onClick={() => setMonth(parseISO(t.p))} className={`w-full text-left rounded-lg px-2 py-1.5 transition-colors ${t.p === period ? 'bg-gray-100' : 'hover:bg-gray-50'}`}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="capitalize font-medium text-gray-700 w-10">{t.label}</span>
                      <span className={`tabular-nums font-semibold ${t.profit < 0 ? 'text-red-600' : 'text-gray-900'}`}>{t.has ? money(t.profit) : '—'}</span>
                    </div>
                    <div className="mt-1 space-y-1">
                      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-indigo-300" style={{ width: `${Math.max(0, t.net) / trendMax * 100}%` }} /></div>
                      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${t.profit < 0 ? 'bg-red-500' : 'bg-emerald-600'}`} style={{ width: `${Math.abs(t.profit) / trendMax * 100}%` }} /></div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {archived.length > 0 && (
            <div>
              <button onClick={() => setShowArchive(s => !s)} className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700">
                <Archive size={14} /> Неактивные аккаунты в этом месяце: {archived.map(a => a.label).join(', ')}
              </button>
              {showArchive && <p className="text-xs text-gray-400 mt-1">Их данные за прошлые месяцы сохранены — переключитесь на нужный месяц.</p>}
            </div>
          )}
        </>
      ) : tab === 'expenses' ? (
        <ExpensesEditor key={period + JSON.stringify(sum.exp)} period={period} payroll={payroll}
          value={sum.exp || { period, salary1: 0, salary2: 0, items: [] }} onSave={saveExpenses} />
      ) : activeAcc ? (
        <div className="bg-white rounded-[18px] border border-gray-100/80 card-shadow overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-100">
            <div>
              <h2 className="text-base font-bold text-gray-900">{activeAcc.a.label}</h2>
              <p className="text-xs text-gray-500 tabular-nums">{accCars.length} машин · gross {money(activeAcc.t.gross)} · итог <b className={activeAcc.t.net < 0 ? 'text-red-600' : 'text-gray-900'}>{money(activeAcc.t.net)}</b></p>
            </div>
            <button onClick={() => setAddCar(true)} className={btnGhost}><Plus size={15} /> Машина</button>
          </div>

          <ul>
            {accCars.map(c => {
              const e = entryOf(c.id, period)
              const t = calc(e)
              const isOpen = open === c.id
              const claimsCount = e?.claim_items.length || 0
              return (
                <li key={c.id} className="border-b border-gray-100 last:border-0">
                  <button onClick={() => setOpen(isOpen ? null : c.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50">
                    <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 text-gray-500"><CarFront size={17} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-gray-900 truncate">{c.name}</span>
                        {c.car && <span className="text-[11px] font-semibold text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">{c.car.plate}</span>}
                      </div>
                      <div className="text-xs text-gray-400 tabular-nums truncate">
                        {e ? <>gross {money(t.gross)}{claimsCount ? ` · клеймы ${money(t.claim + t.supp)}${t.ded ? ` (−${money(t.ded).replace('−', '')} вычет)` : ''}` : ''}{t.repair ? ` · ремонт ${money(t.repair)}` : ''}{t.other ? ` · прочее ${money(t.other)}` : ''}</> : 'нет данных'}
                      </div>
                    </div>
                    <span className={`tabular-nums font-semibold text-sm ${t.net < 0 ? 'text-red-600' : e ? 'text-gray-900' : 'text-gray-300'}`}>{money(t.net)}</span>
                    <ChevronDown size={16} className={`text-gray-300 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {isOpen && (
                    <>
                      <EntryEditor
                        entry={e || { revenue_car_id: c.id, period, gross: 0, repair: 0, claim_items: [], other_items: [] }}
                        onSave={saveEntry} onCancel={() => setOpen(null)} />
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pb-3 bg-gray-50/60 text-xs">
                        <label className="inline-flex items-center gap-1.5 text-gray-500">
                          <Link2 size={13} /> Авто в парке:
                          <select value={c.car_id || ''} onChange={ev => linkCar(c, ev.target.value)} className="border border-gray-200 rounded-md bg-white px-1.5 py-1 text-xs text-gray-700 max-w-[200px]">
                            <option value="">— не привязано —</option>
                            {[...(c.car_id ? fleet.filter(f => f.id === c.car_id) : []), ...freeFleet].map(f => <option key={f.id} value={f.id}>{f.make} {f.model} {f.plate}</option>)}
                          </select>
                        </label>
                        <button onClick={() => markSold(c)} className="inline-flex items-center gap-1 text-gray-500 hover:text-red-600"><Trash2 size={13} /> Продана / убрать со след. месяца</button>
                      </div>
                    </>
                  )}
                </li>
              )
            })}
            {accCars.length === 0 && <li className="px-4 py-8 text-center text-sm text-gray-400">В этом аккаунте нет машин за этот месяц</li>}
          </ul>
        </div>
      ) : null}

      {/* Add car modal */}
      {addCar && activeAcc && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) setAddCar(false) }}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Новая машина</h2>
              <p className="text-sm text-gray-400">{activeAcc.a.label} · с {monthLabel}</p>
            </div>
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 mb-1">Авто из парка</span>
              <select id="income-new-car" value={newCarId} onChange={e => {
                setNewCarId(e.target.value)
                const f = fleet.find(x => x.id === e.target.value)
                if (f && !newName) setNewName(`${f.model} ${f.plate.slice(-3)}`)
              }} className={inputCls}>
                <option value="">— не привязывать —</option>
                {freeFleet.map(f => <option key={f.id} value={f.id}>{f.make} {f.model} {f.plate}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 mb-1">Название в таблице</span>
              <input id="income-new-name" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Например, Camry 897" className={inputCls} />
            </label>
            <div className="flex gap-3 pt-1">
              <button onClick={createCar} disabled={!newName.trim()} className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white py-2 rounded-lg text-sm font-medium">Добавить</button>
              <button onClick={() => setAddCar(false)} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 rounded-lg text-sm font-medium">Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function round2(v: number) { return Math.round(v * 100) / 100 }

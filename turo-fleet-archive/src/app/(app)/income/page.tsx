'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { log } from '@/lib/logger'
import { Car } from '@/types'
import {
  ChevronLeft, ChevronRight, ChevronDown, Plus, X, Trash2, Send, Copy, Check, Download,
  TrendingUp, TrendingDown, CarFront, Link2, ArrowUpRight, ArrowDownRight, FileJson, FileSpreadsheet,
  Wallet, Receipt, Wrench, Archive,
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
const round2 = (v: number) => Math.round(v * 100) / 100
const round6 = (v: number) => Math.round(v * 1e6) / 1e6

const money = (v: number) => {
  const r = round2(v)
  const s = Math.abs(r).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  return `${r < 0 ? '−' : ''}$${s}`
}
const moneyShort = (v: number) => {
  const a = Math.abs(v)
  const s = a >= 1000 ? `${(a / 1000).toFixed(a >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : String(Math.round(a))
  return `${v < 0 ? '−' : ''}$${s}`
}
const abs = (v: number) => money(Math.abs(v))

const carVisible = (c: RCar, p: string) => c.added_from <= p && (!c.sold_from || p < c.sold_from)
const accActive = (a: Account, p: string) => a.active_from <= p && (!a.active_until || p <= a.active_until)
const pKey = (d: Date) => format(d, 'yyyy-MM-01')
const monthName = (p: string, f = 'LLLL yyyy') => { const t = format(parseISO(p), f, { locale: ru }); return t.charAt(0).toUpperCase() + t.slice(1) }

function calcSalary(inactive: number, total: number) {
  if (inactive >= total) return 0
  if (inactive >= 14) return 75
  return 150
}
const blockEnd = (b: Block) => (b.end_date ? parseISO(b.end_date) : new Date(9999, 0))

// Цвета аккаунтов
const COLORS = [
  { dot: 'bg-indigo-500', soft: 'bg-indigo-50 text-indigo-700', ring: 'hover:border-indigo-200' },
  { dot: 'bg-emerald-500', soft: 'bg-emerald-50 text-emerald-700', ring: 'hover:border-emerald-200' },
  { dot: 'bg-amber-500', soft: 'bg-amber-50 text-amber-700', ring: 'hover:border-amber-200' },
  { dot: 'bg-sky-500', soft: 'bg-sky-50 text-sky-700', ring: 'hover:border-sky-200' },
  { dot: 'bg-rose-500', soft: 'bg-rose-50 text-rose-700', ring: 'hover:border-rose-200' },
  { dot: 'bg-violet-500', soft: 'bg-violet-50 text-violet-700', ring: 'hover:border-violet-200' },
]

// ── Выгрузка ──
function downloadFile(content: string, file: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = file; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}
function toCsv(rows: Cell[][]) {
  const esc = (v: Cell) => `"${String(v).replace(/"/g, '""')}"`
  return '\uFEFF' + rows.map(r => r.map(esc).join(',')).join('\r\n')
}
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}

const inputCls = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm tabular-nums text-gray-900 placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent'
const btnGhost = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium transition-colors'

function MoneyInput({ id, value, onChange, placeholder = '0', big = false, autoFocus = false }: { id?: string; value: string; onChange: (v: string) => void; placeholder?: string; big?: boolean; autoFocus?: boolean }) {
  return (
    <div className="relative">
      <span className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 ${big ? 'text-base' : 'text-sm'}`}>$</span>
      <input id={id} inputMode="decimal" autoFocus={autoFocus} value={value} onChange={e => onChange(e.target.value.replace(',', '.'))} placeholder={placeholder}
        className={`${inputCls} pl-7 ${big ? 'text-lg font-semibold py-3' : ''}`} />
    </div>
  )
}

// ── Панель машины (редактор месяца) ──
function CarDrawer({
  rcar, accLabel, period, entry, history, fleetOptions, onSave, onClose, onLink, onSold,
}: {
  rcar: RCar; accLabel: string; period: string; entry: Entry | null
  history: { p: string; net: number; has: boolean }[]
  fleetOptions: Car[]
  onSave: (e: Entry) => Promise<boolean>; onClose: () => void
  onLink: (carId: string) => void; onSold: () => void
}) {
  const base: Entry = entry || { revenue_car_id: rcar.id, period, gross: 0, repair: 0, claim_items: [], other_items: [] }
  const [gross, setGross] = useState(base.gross ? String(base.gross) : '')
  const [repair, setRepair] = useState(base.repair ? String(base.repair) : '')
  const [claims, setClaims] = useState(base.claim_items.map(c => ({
    claim: c.claim ? String(c.claim) : '', supplement: c.supplement ? String(c.supplement) : '', pct: c.pct ? String(round2(n(c.pct) * 100)) : '',
  })))
  const [others, setOthers] = useState(base.other_items.map(o => ({ desc: o.desc, amount: o.amount ? String(o.amount) : '' })))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const draft: Entry = {
    ...base,
    gross: n(gross), repair: n(repair),
    claim_items: claims.filter(c => c.claim || c.supplement).map(c => ({ claim: n(c.claim), supplement: n(c.supplement), pct: round6(n(c.pct) / 100) })),
    other_items: others.filter(o => o.desc.trim() || o.amount).map(o => ({ desc: o.desc.trim(), amount: n(o.amount) })),
  }
  const t = calc(draft)
  const dirty = JSON.stringify([draft.gross, draft.repair, draft.claim_items, draft.other_items]) !==
    JSON.stringify([n(base.gross), n(base.repair), base.claim_items.map(c => ({ claim: n(c.claim), supplement: n(c.supplement), pct: n(c.pct) })), base.other_items.map(o => ({ desc: o.desc, amount: n(o.amount) }))])

  async function save() {
    setSaving(true)
    const ok = await onSave(draft)
    setSaving(false)
    if (ok) onClose()
  }

  const hMax = Math.max(1, ...history.map(h => Math.abs(h.net)))

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end bg-black/30" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full sm:w-[460px] max-h-[92vh] sm:max-h-none bg-white rounded-t-3xl sm:rounded-none sm:rounded-l-3xl shadow-2xl flex flex-col">
        {/* Head */}
        <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-gray-100">
          <div className="w-11 h-11 rounded-2xl bg-gray-100 flex items-center justify-center text-gray-500 flex-shrink-0"><CarFront size={20} /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-gray-900 truncate">{rcar.name}</h2>
              {rcar.car && <span className="text-[11px] font-semibold text-gray-600 bg-gray-100 rounded-md px-1.5 py-0.5">{rcar.car.plate}</span>}
            </div>
            <p className="text-xs text-gray-500">{accLabel} · {monthName(period)}</p>
          </div>
          <button onClick={onClose} className="p-2 -mr-2 rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Закрыть"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* История */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Итог по месяцам</p>
            <div className="flex items-end gap-2">
              {history.map(h => (
                <div key={h.p} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${monthName(h.p)}: ${h.has ? money(h.net) : 'нет данных'}`}>
                  <div className="w-full h-12 flex items-end">
                    <div className={`w-full rounded-md ${!h.has ? 'bg-gray-100' : h.net < 0 ? 'bg-red-400' : h.p === period ? 'bg-indigo-500' : 'bg-indigo-200'}`}
                      style={{ height: `${h.has ? Math.max(8, Math.abs(h.net) / hMax * 100) : 8}%` }} />
                  </div>
                  <span className={`text-[10px] ${h.p === period ? 'text-gray-900 font-semibold' : 'text-gray-400'}`}>{monthName(h.p, 'LLL')}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-gray-500 mb-1.5">Gross — доход Turo</span>
              <MoneyInput id="drawer-gross" value={gross} onChange={setGross} big autoFocus={!entry} />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-500 mb-1.5">Ремонт</span>
              <MoneyInput id="drawer-repair" value={repair} onChange={setRepair} big />
            </label>
          </div>

          {/* Клеймы */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Клеймы</span>
              <button type="button" onClick={() => setClaims(c => [...c, { claim: '', supplement: '', pct: '20' }])} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"><Plus size={13} /> Клейм</button>
            </div>
            {claims.length === 0 ? (
              <button type="button" onClick={() => setClaims([{ claim: '', supplement: '', pct: '20' }])} className="w-full rounded-xl border border-dashed border-gray-200 py-3 text-sm text-gray-400 hover:border-indigo-300 hover:text-indigo-600 transition-colors">+ Добавить клейм</button>
            ) : (
              <div className="space-y-2">
                {claims.map((c, i) => {
                  const ded = n(c.supplement) * n(c.pct) / 100
                  return (
                    <div key={i} className="rounded-2xl border border-gray-100 bg-gray-50/70 p-3">
                      <div className="grid grid-cols-[1fr_1fr_72px] gap-2">
                        <label className="block min-w-0">
                          <span className="block text-[11px] text-gray-400 mb-1">Initial</span>
                          <MoneyInput value={c.claim} onChange={v => setClaims(cs => cs.map((x, j) => j === i ? { ...x, claim: v } : x))} />
                        </label>
                        <label className="block min-w-0">
                          <span className="block text-[11px] text-gray-400 mb-1">Supplement</span>
                          <MoneyInput value={c.supplement} onChange={v => setClaims(cs => cs.map((x, j) => j === i ? { ...x, supplement: v } : x))} />
                        </label>
                        <label className="block min-w-0">
                          <span className="block text-[11px] text-gray-400 mb-1">% вычета</span>
                          <input inputMode="decimal" value={c.pct} onChange={e => setClaims(cs => cs.map((x, j) => j === i ? { ...x, pct: e.target.value.replace(',', '.') } : x))} placeholder="0" className={inputCls} />
                        </label>
                      </div>
                      <div className="flex items-center justify-between mt-2 text-xs">
                        <span className="text-gray-500 tabular-nums">{ded ? <>Turo удержит <b className="text-gray-700">{money(ded)}</b></> : 'Без вычета'}</span>
                        <button type="button" onClick={() => setClaims(cs => cs.filter((_, j) => j !== i))} className="inline-flex items-center gap-1 text-gray-400 hover:text-red-500"><Trash2 size={13} /> Убрать</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Прочие расходы */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Прочие расходы по машине</span>
              <button type="button" onClick={() => setOthers(o => [...o, { desc: '', amount: '' }])} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"><Plus size={13} /> Расход</button>
            </div>
            {others.length === 0 ? (
              <p className="text-xs text-gray-400">Такс, негатив, репо, регистрация и т.п.</p>
            ) : (
              <div className="space-y-2">
                {others.map((o, i) => (
                  <div key={i} className="grid grid-cols-[1fr_110px_32px] gap-2">
                    <input value={o.desc} onChange={e => setOthers(os => os.map((x, j) => j === i ? { ...x, desc: e.target.value } : x))} placeholder="Что" className={inputCls} />
                    <MoneyInput value={o.amount} onChange={v => setOthers(os => os.map((x, j) => j === i ? { ...x, amount: v } : x))} />
                    <button type="button" onClick={() => setOthers(os => os.filter((_, j) => j !== i))} className="flex items-center justify-center rounded-xl text-gray-300 hover:bg-red-50 hover:text-red-500" aria-label="Убрать расход"><X size={16} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Расчёт */}
          <div className="rounded-2xl bg-gray-50 p-4 text-sm tabular-nums space-y-1.5">
            <div className="flex justify-between text-gray-600"><span>Gross</span><span>{money(t.gross)}</span></div>
            {(t.claim + t.supp) > 0 && <div className="flex justify-between text-gray-600"><span>+ Клеймы</span><span>{money(t.claim + t.supp)}</span></div>}
            {t.ded > 0 && <div className="flex justify-between text-gray-500"><span>− Вычет Turo</span><span>−{abs(t.ded)}</span></div>}
            {t.repair > 0 && <div className="flex justify-between text-gray-500"><span>− Ремонт</span><span>−{abs(t.repair)}</span></div>}
            {t.other > 0 && <div className="flex justify-between text-gray-500"><span>− Прочее</span><span>−{abs(t.other)}</span></div>}
            <div className="flex justify-between border-t border-gray-200 pt-2 mt-1 text-base font-bold">
              <span className="text-gray-900">Итог</span>
              <span className={t.net < 0 ? 'text-red-600' : 'text-emerald-600'}>{money(t.net)}</span>
            </div>
          </div>

          {/* Привязка и продажа */}
          <div className="space-y-2 pb-1">
            <label className="flex items-center gap-2 text-xs text-gray-500">
              <Link2 size={14} className="flex-shrink-0" /> <span className="flex-shrink-0">Авто в парке</span>
              <select value={rcar.car_id || ''} onChange={ev => onLink(ev.target.value)} className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700">
                <option value="">— не привязано —</option>
                {fleetOptions.map(f => <option key={f.id} value={f.id}>{f.make} {f.model} {f.plate}</option>)}
              </select>
            </label>
            <button onClick={onSold} className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-600"><Archive size={14} /> Машина продана — убрать со следующего месяца</button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-gray-100 bg-white rounded-b-none" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <button onClick={onClose} className="flex-1 rounded-xl bg-gray-100 py-3 text-sm font-medium text-gray-700 hover:bg-gray-200">Отмена</button>
          <button onClick={save} disabled={saving || !dirty} className="flex-[2] rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
            {saving ? 'Сохраняю…' : dirty ? `Сохранить · ${money(t.net)}` : 'Без изменений'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Расходы компании (автосохранение) ──
function ExpensesPanel({ value, period, payroll, onSave }: { value: MonthExp; period: string; payroll: number; onSave: (m: MonthExp) => Promise<boolean> }) {
  const [s1, setS1] = useState(value.salary1 ? String(value.salary1) : '')
  const [s2, setS2] = useState(value.salary2 ? String(value.salary2) : '')
  const [items, setItems] = useState(value.items.map(i => ({ desc: i.desc, amount: i.amount ? String(i.amount) : '' })))
  const [newDesc, setNewDesc] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const savedRef = useRef(JSON.stringify({ salary1: n(value.salary1), salary2: n(value.salary2), items: value.items.map(i => ({ desc: i.desc, amount: n(i.amount) })) }))
  const descRef = useRef<HTMLInputElement>(null)

  const draft: MonthExp = {
    period, salary1: n(s1), salary2: n(s2),
    items: items.filter(i => i.desc.trim() || i.amount).map(i => ({ desc: i.desc.trim(), amount: n(i.amount) })),
  }
  const draftKey = JSON.stringify({ salary1: draft.salary1, salary2: draft.salary2, items: draft.items })

  useEffect(() => {
    if (draftKey === savedRef.current) return
    const timer = setTimeout(async () => {
      setStatus('saving')
      const ok = await onSave(draft)
      if (ok) { savedRef.current = draftKey; setStatus('saved'); setTimeout(() => setStatus(s => (s === 'saved' ? 'idle' : s)), 1800) } else setStatus('idle')
    }, 700)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey])

  function addItem() {
    if (!newDesc.trim() && !newAmount) return
    setItems(xs => [...xs, { desc: newDesc.trim(), amount: newAmount }])
    setNewDesc(''); setNewAmount('')
    descRef.current?.focus()
  }

  const total = expTotal(draft)
  const itemsTotal = draft.items.reduce((s, i) => s + i.amount, 0)
  
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 bg-white rounded-[18px] border border-gray-100/80 card-shadow p-5">
        <div>
          <p className="text-sm text-gray-500">Расходы компании · {monthName(period)}</p>
          <p className="text-3xl font-bold tracking-tight text-gray-900 tabular-nums mt-1">{money(total)}</p>
          <p className="text-xs text-gray-400 mt-1">зарплаты {money(draft.salary1 + draft.salary2)} · {draft.items.length} поз. на {money(itemsTotal)}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${status === 'saved' ? 'text-emerald-600' : 'text-gray-400'}`}>
          {status === 'saving' ? 'Сохраняю…' : status === 'saved' ? <><Check size={14} /> Сохранено</> : 'Изменения сохраняются автоматически'}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="bg-white rounded-[18px] border border-gray-100/80 card-shadow p-5 space-y-4">
          <h3 className="text-base font-bold text-gray-900">Зарплаты</h3>
          <label className="block">
            <span className="block text-xs font-medium text-gray-500 mb-1.5">Зарплата 1</span>
            <MoneyInput id="exp-salary1" value={s1} onChange={setS1} big />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-500 mb-1.5">Зарплата 2</span>
            <MoneyInput id="exp-salary2" value={s2} onChange={setS2} big />
          </label>
          {payroll > 0 && (
            <div className="rounded-2xl bg-indigo-50 p-3 text-sm">
              <p className="text-indigo-900">По календарю простоев работнику положено <b>{money(payroll)}</b></p>
              <button type="button" onClick={() => setS2(String(payroll))} className="mt-1.5 text-xs font-semibold text-indigo-700 hover:underline">Подставить в «Зарплата 2»</button>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 bg-white rounded-[18px] border border-gray-100/80 card-shadow overflow-hidden">
          <div className="px-5 pt-5 pb-3">
            <h3 className="text-base font-bold text-gray-900">Покупки и прочие расходы</h3>
          </div>
          <form onSubmit={e => { e.preventDefault(); addItem() }} className="grid grid-cols-[1fr_120px_auto] gap-2 px-5 pb-4">
            <input ref={descRef} id="exp-new-desc" value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Что купили / за что заплатили" className={inputCls} />
            <MoneyInput id="exp-new-amount" value={newAmount} onChange={setNewAmount} />
            <button type="submit" className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-700"><Plus size={16} /><span className="hidden sm:inline">Добавить</span></button>
          </form>
          {items.length === 0 ? (
            <p className="px-5 pb-6 text-sm text-gray-400">Пока нет расходов за этот месяц</p>
          ) : (
            <ul className="divide-y divide-gray-100 border-t border-gray-100">
              {items.map((it, i) => (
                <li key={i} className="group relative flex items-center gap-2 px-5 py-2">
                  <input value={it.desc} onChange={e => setItems(xs => xs.map((x, j) => j === i ? { ...x, desc: e.target.value } : x))}
                    className="relative z-10 min-w-0 flex-1 bg-transparent rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  <div className="relative z-10 w-28 flex-shrink-0">
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                    <input inputMode="decimal" value={it.amount} onChange={e => setItems(xs => xs.map((x, j) => j === i ? { ...x, amount: e.target.value.replace(',', '.') } : x))}
                      className="w-full bg-transparent rounded-lg pl-5 pr-2 py-1.5 text-sm font-semibold tabular-nums text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <button type="button" onClick={() => setItems(xs => xs.filter((_, j) => j !== i))} className="relative z-10 p-1.5 rounded-lg text-gray-300 hover:bg-red-50 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100" aria-label="Удалить расход"><Trash2 size={15} /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50/70 px-5 py-3 text-sm">
            <span className="text-gray-500">Итого по списку</span>
            <span className="font-bold tabular-nums text-gray-900">{money(itemsTotal)}</span>
          </div>
        </div>
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
  const [archiveCount, setArchiveCount] = useState(0)
  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()))
  const [view, setView] = useState<string>('summary')
  const [drawer, setDrawer] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'order' | 'net'>('order')
  const [exportOpen, setExportOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [addCar, setAddCar] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCarId, setNewCarId] = useState('')
  const stripRef = useRef<HTMLDivElement>(null)

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(t => (t === msg ? null : t)), 2200) }

  const load = useCallback(async () => {
    const supabase = createClient()
    // Иногда первый запрос уходит до обновления сессии — повторяем, чтобы не показать пустые данные
    const fetchAll = () => Promise.all([
      supabase.from('revenue_accounts').select('*').order('sort'),
      supabase.from('revenue_cars').select('*, car:cars(make,model,plate)').order('sort'),
      supabase.from('revenue_entries').select('id, revenue_car_id, period, gross, repair, claim_items, other_items'),
      supabase.from('revenue_month_expenses').select('period, salary1, salary2, items'),
      supabase.from('cars').select('*'),
      supabase.from('car_blocks').select('car_id, start_date, end_date'),
    ])
    let res = await fetchAll()
    for (let i = 0; i < 2 && res.some(r => r.error); i++) {
      await new Promise(r => setTimeout(r, 700))
      res = await fetchAll()
    }
    const [a, c, e, m, f, b] = res
    setAccounts((a.data as Account[]) || [])
    setRcars((c.data as RCar[]) || [])
    setEntries(((e.data as Entry[]) || []).map(x => ({ ...x, gross: n(x.gross), repair: n(x.repair) })))
    setMonthExp(((m.data as MonthExp[]) || []).map(x => ({ ...x, salary1: n(x.salary1), salary2: n(x.salary2) })))
    setFleet((f.data as Car[]) || [])
    setBlocks((b.data as Block[]) || [])
    setLoading(false)
    const arch = await supabase.from('tracker_archive').select('key', { count: 'exact', head: true })
    setArchiveCount(arch.count || 0)
  }, [])
  useEffect(() => { load() }, [load])

  const period = pKey(month)
  const curPeriod = pKey(new Date())

  // ── Быстрый доступ к данным ──
  const entryMap = useMemo(() => {
    const m = new Map<string, Entry>()
    entries.forEach(e => m.set(`${e.revenue_car_id}|${e.period}`, e))
    return m
  }, [entries])
  const entryOf = useCallback((carId: string, p: string) => entryMap.get(`${carId}|${p}`) || null, [entryMap])
  const colorOf = useCallback((key: string) => {
    const i = Math.max(0, accounts.findIndex(a => a.key === key))
    return COLORS[i % COLORS.length]
  }, [accounts])

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
    const has = entries.some(e => e.period === p) || expenses > 0
    return { accs, total, exp, expenses, profit: total.net - expenses, has }
  }, [accountsIn, accTotals, carsIn, monthExp, entries])

  // Месяцы для ленты: от первого месяца с данными до текущего
  const months = useMemo(() => {
    const withData = [...entries.map(e => e.period), ...monthExp.filter(m => expTotal(m) > 0).map(m => m.period)].sort()
    const first = withData[0] || curPeriod
    const last = [curPeriod, period, withData[withData.length - 1] || curPeriod].sort().pop() as string
    const out: string[] = []
    for (let d = parseISO(first < period ? first : period); pKey(d) <= last; d = addMonths(d, 1)) out.push(pKey(d))
    return out
  }, [entries, monthExp, curPeriod, period])
  const monthStats = useMemo(() => months.map(p => ({ p, ...monthSummary(p) })), [months, monthSummary])

  useEffect(() => {
    const el = stripRef.current?.querySelector('[data-active="true"]') as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [period, loading])

  const sum = monthSummary(period)
  const prevSum = monthSummary(pKey(subMonths(month, 1)))
  const delta = prevSum.has ? sum.profit - prevSum.profit : null

  // Зарплата работника по календарю (та же формула, что в календаре)
  const payroll = useMemo(() => {
    const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) })
    return fleet.filter(c => !c.delisted).reduce((s, car) => {
      const cb = blocks.filter(b => b.car_id === car.id)
      const inactive = days.filter(d => cb.some(b => isWithinInterval(d, { start: parseISO(b.start_date), end: blockEnd(b) }))).length
      return s + calcSalary(inactive, days.length)
    }, 0)
  }, [fleet, blocks, month])

  useEffect(() => {
    if (loading) return
    if (view !== 'summary' && view !== 'expenses' && !sum.accs.some(x => x.a.key === view)) setView('summary')
  }, [loading, view, sum.accs])

  // Все машины месяца — для «лучших» и «в минусе»
  const monthCars = useMemo(() => sum.accs.flatMap(x => carsIn(x.a.key, period).map(c => ({ c, a: x.a, e: entryOf(c.id, period), t: calc(entryOf(c.id, period)) }))).filter(r => r.e), [sum.accs, carsIn, entryOf, period])
  const best = [...monthCars].sort((a, b) => b.t.net - a.t.net).filter(r => r.t.net > 0).slice(0, 5)
  const losers = monthCars.filter(r => r.t.net < 0).sort((a, b) => a.t.net - b.t.net)

  // Итоги за всё время
  const allTime = monthStats.filter(s => s.has && s.p <= curPeriod)
  const allProfit = allTime.reduce((s, x) => s + x.profit, 0)
  const allGross = allTime.reduce((s, x) => s + x.total.gross, 0)
  const bestMonth = [...allTime].sort((a, b) => b.profit - a.profit)[0]

  // ── Сохранение ──
  async function saveEntry(e: Entry) {
    const supabase = createClient()
    const payload = { revenue_car_id: e.revenue_car_id, period: e.period, gross: e.gross, repair: e.repair, claim_items: e.claim_items, other_items: e.other_items, updated_at: new Date().toISOString() }
    const { data, error } = await supabase.from('revenue_entries').upsert(payload, { onConflict: 'revenue_car_id,period' }).select('id').single()
    if (error) { alert(error.message); return false }
    setEntries(prev => [...prev.filter(x => !(x.revenue_car_id === e.revenue_car_id && x.period === e.period)), { ...e, id: data?.id }])
    await log('update', 'revenue_entry', data?.id || e.revenue_car_id, { period: e.period, net: round2(calc(e).net) })
    flash('Сохранено')
    return true
  }
  async function saveExpenses(m: MonthExp) {
    const supabase = createClient()
    const { error } = await supabase.from('revenue_month_expenses').upsert({ ...m, updated_at: new Date().toISOString() }, { onConflict: 'period' })
    if (error) { alert(error.message); return false }
    setMonthExp(prev => [...prev.filter(x => x.period !== m.period), m])
    await log('update', 'revenue_month_expenses', m.period, { total: expTotal(m) })
    return true
  }
  async function createCar() {
    if (!newName.trim() || view === 'summary' || view === 'expenses') return
    const supabase = createClient()
    const sort = Math.max(-1, ...rcars.filter(c => c.account === view).map(c => c.sort)) + 1
    const { data, error } = await supabase.from('revenue_cars').insert({ account: view, name: newName.trim(), car_id: newCarId || null, added_from: period, sort }).select('id').single()
    if (error) { alert(error.message); return }
    await log('create', 'revenue_car', newName.trim(), { account: view, from: period })
    setAddCar(false); setNewName(''); setNewCarId('')
    await load()
    if (data?.id) setDrawer(data.id)
  }
  async function markSold(c: RCar) {
    const next = pKey(addMonths(month, 1))
    if (!confirm(`${c.name}: убрать из списка начиная с ${monthName(next)}? Данные за прошлые месяцы сохранятся.`)) return
    const supabase = createClient()
    const { error } = await supabase.from('revenue_cars').update({ sold_from: next }).eq('id', c.id)
    if (error) { alert(error.message); return }
    await log('update', 'revenue_car', c.id, { sold_from: next })
    setDrawer(null)
    load()
  }
  async function linkCar(c: RCar, carId: string) {
    const supabase = createClient()
    await supabase.from('revenue_cars').update({ car_id: carId || null }).eq('id', c.id)
    load()
  }

  // ── Telegram ──
  const reportText = [
    `💰 Доходы за ${monthName(period)}`,
    '',
    ...sum.accs.filter(x => x.cars || x.t.net).map(x => `• ${x.a.label}: ${money(x.t.net)}`),
    '',
    `Gross: ${money(sum.total.gross)}`,
    `Клеймы (после вычета): ${money(sum.total.claim + sum.total.supp - sum.total.ded)}`,
    `Ремонт и прочее: −${abs(sum.total.repair + sum.total.other)}`,
    `Итого по аккаунтам: ${money(sum.total.net)}`,
    `Расходы компании: −${abs(sum.expenses)}`,
    '',
    `${sum.profit >= 0 ? '✅' : '🔻'} Чистая прибыль: ${money(sum.profit)}`,
  ].join('\n')
  async function shareReport() {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share({ text: reportText }) } catch { /* отменено */ }
      return
    }
    if (await copyText(reportText)) flash('Текст скопирован')
  }

  // ── Выгрузки ──
  function carRows(p: string): Cell[][] {
    const rows: Cell[][] = []
    for (const x of monthSummary(p).accs) {
      for (const c of carsIn(x.a.key, p)) {
        const e = entryOf(c.id, p)
        const t = calc(e)
        rows.push([monthName(p), x.a.label, c.name, c.car?.plate || '', t.gross, t.claim, t.supp, round2(t.ded), t.repair, t.other,
          (e?.other_items || []).map(o => `${o.desc} ${o.amount}`).join('; '), round2(t.net)])
      }
    }
    return rows
  }
  const carHeader: Cell[] = ['Месяц', 'Аккаунт', 'Машина', 'Номер', 'Gross', 'Claim', 'Supplement', 'Вычет', 'Ремонт', 'Прочее', 'Прочее (что)', 'Итог']
  function exportMonth() {
    const rows: Cell[][] = [carHeader, ...carRows(period), [], ['Расходы компании'], ['Зарплата 1', n(sum.exp?.salary1)], ['Зарплата 2', n(sum.exp?.salary2)]]
    for (const i of sum.exp?.items || []) rows.push([i.desc, n(i.amount)])
    rows.push([], ['Итого по аккаунтам', round2(sum.total.net)], ['Расходы компании', round2(sum.expenses)], ['Чистая прибыль', round2(sum.profit)])
    downloadFile(toCsv(rows), `dohody-${format(month, 'yyyy-MM')}.csv`, 'text/csv;charset=utf-8')
    setExportOpen(false)
  }
  function exportAll() {
    const ms = monthStats.filter(s => s.has)
    const rows: Cell[][] = [['Сводка по месяцам'], ['Месяц', 'Gross', 'Итого по аккаунтам', 'Расходы компании', 'Чистая прибыль'],
      ...ms.map(s => [monthName(s.p), round2(s.total.gross), round2(s.total.net), round2(s.expenses), round2(s.profit)] as Cell[]),
      [], ['Машины по месяцам'], carHeader]
    ms.forEach(s => rows.push(...carRows(s.p)))
    rows.push([], ['Расходы компании по месяцам'], ['Месяц', 'Статья', 'Сумма'])
    ms.forEach(s => {
      if (n(s.exp?.salary1)) rows.push([monthName(s.p), 'Зарплата 1', n(s.exp?.salary1)])
      if (n(s.exp?.salary2)) rows.push([monthName(s.p), 'Зарплата 2', n(s.exp?.salary2)])
      for (const i of s.exp?.items || []) rows.push([monthName(s.p), i.desc, n(i.amount)])
    })
    downloadFile(toCsv(rows), `dohody-vse-mesyacy-${format(new Date(), 'yyyy-MM-dd')}.csv`, 'text/csv;charset=utf-8')
    setExportOpen(false)
  }
  async function exportBackup() {
    const supabase = createClient()
    const [a, c, e, m, t] = await Promise.all([
      supabase.from('revenue_accounts').select('*'),
      supabase.from('revenue_cars').select('*'),
      supabase.from('revenue_entries').select('*'),
      supabase.from('revenue_month_expenses').select('*'),
      supabase.from('tracker_archive').select('key, value, imported_at'),
    ])
    const backup = {
      exported_at: new Date().toISOString(),
      note: 'Полная копия раздела «Доходы» + сырой архив старого TuroTracker',
      revenue_accounts: a.data, revenue_cars: c.data, revenue_entries: e.data, revenue_month_expenses: m.data, tracker_archive: t.data,
    }
    downloadFile(JSON.stringify(backup, null, 2), `dohody-backup-${format(new Date(), 'yyyy-MM-dd')}.json`, 'application/json')
    setExportOpen(false)
  }

  // ── Данные для панели машины ──
  const drawerCar = drawer ? rcars.find(c => c.id === drawer) || null : null
  const drawerAcc = drawerCar ? accounts.find(a => a.key === drawerCar.account) : null
  const drawerHistory = drawerCar ? Array.from({ length: 6 }, (_, i) => {
    const p = pKey(subMonths(month, 5 - i))
    const e = entryOf(drawerCar.id, p)
    return { p, net: calc(e).net, has: !!e }
  }) : []
  const linkedIds = new Set(rcars.filter(c => c.car_id && (!c.sold_from || c.sold_from > period)).map(c => c.car_id))
  const freeFleet = fleet.filter(f => !linkedIds.has(f.id)).sort((a, b) => `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`))

  const activeAcc = sum.accs.find(x => x.a.key === view)
  const accCars = activeAcc ? carsIn(activeAcc.a.key, period) : []
  const accCarsSorted = sortBy === 'net' ? [...accCars].sort((a, b) => calc(entryOf(b.id, period)).net - calc(entryOf(a.id, period)).net) : accCars

  // Тренд (столбики)
  const trend = monthStats.filter(s => s.p <= (period > curPeriod ? period : curPeriod)).slice(-8)
  const tMaxPos = Math.max(1, ...trend.map(s => Math.max(0, s.profit)))
  const tMaxNeg = Math.max(0, ...trend.map(s => Math.max(0, -s.profit)))
  const basePct = tMaxPos / (tMaxPos + tMaxNeg) * 100
  const positiveTotal = sum.accs.reduce((s, x) => s + Math.max(0, x.t.net), 0)

  const profitUp = sum.profit >= 0

  return (
    <div className="space-y-5 pb-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Доходы</h1>
          <p className="text-sm text-gray-400 mt-0.5">Доход по аккаунтам Turo, клеймы, расходы и чистая прибыль</p>
        </div>
        <div className="relative">
          <button onClick={() => setExportOpen(o => !o)} className={btnGhost}><Download size={15} /> Выгрузить <ChevronDown size={14} className="text-gray-400" /></button>
          {exportOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setExportOpen(false)} />
              <div className="absolute right-0 z-40 mt-2 w-72 rounded-2xl border border-gray-100 bg-white p-1.5 shadow-xl">
                <button onClick={exportMonth} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-gray-50">
                  <FileSpreadsheet size={18} className="mt-0.5 text-emerald-600" />
                  <span><span className="block text-sm font-medium text-gray-900">Этот месяц</span><span className="block text-xs text-gray-400">Excel · {monthName(period)}</span></span>
                </button>
                <button onClick={exportAll} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-gray-50">
                  <FileSpreadsheet size={18} className="mt-0.5 text-emerald-600" />
                  <span><span className="block text-sm font-medium text-gray-900">Все месяцы</span><span className="block text-xs text-gray-400">Excel · сводка, машины и расходы</span></span>
                </button>
                <button onClick={exportBackup} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-gray-50">
                  <FileJson size={18} className="mt-0.5 text-indigo-600" />
                  <span><span className="block text-sm font-medium text-gray-900">Резервная копия</span><span className="block text-xs text-gray-400">Все данные + архив TuroTracker (JSON)</span></span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Лента месяцев */}
      <div className="flex items-center gap-2">
        <button onClick={() => setMonth(m => subMonths(m, 1))} className="p-2 rounded-xl bg-white border border-gray-200 text-gray-500 hover:bg-gray-50 flex-shrink-0" aria-label="Предыдущий месяц"><ChevronLeft size={16} /></button>
        <div ref={stripRef} className="flex-1 flex gap-2 overflow-x-auto py-0.5" style={{ scrollbarWidth: 'none' }}>
          {monthStats.map(s => {
            const active = s.p === period
            return (
              <button key={s.p} data-active={active} onClick={() => setMonth(parseISO(s.p))}
                className={`flex-shrink-0 min-w-[96px] rounded-2xl border px-3 py-2 text-left transition-colors ${active ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-200 hover:border-gray-300'}`}>
                <span className={`block text-xs font-medium ${active ? 'text-white/70' : 'text-gray-500'}`}>{monthName(s.p, 'LLLL')}{s.p === curPeriod ? ' · сейчас' : ''}</span>
                <span className={`block text-sm font-bold tabular-nums ${!s.has ? (active ? 'text-white/50' : 'text-gray-300') : s.profit < 0 ? (active ? 'text-red-300' : 'text-red-600') : (active ? 'text-emerald-300' : 'text-emerald-600')}`}>
                  {s.has ? moneyShort(s.profit) : '—'}
                </span>
              </button>
            )
          })}
        </div>
        <button onClick={() => setMonth(m => addMonths(m, 1))} className="p-2 rounded-xl bg-white border border-gray-200 text-gray-500 hover:bg-gray-50 flex-shrink-0" aria-label="Следующий месяц"><ChevronRight size={16} /></button>
      </div>

      {/* Вкладки */}
      <div className="-mx-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        <div className="flex gap-1.5 px-1 min-w-max">
          <button onClick={() => setView('summary')} className={`px-3.5 py-2 rounded-xl text-sm font-medium border transition-colors ${view === 'summary' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>Сводка</button>
          {sum.accs.map(x => (
            <button key={x.a.key} onClick={() => setView(x.a.key)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium border transition-colors ${view === x.a.key ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>
              <span className={`w-2 h-2 rounded-full ${colorOf(x.a.key).dot}`} />
              {x.a.label}
              {!loading && <span className={`text-xs tabular-nums ${view === x.a.key ? 'text-white/75' : x.t.net < 0 ? 'text-red-500' : 'text-gray-400'}`}>{moneyShort(x.t.net)}</span>}
            </button>
          ))}
          <button onClick={() => setView('expenses')} className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium border transition-colors ${view === 'expenses' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>
            <Receipt size={14} /> Расходы
            {!loading && <span className={`text-xs tabular-nums ${view === 'expenses' ? 'text-white/75' : 'text-gray-400'}`}>{moneyShort(sum.expenses)}</span>}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map(i => <div key={i} className="h-40 rounded-[18px] bg-white card-shadow animate-pulse" />)}
        </div>
      ) : view === 'summary' ? (
        <>
          {/* Главная карточка */}
          <div className={`relative overflow-hidden rounded-[22px] p-5 sm:p-6 text-white ${profitUp ? 'bg-gradient-to-br from-emerald-500 to-teal-600' : 'bg-gradient-to-br from-rose-500 to-red-600'}`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm text-white/80">Чистая прибыль · {monthName(period)}</p>
                <p className="text-4xl sm:text-5xl font-bold tracking-tight tabular-nums mt-1">{money(sum.profit)}</p>
                {delta !== null && (
                  <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium">
                    {delta >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                    {delta >= 0 ? '+' : '−'}{abs(delta)} к прошлому месяцу
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={shareReport} className="inline-flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-sm font-medium hover:bg-white/25"><Send size={15} /> Telegram</button>
                <button onClick={async () => { if (await copyText(reportText)) flash('Текст скопирован') }} className="inline-flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-sm font-medium hover:bg-white/25" aria-label="Копировать текст"><Copy size={15} /></button>
              </div>
            </div>
            {/* Из чего складывается */}
            <div className="mt-5 grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                { label: 'Gross', value: sum.total.gross, sign: '' },
                { label: 'Клеймы', value: sum.total.claim + sum.total.supp, sign: '+' },
                { label: 'Вычет Turo', value: sum.total.ded, sign: '−' },
                { label: 'Ремонт и прочее', value: sum.total.repair + sum.total.other, sign: '−' },
                { label: 'Расходы компании', value: sum.expenses, sign: '−', go: 'expenses' },
              ].map(s => (
                <button key={s.label} onClick={() => s.go && setView(s.go)} disabled={!s.go}
                  className={`rounded-2xl bg-black/10 px-3 py-2.5 text-left ${s.go ? 'hover:bg-black/20 cursor-pointer' : 'cursor-default'}`}>
                  <span className="block text-[11px] uppercase tracking-wide text-white/70">{s.label}</span>
                  <span className="block text-base font-semibold tabular-nums">{s.sign}{abs(s.value)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Аккаунты */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-gray-900">Аккаунты</h2>
              <span className="text-xs text-gray-400 tabular-nums">итого {money(sum.total.net)}</span>
            </div>
            {positiveTotal > 0 && (
              <div className="mb-3 flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
                {sum.accs.filter(x => x.t.net > 0).map(x => (
                  <div key={x.a.key} className={colorOf(x.a.key).dot} style={{ width: `${x.t.net / positiveTotal * 100}%` }} title={`${x.a.label}: ${money(x.t.net)}`} />
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {sum.accs.filter(x => x.cars > 0 || x.t.net !== 0).map(x => {
                const col = colorOf(x.a.key)
                const share = positiveTotal > 0 && x.t.net > 0 ? Math.round(x.t.net / positiveTotal * 100) : 0
                return (
                  <button key={x.a.key} onClick={() => setView(x.a.key)}
                    className={`group text-left bg-white rounded-[18px] border border-gray-100/80 card-shadow p-4 transition-colors ${col.ring}`}>
                    <div className="flex items-center gap-3">
                      <span className={`w-10 h-10 rounded-2xl flex items-center justify-center text-sm font-bold ${col.soft}`}>{x.a.label.slice(0, 1)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-gray-900 truncate">{x.a.label}</p>
                        <p className="text-xs text-gray-400">{x.cars} {x.cars === 1 ? 'машина' : x.cars >= 2 && x.cars <= 4 ? 'машины' : 'машин'}{share ? ` · ${share}% дохода` : ''}</p>
                      </div>
                      <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-500" />
                    </div>
                    <p className={`mt-3 text-2xl font-bold tracking-tight tabular-nums ${x.t.net < 0 ? 'text-red-600' : 'text-gray-900'}`}>{money(x.t.net)}</p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 tabular-nums">
                      <span>Gross {money(x.t.gross)}</span>
                      {(x.t.claim + x.t.supp) > 0 && <span>Клеймы {money(x.t.claim + x.t.supp - x.t.ded)}</span>}
                      {(x.t.repair + x.t.other) > 0 && <span className="text-red-500">−{abs(x.t.repair + x.t.other)}</span>}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* Тренд */}
            <div className="xl:col-span-2 bg-white rounded-[18px] border border-gray-100/80 card-shadow p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-bold text-gray-900">Прибыль по месяцам</h2>
                <span className="text-xs text-gray-500 tabular-nums">за всё время: прибыль <b className={allProfit < 0 ? 'text-red-600' : 'text-gray-900'}>{money(allProfit)}</b> · gross {money(allGross)}</span>
              </div>
              <div className="mt-4 flex h-48 gap-2 sm:gap-3">
                {trend.map(s => {
                  const active = s.p === period
                  const hPos = s.profit > 0 ? s.profit / tMaxPos * 100 : 0
                  const hNeg = s.profit < 0 && tMaxNeg > 0 ? -s.profit / tMaxNeg * 100 : 0
                  return (
                    <button key={s.p} onClick={() => setMonth(parseISO(s.p))} className={`group flex-1 min-w-0 flex flex-col rounded-xl px-1 transition-colors ${active ? 'bg-gray-50' : 'hover:bg-gray-50'}`} title={`${monthName(s.p)}: ${money(s.profit)}`}>
                      <div className="flex flex-col justify-end" style={{ height: `${basePct}%` }}>
                        {s.profit > 0 && <span className="text-[10px] sm:text-[11px] font-semibold text-gray-600 text-center tabular-nums mb-1 truncate">{moneyShort(s.profit)}</span>}
                        <div className={`mx-auto w-full max-w-[44px] rounded-t-lg ${!s.has ? '' : active ? 'bg-emerald-500' : 'bg-emerald-300 group-hover:bg-emerald-400'}`} style={{ height: `${hPos}%` }} />
                      </div>
                      <div className="border-t border-gray-200" />
                      <div className="flex flex-col justify-start" style={{ height: `${100 - basePct}%` }}>
                        <div className={`mx-auto w-full max-w-[44px] rounded-b-lg ${active ? 'bg-red-500' : 'bg-red-300 group-hover:bg-red-400'}`} style={{ height: `${hNeg}%` }} />
                        {s.profit < 0 && <span className="text-[10px] sm:text-[11px] font-semibold text-red-600 text-center tabular-nums mt-1 truncate">{moneyShort(s.profit)}</span>}
                      </div>
                      <span className={`mt-1 text-center text-[11px] ${active ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>{monthName(s.p, 'LLL')}</span>
                    </button>
                  )
                })}
              </div>
              {bestMonth && <p className="mt-3 text-xs text-gray-400">Лучший месяц — <span className="capitalize">{monthName(bestMonth.p, 'LLLL')}</span>: {money(bestMonth.profit)}</p>}
            </div>

            {/* Лучшие / в минусе */}
            <div className="bg-white rounded-[18px] border border-gray-100/80 card-shadow overflow-hidden">
              <div className="flex items-center gap-2 px-5 pt-5 pb-2">
                <TrendingUp size={16} className="text-emerald-600" />
                <h2 className="text-base font-bold text-gray-900">Лучшие машины</h2>
              </div>
              {best.length === 0 ? <p className="px-5 pb-4 text-sm text-gray-400">Пока нет данных</p> : (
                <ul className="pb-2">
                  {best.map((r, i) => (
                    <li key={r.c.id}>
                      <button onClick={() => setDrawer(r.c.id)} className="flex w-full items-center gap-3 px-5 py-2 text-left hover:bg-gray-50">
                        <span className="w-5 text-xs font-semibold text-gray-300 tabular-nums">{i + 1}</span>
                        <span className={`w-2 h-2 rounded-full ${colorOf(r.a.key).dot}`} />
                        <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{r.c.name} <span className="text-gray-400">· {r.a.label}</span></span>
                        <span className="text-sm font-semibold tabular-nums text-gray-900">{money(r.t.net)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {losers.length > 0 && (
                <>
                  <div className="flex items-center gap-2 border-t border-gray-100 px-5 pt-4 pb-2">
                    <TrendingDown size={16} className="text-red-500" />
                    <h2 className="text-base font-bold text-gray-900">В минусе</h2>
                  </div>
                  <ul className="pb-3">
                    {losers.map(r => (
                      <li key={r.c.id}>
                        <button onClick={() => setDrawer(r.c.id)} className="flex w-full items-center gap-3 px-5 py-2 text-left hover:bg-gray-50">
                          <span className={`w-2 h-2 rounded-full ${colorOf(r.a.key).dot}`} />
                          <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{r.c.name} <span className="text-gray-400">· {r.a.label}</span></span>
                          <span className="text-sm font-semibold tabular-nums text-red-600">{money(r.t.net)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>

          {archiveCount > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-gray-400">
              <Archive size={13} /> Данные перенесены из TuroTracker · полный архив ({archiveCount} записей) хранится в базе и входит в «Выгрузить → Резервная копия»
            </p>
          )}
        </>
      ) : view === 'expenses' ? (
        <ExpensesPanel key={period} period={period} payroll={payroll} onSave={saveExpenses}
          value={sum.exp || { period, salary1: 0, salary2: 0, items: [] }} />
      ) : activeAcc ? (
        <div className="space-y-4">
          {/* Шапка аккаунта */}
          <div className="bg-white rounded-[18px] border border-gray-100/80 card-shadow p-5">
            <div className="flex flex-wrap items-center gap-4">
              <span className={`w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-bold ${colorOf(activeAcc.a.key).soft}`}>{activeAcc.a.label.slice(0, 1)}</span>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold text-gray-900">{activeAcc.a.label}</h2>
                <p className="text-sm text-gray-500">{accCars.length} машин · {monthName(period)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-400">Итог</p>
                <p className={`text-2xl font-bold tabular-nums ${activeAcc.t.net < 0 ? 'text-red-600' : 'text-gray-900'}`}>{money(activeAcc.t.net)}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: 'Gross', value: money(activeAcc.t.gross), icon: Wallet },
                { label: 'Клеймы', value: money(activeAcc.t.claim + activeAcc.t.supp), icon: Receipt },
                { label: 'Вычет Turo', value: `−${abs(activeAcc.t.ded)}`, icon: Receipt },
                { label: 'Ремонт и прочее', value: `−${abs(activeAcc.t.repair + activeAcc.t.other)}`, icon: Wrench },
              ].map(s => (
                <div key={s.label} className="rounded-2xl bg-gray-50 px-3 py-2.5">
                  <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-gray-400"><s.icon size={12} /> {s.label}</span>
                  <span className="block text-base font-semibold tabular-nums text-gray-900">{s.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1 text-sm">
              <button onClick={() => setSortBy('order')} className={`rounded-lg px-3 py-1.5 font-medium ${sortBy === 'order' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>По порядку</button>
              <button onClick={() => setSortBy('net')} className={`rounded-lg px-3 py-1.5 font-medium ${sortBy === 'net' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>По доходу</button>
            </div>
            <button onClick={() => setAddCar(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700"><Plus size={16} /> Машина</button>
          </div>

          {accCars.length === 0 ? (
            <div className="bg-white rounded-[18px] card-shadow p-8 text-center text-sm text-gray-400">В этом аккаунте нет машин за этот месяц</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {accCarsSorted.map(c => {
                const e = entryOf(c.id, period)
                const t = calc(e)
                return (
                  <button key={c.id} onClick={() => setDrawer(c.id)}
                    className={`group text-left rounded-[18px] border p-4 transition-all ${e ? 'bg-white border-gray-100/80 card-shadow hover:border-indigo-200' : 'bg-white/60 border-dashed border-gray-200 hover:border-indigo-300 hover:bg-white'}`}>
                    <div className="flex items-start gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${e ? 'bg-gray-100 text-gray-500' : 'bg-gray-50 text-gray-300'}`}><CarFront size={17} /></div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-gray-900 truncate">{c.name}</p>
                        <p className="text-xs text-gray-400 truncate">{c.car ? `${c.car.make} ${c.car.model} · ${c.car.plate}` : 'не привязана к парку'}</p>
                      </div>
                      <span className={`text-lg font-bold tabular-nums ${!e ? 'text-gray-300' : t.net < 0 ? 'text-red-600' : 'text-gray-900'}`}>{e ? money(t.net) : '—'}</span>
                    </div>
                    {e ? (
                      <div className="mt-3 flex flex-wrap gap-1.5 text-xs tabular-nums">
                        <span className="rounded-lg bg-gray-50 px-2 py-1 text-gray-600">Gross {money(t.gross)}</span>
                        {(t.claim + t.supp) > 0 && <span className="rounded-lg bg-indigo-50 px-2 py-1 text-indigo-700">Клеймы {money(t.claim + t.supp - t.ded)}</span>}
                        {t.repair > 0 && <span className="rounded-lg bg-amber-50 px-2 py-1 text-amber-700">Ремонт −{abs(t.repair)}</span>}
                        {t.other > 0 && <span className="rounded-lg bg-red-50 px-2 py-1 text-red-600">Прочее −{abs(t.other)}</span>}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs font-medium text-indigo-500 group-hover:text-indigo-600">+ Внести данные за месяц</p>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      ) : null}

      {/* Панель машины */}
      {drawerCar && (
        <CarDrawer key={`${drawerCar.id}|${period}`}
          rcar={drawerCar} accLabel={drawerAcc?.label || ''} period={period}
          entry={entryOf(drawerCar.id, period)} history={drawerHistory}
          fleetOptions={[...(drawerCar.car_id ? fleet.filter(f => f.id === drawerCar.car_id) : []), ...freeFleet]}
          onSave={saveEntry} onClose={() => setDrawer(null)}
          onLink={id => linkCar(drawerCar, id)} onSold={() => markSold(drawerCar)} />
      )}

      {/* Новая машина */}
      {addCar && activeAcc && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) setAddCar(false) }}>
          <div className="bg-white rounded-3xl shadow-xl p-6 w-full max-w-sm space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Новая машина</h2>
              <p className="text-sm text-gray-400">{activeAcc.a.label} · с {monthName(period)}</p>
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
              <span className="block text-sm font-medium text-gray-700 mb-1">Название</span>
              <input id="income-new-name" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Например, Camry 897" className={inputCls} />
            </label>
            <div className="flex gap-3 pt-1">
              <button onClick={createCar} disabled={!newName.trim()} className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white py-2.5 rounded-xl text-sm font-medium">Добавить</button>
              <button onClick={() => setAddCar(false)} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded-xl text-sm font-medium">Отмена</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 z-[60] inline-flex items-center gap-2 rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-lg">
          <Check size={15} className="text-emerald-400" /> {toast}
        </div>
      )}
    </div>
  )
}

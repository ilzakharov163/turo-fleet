'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { log } from '@/lib/logger'
import { Car } from '@/types'
import {
  ChevronDown, Plus, X, Trash2, Send, Copy, Check, Download,
  TrendingUp, TrendingDown, CarFront, Link2, ArrowUpRight, ArrowDownRight, FileJson, FileSpreadsheet,
  Archive, Pencil, RotateCcw,
} from 'lucide-react'
import {
  format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isWithinInterval, addMonths, subMonths,
} from 'date-fns'
import { ru } from 'date-fns/locale'
import { ask, notify } from '@/lib/ui'
import MonthPicker from '@/components/ui/MonthPicker'
import DeductionsEditor, { type Deduction } from '@/components/DeductionsEditor'
import Popover from '@/components/ui/Popover'
import { canAny, useAccess } from '@/lib/access'
import { removeCarFrom, restoreCar } from '@/lib/fleet'
import { ACCOUNT_COLORS as COLORS } from '@/lib/accountColors'
import { calcSalary, calcEntry, inFleet, appliedDeductions, staffCost } from '@/lib/calc'

// ── Типы ──
// claim_id — строка пришла из «Клеймов» (Initial / Supplement), см. lib/claimIncome.ts
type ClaimItem = { claim: number; supplement: number; pct: number; claim_id?: string }
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
  payment?: number | null   // платёж за машину в этом месяце; null — не задан
}
interface MonthExp { period: string; salary1: number; salary2: number; items: OtherItem[] }
interface Block { car_id: string; start_date: string; end_date: string | null }
interface Payment { id: string; period: string; grp: string; day: number | null; name: string; amount: number; paid: boolean; sort: number }
type Cell = string | number

// ── Расчёты (та же логика, что в TuroTracker) ──
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
const calc = (e?: Entry | null) => calcEntry(e)
type Totals = ReturnType<typeof calc>
const zero = (): Totals => ({ gross: 0, claim: 0, supp: 0, ded: 0, repair: 0, other: 0, payment: 0, net: 0 })
const add = (a: Totals, b: Totals): Totals => ({
  gross: a.gross + b.gross, claim: a.claim + b.claim, supp: a.supp + b.supp, ded: a.ded + b.ded,
  repair: a.repair + b.repair, other: a.other + b.other, payment: a.payment + b.payment, net: a.net + b.net,
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

const blockEnd = (b: Block) => (b.end_date ? parseISO(b.end_date) : new Date(9999, 0))


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
  rcar, accLabel, period, entry, history, lifetime, fleetOptions, onSave, onClose, onLink, onSold, onUnsold,
}: {
  rcar: RCar; accLabel: string; period: string; entry: Entry | null
  history: { p: string; net: number; has: boolean }[]
  lifetime: { net: number; gross: number; months: number }
  fleetOptions: Car[]
  onSave: (e: Entry) => Promise<boolean>; onClose: () => void
  onLink: (carId: string) => void; onSold: () => void; onUnsold: () => void
}) {
  const base: Entry = entry || { revenue_car_id: rcar.id, period, gross: 0, repair: 0, claim_items: [], other_items: [] }
  const [gross, setGross] = useState(base.gross ? String(base.gross) : '')
  const [repair, setRepair] = useState(base.repair ? String(base.repair) : '')
  const [payment, setPayment] = useState(base.payment ? String(base.payment) : '')
  const [claims, setClaims] = useState<{ claim: string; supplement: string; pct: string; link?: Pick<ClaimItem, 'claim_id'> }[]>(base.claim_items.map(c => ({
    claim: c.claim ? String(c.claim) : '', supplement: c.supplement ? String(c.supplement) : '', pct: c.pct ? String(round2(n(c.pct) * 100)) : '',
    link: c.claim_id ? { claim_id: c.claim_id } : undefined,
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
    // пустое поле = 0 (платежа нет), если раньше он был задан; иначе оставляем «не задан»
    payment: payment.trim() ? n(payment) : (base.payment == null ? null : 0),
    claim_items: claims.filter(c => c.claim || c.supplement).map(c => ({ claim: n(c.claim), supplement: n(c.supplement), pct: round6(n(c.pct) / 100), ...c.link })),
    other_items: others.filter(o => o.desc.trim() || o.amount).map(o => ({ desc: o.desc.trim(), amount: n(o.amount) })),
  }
  const t = calc(draft)
  const dirty = JSON.stringify([draft.gross, draft.repair, draft.payment ?? null, draft.claim_items.map(c => ({ claim: c.claim, supplement: c.supplement, pct: c.pct })), draft.other_items]) !==
    JSON.stringify([n(base.gross), n(base.repair), base.payment ?? null, base.claim_items.map(c => ({ claim: n(c.claim), supplement: n(c.supplement), pct: n(c.pct) })), base.other_items.map(o => ({ desc: o.desc, amount: n(o.amount) }))])

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
          {/* За всё время — окупается ли машина */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-gray-50 px-3 py-2.5">
              <p className="text-[11px] text-gray-500">Итог за всё время</p>
              <p className={`text-base font-bold tabular-nums ${lifetime.net < 0 ? 'text-red-600' : 'text-gray-900'}`}>{money(lifetime.net)}</p>
            </div>
            <div className="rounded-xl bg-gray-50 px-3 py-2.5">
              <p className="text-[11px] text-gray-500">Gross за всё время</p>
              <p className="text-base font-bold tabular-nums text-gray-900">{money(lifetime.gross)}</p>
            </div>
            <div className="rounded-xl bg-gray-50 px-3 py-2.5">
              <p className="text-[11px] text-gray-500">В среднем за месяц</p>
              <p className="text-base font-bold tabular-nums text-gray-900">{lifetime.months ? money(lifetime.net / lifetime.months) : '—'}</p>
            </div>
          </div>

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
            <label className="block col-span-2">
              <span className="block text-xs font-medium text-gray-500 mb-1.5">Платёж за машину <span className="font-normal text-gray-400">— если платите вы; в следующий месяц перенесётся сам</span></span>
              <MoneyInput id="drawer-payment" value={payment} onChange={setPayment} />
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
                        <span className="text-gray-500 tabular-nums">{c.link && <span className="mr-1.5 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-600 dark:text-indigo-300">из Клеймов</span>}{ded ? <>Turo удержит <b className="text-gray-700">{money(ded)}</b></> : 'Без вычета'}</span>
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
            {t.payment > 0 && <div className="flex justify-between text-gray-500"><span>− Платёж за машину</span><span>−{abs(t.payment)}</span></div>}
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
            {rcar.sold_from ? (
              <div className="flex items-center justify-between gap-2 rounded-xl bg-orange-50 px-3 py-2 text-xs text-orange-600">
                <span>Убрана с {format(parseISO(rcar.sold_from), 'MMMM yyyy', { locale: ru })}</span>
                <button onClick={onUnsold} className="inline-flex items-center gap-1 font-semibold"><RotateCcw size={13} /> Вернуть</button>
              </div>
            ) : (
              <button onClick={onSold} className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-3 h-10 text-sm text-gray-600 hover:text-red-600 hover:border-red-200"><Archive size={15} /> Продана или разбита — убрать с {format(addMonths(parseISO(period), 1), 'MMMM', { locale: ru })}</button>
            )}
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

// ── Расходы: затраты на сотрудника (со штрафами и вычетами) и расходы компании, автосохранение ──
function ExpensesPanel({ value, period, payroll, deductions, onDeductionsChanged, onSave }: { value: MonthExp; period: string; payroll: number; deductions: Deduction[]; onDeductionsChanged: () => void; onSave: (m: MonthExp) => Promise<boolean> }) {
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

  const itemsTotal = draft.items.reduce((s, i) => s + i.amount, 0)
  const dedTotal = deductions.reduce((s, d) => s + n(d.amount), 0)
  const dedApplied = appliedDeductions(draft.salary2, dedTotal)
  const staffTotal = staffCost(draft.salary1, draft.salary2, dedTotal)
  const total = itemsTotal + staffTotal
  
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 bg-white rounded-[18px] border border-gray-100/80 card-shadow p-5">
        <div>
          <p className="text-sm text-gray-500">Расходы за {format(parseISO(period), 'LLLL yyyy', { locale: ru })}</p>
          <p className="text-3xl font-bold tracking-tight text-gray-900 tabular-nums mt-1">{money(total)}</p>
          <p className="text-xs text-gray-400 mt-1">компания {money(itemsTotal)} · сотрудник {money(staffTotal)} · платежи — во вкладке «Платежи»</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${status === 'saved' ? 'text-emerald-600' : 'text-gray-400'}`}>
          {status === 'saving' ? 'Сохраняю…' : status === 'saved' ? <><Check size={14} /> Сохранено</> : 'Изменения сохраняются автоматически'}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="bg-white rounded-[18px] border border-gray-100/80 card-shadow p-5 space-y-4">
          <div>
            <h3 className="text-base font-bold text-gray-900">Затраты на сотрудника</h3>
            <p className="text-xs text-gray-400 mt-0.5">Штрафы записывайте по ходу месяца, зарплату — в конце</p>
          </div>
          <label className="block">
            <span className="block text-xs font-medium text-gray-500 mb-1.5">Расходы</span>
            <MoneyInput id="exp-salary1" value={s1} onChange={setS1} big />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-500 mb-1.5">Зарплата</span>
            <MoneyInput id="exp-salary2" value={s2} onChange={setS2} big />
          </label>
          {payroll > 0 && draft.salary2 !== payroll && (
            <div className="rounded-2xl bg-indigo-50 p-3 text-sm">
              <p className="text-indigo-900 dark:text-indigo-200">По простоям за месяц положено <b>{money(payroll)}</b> (до вычетов)</p>
              <button type="button" onClick={() => setS2(String(payroll))} className="mt-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300 hover:underline">Подставить в «Зарплата»</button>
            </div>
          )}
          <div className="pt-1">
            <span className="block text-xs font-medium text-gray-500 mb-2">Штрафы и вычеты</span>
            <DeductionsEditor month={period.slice(0, 7)} items={deductions} onChanged={onDeductionsChanged} compact />
          </div>
          <div className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm space-y-1">
            <div className="flex justify-between text-gray-500"><span>Расходы + зарплата</span><span className="tabular-nums">{money(draft.salary1 + draft.salary2)}</span></div>
            {dedApplied > 0 && <div className="flex justify-between text-rose-500"><span>Штрафы и вычеты (из зарплаты)</span><span className="tabular-nums">−{money(dedApplied)}</span></div>}
            <div className="flex justify-between font-semibold text-gray-900 pt-1 border-t border-gray-200"><span>Итого на сотрудника</span><span className="tabular-nums">{money(staffTotal)}</span></div>
            {dedTotal > dedApplied && (
              <p className="text-xs text-gray-500 pt-1">{draft.salary2 > 0 ? `Вычеты больше зарплаты — вычтено ${money(dedApplied)}.` : `Вычеты ${money(dedTotal)} отнимутся от зарплаты, когда вы её внесёте в конце месяца.`}</p>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 bg-white rounded-[18px] border border-gray-100/80 card-shadow overflow-hidden">
          <div className="px-5 pt-5 pb-3">
            <h3 className="text-base font-bold text-gray-900">Расходы компании</h3>
            <p className="text-xs text-gray-400 mt-0.5">Покупки и прочие расходы, не связанные с сотрудником</p>
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
            <span className="text-gray-500">Итого расходы компании</span>
            <span className="font-bold tabular-nums text-gray-900">{money(itemsTotal)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Текстовая ячейка: сохраняется при выходе из поля или Enter ──
function EditCell({ value, onCommit, numeric = false, placeholder = '', className = '' }: { value: string; onCommit: (v: string) => void; numeric?: boolean; placeholder?: string; className?: string }) {
  const [v, setV] = useState(value)
  const [f, setF] = useState(false)
  return (
    <input value={f ? v : value} placeholder={placeholder} inputMode={numeric ? 'decimal' : undefined}
      onFocus={e => { setV(value); setF(true); const t = e.target; requestAnimationFrame(() => t.select()) }}
      onBlur={() => { setF(false); if (v.trim() !== value) onCommit(v.trim()) }}
      onChange={e => setV(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setV(value); e.currentTarget.blur() } }}
      className={`w-full min-w-0 bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-gray-300 hover:bg-indigo-50 focus:relative focus:z-10 focus:bg-white focus:ring-2 focus:ring-indigo-500 ${className}`} />
  )
}

// ── Платежи (ежемесячные) ──
function PaymentsPanel({ period, items, prevCount, prevLabel, onAdd, onUpdate, onDelete, onCopyPrev }: {
  period: string; items: Payment[]; prevCount: number; prevLabel: string
  onAdd: (grp: string) => void; onUpdate: (id: string, patch: Partial<Payment>) => void; onDelete: (id: string) => void; onCopyPrev: () => void
}) {
  const [newGroup, setNewGroup] = useState('')
  const groups: string[] = []
  ;[...items].sort((a, b) => a.sort - b.sort).forEach(p => { if (!groups.includes(p.grp)) groups.push(p.grp) })
  const total = items.reduce((s, p) => s + n(p.amount), 0)
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-[18px] border border-gray-100/80 card-shadow p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm text-gray-500">Платежи · {monthName(period)}</p>
            <p className="text-3xl font-bold tracking-tight text-gray-900 tabular-nums mt-1">{money(total)}</p>
            <p className="text-xs text-gray-400 mt-1">{items.length} платежей · каждый месяц переносятся автоматически</p>
          </div>
          <form onSubmit={e => { e.preventDefault(); if (newGroup.trim()) { onAdd(newGroup.trim()); setNewGroup('') } }} className="flex gap-2">
            <input id="pay-new-group" value={newGroup} onChange={e => setNewGroup(e.target.value)} placeholder="Новая группа (например, Карам)" className="w-56 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <button type="submit" className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"><Plus size={15} /> Группа</button>
          </form>
        </div>
      </div>

      {items.length === 0 && (
        <div className="bg-white rounded-[18px] border border-dashed border-gray-200 p-6 text-center">
          <p className="text-sm text-gray-500">В этом месяце платежей пока нет.</p>
          {prevCount > 0 && <button onClick={onCopyPrev} className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"><Copy size={15} /> Перенести {prevCount} платежей из {prevLabel}</button>}
        </div>
      )}

      {groups.map(g => {
        const rows = items.filter(p => p.grp === g).sort((a, b) => (n(a.day) - n(b.day)) || (a.sort - b.sort))
        const sub = rows.reduce((s, p) => s + n(p.amount), 0)
        return (
          <div key={g} className="bg-white rounded-[18px] border border-gray-100/80 card-shadow overflow-hidden">
            <div className="flex items-center justify-between px-4 sm:px-5 py-3">
              <h3 className="text-base font-bold text-gray-900">{g}</h3>
              <span className="text-sm font-semibold tabular-nums text-gray-900">{money(sub)}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[440px] table-fixed border-collapse text-[15px] sm:text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-gray-500">
                    <th className="w-[80px] bg-gray-100 border-y border-r border-gray-200 px-3 py-2 text-left font-semibold">Число</th>
                    <th className="bg-gray-100 border-y border-r border-gray-200 px-3 py-2 text-left font-semibold">Платёж</th>
                    <th className="w-[130px] bg-gray-100 border-y border-r border-gray-200 px-3 py-2 text-right font-semibold">Сумма</th>
                    <th className="w-[48px] bg-gray-100 border-y border-gray-200" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(p => (
                    <tr key={p.id} className="group">
                      <td className="border-b border-r border-gray-200 p-0"><EditCell value={p.day ? String(p.day) : ''} numeric placeholder="—" onCommit={v => onUpdate(p.id, { day: v ? Math.min(31, Math.max(1, Math.round(n(v)))) : null })} /></td>
                      <td className="border-b border-r border-gray-200 p-0"><EditCell value={p.name} placeholder="Название" onCommit={v => onUpdate(p.id, { name: v })} /></td>
                      <td className="border-b border-r border-gray-200 p-0"><EditCell value={p.amount ? String(p.amount) : ''} numeric placeholder="0" className="text-right font-semibold tabular-nums" onCommit={v => onUpdate(p.id, { amount: round2(n(v.replace(',', '.'))) })} /></td>
                      <td className="border-b border-gray-200 text-center">
                        <button onClick={async () => { if (await ask(`Удалить платёж «${p.name || 'без названия'}»?`, { ok: 'Удалить', danger: true })) onDelete(p.id) }} className="p-1.5 text-gray-300 hover:text-red-500" aria-label="Удалить платёж"><Trash2 size={15} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={() => onAdd(g)} className="w-full px-4 py-2.5 text-left text-sm font-medium text-indigo-600 hover:bg-indigo-50"><Plus size={14} className="inline -mt-0.5" /> Добавить платёж</button>
          </div>
        )
      })}
      <p className="text-xs text-gray-400">Нажмите на ячейку, чтобы изменить — сохраняется само. Платежи вычитаются из чистой прибыли месяца. В начале каждого месяца список переносится автоматически — меняйте только то, что изменилось.</p>
    </div>
  )
}

// ── Ячейка как в Excel: Enter — вниз, ↑/↓ — по строкам, сохраняется сама ──
function NumCell({ grid, row, col, value, onCommit, pct = false, placeholder = '', strong = false, boxed = false }: {
  grid: string; row: number; col: number; value: number; onCommit: (v: number) => void
  pct?: boolean; placeholder?: string; strong?: boolean; boxed?: boolean
}) {
  const shown = (x: number) => (x ? String(pct ? round2(x * 100) : round2(x)) : '')
  const pretty = (x: number) => (x ? (pct ? String(round2(x * 100)) : round2(x).toLocaleString('en-US', { maximumFractionDigits: 2 })) : '')
  const [v, setV] = useState(shown(value))
  const [focused, setFocused] = useState(false)
  const skip = useRef(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!focused) setV(shown(value)) }, [value, focused])
  function commit() {
    const num = n(v.replace(',', '.').replace(/[^\d.-]/g, ''))
    const next = pct ? round6(num / 100) : round2(num)
    if (Math.abs(next - n(value)) > 1e-9) onCommit(next)
  }
  function move(dr: number, target: HTMLInputElement) {
    const el = document.querySelector<HTMLInputElement>(`input[data-grid="${grid}"][data-row="${row + dr}"][data-col="${col}"]`)
    if (el) { el.focus(); el.select() } else target.blur()
  }
  return (
    <input data-grid={grid} data-row={row} data-col={col} inputMode="decimal" enterKeyHint="next" value={focused ? v : pretty(value)} placeholder={placeholder}
      onFocus={e => { setV(shown(value)); setFocused(true); const t = e.target; requestAnimationFrame(() => t.select()) }}
      onBlur={() => { setFocused(false); if (skip.current) { skip.current = false; setV(shown(value)); return } commit() }}
      onChange={e => setV(e.target.value)}
      onKeyDown={e => {
        const t = e.currentTarget
        if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); move(e.shiftKey ? -1 : 1, t) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1, t) }
        else if (e.key === 'Escape') { skip.current = true; t.blur() }
      }}
      className={`w-full min-w-0 text-right tabular-nums text-base sm:text-sm outline-none transition-colors placeholder:text-gray-300 focus:bg-white focus:ring-2 focus:ring-indigo-500 ${boxed ? 'rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-base' : 'rounded-none bg-transparent px-3 py-2.5 hover:bg-indigo-50 focus:relative focus:z-10'} ${strong ? 'font-semibold text-gray-900' : 'text-gray-700'}`} />
  )
}

// ── Страница ──
export default function IncomePage() {
  const access = useAccess()
  const [loading, setLoading] = useState(true)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [rcars, setRcars] = useState<RCar[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [monthExp, setMonthExp] = useState<MonthExp[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const carried = useRef(false)
  const carriedPayments = useRef(false)
  const [fleet, setFleet] = useState<Car[]>([])
  const [blocks, setBlocks] = useState<Block[]>([])
  const [archiveCount, setArchiveCount] = useState(0)
  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()))
  const [view, setView] = useState<string>('summary')
  const [drawer, setDrawer] = useState<string | null>(null)
  // Ссылка вида /income?view=expenses&month=2026-10 (из раздела «Расходы») открывает нужную вкладку и месяц
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const v = q.get('view'), m = q.get('month')
    if (v) setView(v)
    if (m && /^\d{4}-\d{2}$/.test(m)) setMonth(parseISO(`${m}-01`))
  }, [])
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const entriesRef = useRef<Entry[]>([])
  const saveChain = useRef<Promise<void>>(Promise.resolve())
  const [exportOpen, setExportOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [addCar, setAddCar] = useState(false)
  const [deductions, setDeductions] = useState<Deduction[]>([])
  // Аккаунт: новый или редактирование (key задан)
  const [accForm, setAccForm] = useState<{ key: string | null; label: string; from: string; until: string } | null>(null)
  const [newCarId, setNewCarId] = useState('')

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(t => (t === msg ? null : t)), 2200) }

  const load = useCallback(async () => {
    const supabase = createClient()
    // Иногда первый запрос уходит до обновления сессии — повторяем, чтобы не показать пустые данные
    const fetchAll = () => Promise.all([
      supabase.from('revenue_accounts').select('*').order('sort'),
      supabase.from('revenue_cars').select('*, car:cars(make,model,plate)').order('sort'),
      supabase.from('revenue_entries').select('id, revenue_car_id, period, gross, repair, claim_items, other_items, payment'),
      supabase.from('revenue_month_expenses').select('period, salary1, salary2, items'),
      supabase.from('revenue_payments').select('*').order('sort'),
      supabase.from('cars').select('*'),
      supabase.from('car_blocks').select('car_id, start_date, end_date'),
      supabase.from('salary_deductions').select('id, date, reason, amount').order('date').order('created_at'),
    ])
    let res = await fetchAll()
    for (let i = 0; i < 2 && res.some(r => r.error); i++) {
      await new Promise(r => setTimeout(r, 700))
      res = await fetchAll()
    }
    const [a, c, e, m, pay, f, b, d] = res
    setDeductions(((d.data as Deduction[]) || []).map(x => ({ ...x, amount: n(x.amount) })))
    setAccounts((a.data as Account[]) || [])
    // Название машины — из «Авто» (марка и модель), номер показывается отдельно; своё название только у непривязанных
    setRcars(((c.data as RCar[]) || []).map(r => r.car ? { ...r, name: `${r.car.make} ${r.car.model}` } : r))
    let entryList = ((e.data as Entry[]) || []).map(x => ({ ...x, gross: n(x.gross), repair: n(x.repair), payment: x.payment == null ? null : n(x.payment) }))
    // Платёж за машину переходит в текущий месяц сам: если в прошлом месяце он был, а в этом ещё не задан (null)
    {
      const nowP = pKey(new Date())
      const prevP = pKey(subMonths(new Date(), 1))
      const accList = (a.data as Account[]) || []
      const carList = (c.data as RCar[]) || []
      const toCarry = carList.flatMap(rc => {
        const acc = accList.find(x => x.key === rc.account)
        if (!acc || !accActive(acc, nowP) || !carVisible(rc, nowP)) return []
        const prev = entryList.find(x => x.revenue_car_id === rc.id && x.period === prevP)
        const cur = entryList.find(x => x.revenue_car_id === rc.id && x.period === nowP)
        if (!prev || !n(prev.payment) || (cur && cur.payment != null)) return []
        return [{ rc, amount: n(prev.payment), cur }]
      })
      if (toCarry.length && !carriedPayments.current) {
        carriedPayments.current = true
        const fresh = toCarry.filter(x => !x.cur)
        const existing = toCarry.filter(x => x.cur)
        const ins = fresh.length
          ? await supabase.from('revenue_entries').insert(fresh.map(x => ({ revenue_car_id: x.rc.id, period: nowP, payment: x.amount }))).select('id, revenue_car_id, period, gross, repair, claim_items, other_items, payment')
          : { data: [] as Entry[], error: null }
        const upd = await Promise.all(existing.map(x => supabase.from('revenue_entries').update({ payment: x.amount }).eq('id', x.cur!.id!)))
        if (!ins.error) entryList = [...entryList, ...((ins.data as Entry[]) || []).map(x => ({ ...x, gross: n(x.gross), repair: n(x.repair), payment: n(x.payment) }))]
        existing.forEach((x, i) => { if (!upd[i].error) entryList = entryList.map(en => en.id === x.cur!.id ? { ...en, payment: x.amount } : en) })
      }
    }
    setEntries(entryList)
    let payList = ((pay.data as Payment[]) || []).map(x => ({ ...x, amount: n(x.amount) }))
    // Платежи переходят из месяца в месяц: если в текущем месяце их нет — копируем последний список
    const nowP = pKey(new Date())
    const lastP = payList.map(x => x.period).filter(p => p < nowP).sort().pop()
    if (lastP && !payList.some(x => x.period === nowP) && !carried.current) {
      carried.current = true
      const src = payList.filter(x => x.period === lastP)
      const ins = await supabase.from('revenue_payments').insert(src.map(x => ({ period: nowP, grp: x.grp, day: x.day, name: x.name, amount: x.amount, sort: x.sort }))).select('*')
      if (!ins.error) payList = [...payList, ...((ins.data as Payment[]) || []).map(x => ({ ...x, amount: n(x.amount) }))]
    }
    setPayments(payList)
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
    rcars.filter(c => c.account === acc && (carVisible(c, p) || entryOf(c.id, p)))
      // По алфавиту: марка и модель, затем номер — одинаковые модели идут подряд
      .sort((x, y) => x.name.localeCompare(y.name, 'ru') || (x.car?.plate || '').localeCompare(y.car?.plate || '')), [rcars, entryOf])
  const accountsIn = useCallback((p: string) =>
    accounts.filter(a => accActive(a, p) || rcars.some(c => c.account === a.key && entryOf(c.id, p))), [accounts, rcars, entryOf])
  const accTotals = useCallback((acc: string, p: string) =>
    carsIn(acc, p).reduce((t, c) => add(t, calc(entryOf(c.id, p))), zero()), [carsIn, entryOf])

  const monthSummary = useCallback((p: string) => {
    const accs = accountsIn(p).map(a => ({ a, t: accTotals(a.key, p), cars: carsIn(a.key, p).length }))
    const total = accs.reduce((t, x) => add(t, x.t), zero())
    const exp = monthExp.find(m => m.period === p) || null
    const pays = payments.filter(x => x.period === p).reduce((s, x) => s + n(x.amount), 0)
    // Три статьи: расходы компании (покупки), затраты на сотрудника (расходы + зарплата − штрафы/вычеты), платежи
    // Вычеты отнимаются только от внесённой зарплаты (зарплату вносят в конце месяца)
    const dedAll = deductions.filter(x => x.date.startsWith(p.slice(0, 7))).reduce((s, x) => s + n(x.amount), 0)
    const ded = appliedDeductions(n(exp?.salary2), dedAll)
    const company = (exp?.items || []).reduce((s, i) => s + n(i.amount), 0)
    const staff = staffCost(n(exp?.salary1), n(exp?.salary2), dedAll)
    const expenses = company + staff
    const has = entries.some(e => e.period === p) || expTotal(exp) > 0 || pays > 0 || dedAll > 0
    return { accs, total, exp, company, staff, ded, dedPending: dedAll - ded, expenses, pays, profit: total.net - expenses - pays, has }
  }, [accountsIn, accTotals, carsIn, monthExp, entries, payments, deductions])

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


  const sum = monthSummary(period)
  const prevSum = monthSummary(pKey(subMonths(month, 1)))
  const delta = prevSum.has ? sum.profit - prevSum.profit : null

  // Зарплата работника по календарю (та же формула, что в календаре)
  const payroll = useMemo(() => {
    const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) })
    return fleet.filter(c => inFleet(c, period)).reduce((s, car) => {
      const cb = blocks.filter(b => b.car_id === car.id)
      const inactive = days.filter(d => cb.some(b => isWithinInterval(d, { start: parseISO(b.start_date), end: blockEnd(b) }))).length
      return s + calcSalary(inactive, days.length)
    }, 0)
  }, [fleet, blocks, month, period])

  useEffect(() => {
    if (loading) return
    if (view !== 'summary' && view !== 'expenses' && view !== 'gross' && view !== 'payments' && !sum.accs.some(x => x.a.key === view)) setView('summary')
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

  entriesRef.current = entries

  // ── Быстрое сохранение из таблицы ──
  function patchEntry(carId: string, patch: (e: Entry) => Entry) {
    const cur = entriesRef.current.find(x => x.revenue_car_id === carId && x.period === period)
      || { revenue_car_id: carId, period, gross: 0, repair: 0, claim_items: [], other_items: [] }
    const next = patch({ ...cur, claim_items: [...cur.claim_items], other_items: [...cur.other_items] })
    const list = [...entriesRef.current.filter(x => !(x.revenue_car_id === carId && x.period === period)), next]
    entriesRef.current = list
    setEntries(list)
    setSaveState('saving')
    saveChain.current = saveChain.current.then(async () => {
      const { error } = await createClient().from('revenue_entries').upsert({
        revenue_car_id: next.revenue_car_id, period: next.period, gross: next.gross, repair: next.repair,
        claim_items: next.claim_items, other_items: next.other_items, payment: next.payment ?? null, updated_at: new Date().toISOString(),
      }, { onConflict: 'revenue_car_id,period' })
      if (error) { setSaveState('error'); return }
      setSaveState('saved')
      log('update', 'revenue_entry', carId, { period: next.period, net: round2(calc(next).net) })
    })
  }
  function setClaimField(carId: string, field: 'claim' | 'supplement' | 'pct', val: number) {
    patchEntry(carId, e => {
      const items = e.claim_items.length ? [...e.claim_items] : [{ claim: 0, supplement: 0, pct: 0.2 }]
      items[0] = { ...items[0], [field]: val }
      return { ...e, claim_items: items.filter(c => c.claim || c.supplement) }
    })
  }

  // ── Платежи ──
  async function addPayment(grp: string) {
    const sort = Math.max(0, ...payments.filter(x => x.period === period).map(x => x.sort)) + 1
    const { data, error } = await createClient().from('revenue_payments').insert({ period, grp, name: '', amount: 0, sort }).select('*').single()
    if (error) { return }
    setPayments(prev => [...prev, { ...(data as Payment), amount: 0 }])
  }
  async function updatePayment(id: string, patch: Partial<Payment>) {
    setPayments(prev => prev.map(x => (x.id === id ? { ...x, ...patch } : x)))
    const { error } = await createClient().from('revenue_payments').update(patch).eq('id', id)
    if (error) { load() }
  }
  async function deletePayment(id: string) {
    setPayments(prev => prev.filter(x => x.id !== id))
    const { error } = await createClient().from('revenue_payments').delete().eq('id', id)
    if (error) { load() }
  }
  async function copyPrevPayments() {
    const prev = payments.filter(x => x.period === pKey(subMonths(month, 1)))
    if (!prev.length) return
    const rows = prev.map(x => ({ period, grp: x.grp, day: x.day, name: x.name, amount: x.amount, sort: x.sort, paid: false }))
    const { data, error } = await createClient().from('revenue_payments').insert(rows).select('*')
    if (error) { return }
    setPayments(p => [...p, ...((data as Payment[]) || []).map(x => ({ ...x, amount: n(x.amount) }))])
    await log('create', 'revenue_payments', period, { copied_from: pKey(subMonths(month, 1)), count: rows.length })
  }

  // ── Сохранение ──
  async function saveEntry(e: Entry) {
    const supabase = createClient()
    const payload = { revenue_car_id: e.revenue_car_id, period: e.period, gross: e.gross, repair: e.repair, claim_items: e.claim_items, other_items: e.other_items, payment: e.payment ?? null, updated_at: new Date().toISOString() }
    const { data, error } = await supabase.from('revenue_entries').upsert(payload, { onConflict: 'revenue_car_id,period' }).select('id').single()
    if (error) { return false }
    setEntries(prev => [...prev.filter(x => !(x.revenue_car_id === e.revenue_car_id && x.period === e.period)), { ...e, id: data?.id }])
    await log('update', 'revenue_entry', data?.id || e.revenue_car_id, { period: e.period, net: round2(calc(e).net) })
    flash('Сохранено')
    return true
  }
  async function saveExpenses(m: MonthExp) {
    const supabase = createClient()
    const { error } = await supabase.from('revenue_month_expenses').upsert({ ...m, updated_at: new Date().toISOString() }, { onConflict: 'period' })
    if (error) { return false }
    setMonthExp(prev => [...prev.filter(x => x.period !== m.period), m])
    await log('update', 'revenue_month_expenses', m.period, { total: expTotal(m) })
    return true
  }
  async function createCar() {
    const f = fleet.find(x => x.id === newCarId)
    if (!f || view === 'summary' || view === 'expenses') return
    const supabase = createClient()
    const sort = Math.max(-1, ...rcars.filter(c => c.account === view).map(c => c.sort)) + 1
    const name = `${f.make} ${f.model} ${f.plate}`
    const { data, error } = await supabase.from('revenue_cars').insert({ account: view, name, car_id: f.id, added_from: period, sort }).select('id').single()
    if (error) { return }
    await log('create', 'revenue_car', name, { account: view, from: period })
    setAddCar(false); setNewCarId('')
    await load()
    if (data?.id) setDrawer(data.id)
  }
  async function markSold(c: RCar) {
    const next = pKey(addMonths(month, 1))
    const fleetCar = c.car_id ? fleet.find(f => f.id === c.car_id) : null
    const fromW = format(parseISO(next), 'MMMM', { locale: ru })
    if (!await ask(`${c.name}: убрать с ${fromW}?`, {
      detail: `За ${format(month, 'LLLL', { locale: ru })} машина посчитается как обычно — можно внести Gross.${fleetCar ? ` С ${fromW} её не будет в «Доходах», в «Авто» и в зарплате работника.` : ' Машина не привязана к парку — уберётся только из «Доходов».'} Данные прошлых месяцев сохранятся, вернуть можно в этой же панели.`,
      ok: 'Убрать',
    })) return
    const ok = await removeCarFrom({ carId: c.car_id, revenueCarId: c.id, from: next, canFleet: canAny(access, ['/cars']), canIncome: true })
    if (!ok) return
    notify(`${c.name} убрана с ${fromW}`, 'success')
    setDrawer(null)
    load()
  }
  async function unSold(c: RCar) {
    const ok = await restoreCar({ carId: c.car_id, revenueCarId: c.id, from: c.sold_from, canFleet: canAny(access, ['/cars']), canIncome: true })
    if (!ok) return
    notify(`${c.name} возвращена`, 'success')
    load()
  }

  // ── Аккаунты ──
  function openNewAccount() { setAccForm({ key: null, label: '', from: period, until: '' }) }
  function openEditAccount(a: Account) { setAccForm({ key: a.key, label: a.label, from: a.active_from, until: a.active_until || '' }) }
  async function saveAccount() {
    if (!accForm || !accForm.label.trim()) return
    const supabase = createClient()
    const label = accForm.label.trim()
    if (accForm.key) {
      const { error } = await supabase.from('revenue_accounts').update({ label, active_from: accForm.from, active_until: accForm.until || null }).eq('key', accForm.key)
      if (error) return
      await log('update', 'revenue_account', accForm.key, { label, active_from: accForm.from, active_until: accForm.until || null })
    } else {
      // Ключ — первая буква имени; если занята — с номером (A2, A3…)
      const base = (label.match(/[A-Za-zА-Яа-яЁё0-9]/)?.[0] || 'X').toUpperCase()
      let key = base, i = 2
      while (accounts.some(a => a.key === key)) key = `${base}${i++}`
      const sort = Math.max(0, ...accounts.map(a => a.sort)) + 1
      const { error } = await supabase.from('revenue_accounts').insert({ key, label, sort, active_from: accForm.from, active_until: accForm.until || null })
      if (error) return
      await log('create', 'revenue_account', key, { label, active_from: accForm.from })
      setView(key)
    }
    setAccForm(null)
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
    ...(sum.total.payment ? [`Платежи за машины: −${abs(sum.total.payment)}`] : []),
    `Итого по аккаунтам: ${money(sum.total.net)}`,
    `Расходы компании: −${abs(sum.company)}`,
    `Затраты на сотрудника: −${abs(sum.staff)}${sum.ded ? ` (в т.ч. вычеты −${abs(sum.ded)})` : ''}`,
    `Платежи: −${abs(sum.pays)}`,
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
          (e?.other_items || []).map(o => `${o.desc} ${o.amount}`).join('; '), t.payment, round2(t.net)])
      }
    }
    return rows
  }
  const carHeader: Cell[] = ['Месяц', 'Аккаунт', 'Машина', 'Номер', 'Gross', 'Claim', 'Supplement', 'Вычет', 'Ремонт', 'Прочее', 'Прочее (что)', 'Платёж', 'Итог']
  function exportMonth() {
    const rows: Cell[][] = [carHeader, ...carRows(period), [], ['Затраты на сотрудника'], ['Расходы', n(sum.exp?.salary1)], ['Зарплата', n(sum.exp?.salary2)]]
    for (const d of deductions.filter(x => x.date.startsWith(period.slice(0, 7)))) rows.push([`Вычет: ${d.reason} (${d.date})`, -n(d.amount)])
    rows.push(['Итого на сотрудника', round2(sum.staff)], [], ['Расходы компании'])
    for (const i of sum.exp?.items || []) rows.push([i.desc, n(i.amount)])
    rows.push([], ['Платежи'])
    for (const x of payments.filter(x => x.period === period)) rows.push([`${x.grp}: ${x.name}`, n(x.amount), x.day ? `${x.day} число` : '', x.paid ? 'оплачен' : 'не оплачен'])
    rows.push([], ['Итого по аккаунтам', round2(sum.total.net)], ['Расходы компании', round2(sum.company)], ['Затраты на сотрудника', round2(sum.staff)], ['Платежи', round2(sum.pays)], ['Чистая прибыль', round2(sum.profit)])
    downloadFile(toCsv(rows), `dohody-${format(month, 'yyyy-MM')}.csv`, 'text/csv;charset=utf-8')
    setExportOpen(false)
  }
  function exportAll() {
    const ms = monthStats.filter(s => s.has)
    const rows: Cell[][] = [['Сводка по месяцам'], ['Месяц', 'Gross', 'Итого по аккаунтам', 'Расходы компании', 'Затраты на сотрудника', 'Платежи', 'Чистая прибыль'],
      ...ms.map(s => [monthName(s.p), round2(s.total.gross), round2(s.total.net), round2(s.company), round2(s.staff), round2(s.pays), round2(s.profit)] as Cell[]),
      [], ['Машины по месяцам'], carHeader]
    ms.forEach(s => rows.push(...carRows(s.p)))
    rows.push([], ['Расходы компании по месяцам'], ['Месяц', 'Статья', 'Сумма'])
    ms.forEach(s => {
      if (n(s.exp?.salary1)) rows.push([monthName(s.p), 'Сотрудник: расходы', n(s.exp?.salary1)])
      if (n(s.exp?.salary2)) rows.push([monthName(s.p), 'Сотрудник: зарплата', n(s.exp?.salary2)])
      for (const d of deductions.filter(x => x.date.startsWith(s.p.slice(0, 7)))) rows.push([monthName(s.p), `Сотрудник: вычет — ${d.reason}`, -n(d.amount)])
      for (const i of s.exp?.items || []) rows.push([monthName(s.p), i.desc, n(i.amount)])
      for (const x of payments.filter(x => x.period === s.p)) rows.push([monthName(s.p), `Платёж · ${x.grp}: ${x.name}`, n(x.amount)])
    })
    downloadFile(toCsv(rows), `dohody-vse-mesyacy-${format(new Date(), 'yyyy-MM-dd')}.csv`, 'text/csv;charset=utf-8')
    setExportOpen(false)
  }
  async function exportBackup() {
    const supabase = createClient()
    const [a, c, e, m, t, pz] = await Promise.all([
      supabase.from('revenue_accounts').select('*'),
      supabase.from('revenue_cars').select('*'),
      supabase.from('revenue_entries').select('*'),
      supabase.from('revenue_month_expenses').select('*'),
      supabase.from('tracker_archive').select('key, value, imported_at'),
      supabase.from('revenue_payments').select('*'),
    ])
    const backup = {
      exported_at: new Date().toISOString(),
      note: 'Полная копия раздела «Доходы» + сырой архив старого TuroTracker',
      revenue_accounts: a.data, revenue_cars: c.data, revenue_entries: e.data, revenue_month_expenses: m.data, revenue_payments: pz.data, tracker_archive: t.data,
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
  const drawerLifetime = (() => {
    const list = drawerCar ? entries.filter(e => e.revenue_car_id === drawerCar.id) : []
    return { net: list.reduce((t, e) => t + calc(e).net, 0), gross: list.reduce((t, e) => t + n(e.gross), 0), months: list.length }
  })()
  const linkedIds = new Set(rcars.filter(c => c.car_id && (!c.sold_from || c.sold_from > period)).map(c => c.car_id))
  const freeFleet = fleet.filter(f => !linkedIds.has(f.id)).sort((a, b) => `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`))

  const activeAcc = sum.accs.find(x => x.a.key === view)
  const accCars = activeAcc ? carsIn(activeAcc.a.key, period) : []
  const grossRows = sum.accs.flatMap(x => carsIn(x.a.key, period).map(c => ({ c, a: x.a })))
  const grossFilled = grossRows.filter(r => n(entryOf(r.c.id, period)?.gross) > 0).length
  const prevP = pKey(subMonths(month, 1))
  const saveLabel = saveState === 'saving' ? 'Сохраняю…' : saveState === 'saved' ? 'Сохранено' : saveState === 'error' ? 'Ошибка сохранения' : 'Сохраняется автоматически'

  // Тренд (столбики)
  const trend = monthStats.filter(s => s.p <= (period > curPeriod ? period : curPeriod)).slice(-8)
  const tMaxPos = Math.max(1, ...trend.map(s => Math.max(0, s.profit)))
  const tMaxNeg = Math.max(0, ...trend.map(s => Math.max(0, -s.profit)))
  const basePct = tMaxPos / (tMaxPos + tMaxNeg) * 100
  const positiveTotal = sum.accs.reduce((s, x) => s + Math.max(0, x.t.net), 0)

  const profitUp = sum.profit >= 0

  return (
    <div className="space-y-5 pb-6 min-w-0">
      {/* Месяц и выгрузка */}
      <div className="flex items-center justify-between gap-2">
        <MonthPicker
          value={period.slice(0, 7)}
          onChange={v => setMonth(parseISO(`${v}-01`))}
          min={(monthStats[0]?.p || period).slice(0, 7)}
          max={(monthStats[monthStats.length - 1]?.p || period).slice(0, 7)}
          hint={v => { const st = monthStats.find(x => x.p === `${v}-01`); return st?.has ? { text: moneyShort(st.profit), tone: st.profit < 0 ? 'neg' : 'pos' } : null }}
          badge={period === curPeriod ? <span className="ml-1.5 text-[11px] font-medium text-gray-400">сейчас</span> : null}
        />
        <div className="relative">
          <button onClick={() => setExportOpen(o => !o)} className={`${btnGhost} h-10`} aria-label="Выгрузить"><Download size={15} /><span className="hidden sm:inline">Выгрузить</span> <ChevronDown size={14} className="text-gray-400" /></button>
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

      {/* Вкладки: одна аккуратная полоса; аккаунты — в выпадающем меню */}
      {(() => {
        const accActiveView = sum.accs.find(x => x.a.key === view)
        const seg = (on: boolean) => `inline-flex items-center justify-center gap-0.5 sm:gap-1.5 h-9 px-1.5 sm:px-3.5 rounded-lg text-[13px] sm:text-sm font-medium whitespace-nowrap transition-colors min-w-0 ${on ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`
        return (
          <div className="flex items-center gap-0.5 sm:gap-1 p-1 bg-gray-100 rounded-xl w-full sm:w-fit">
            <button onClick={() => setView('summary')} className={seg(view === 'summary')}>Сводка</button>
            <button onClick={() => setView('gross')} className={seg(view === 'gross')}>
              Gross
              {!loading && grossRows.length > 0 && <span className={`hidden sm:inline text-xs tabular-nums ${grossFilled === grossRows.length ? 'text-emerald-600' : 'text-gray-400'}`}>{grossFilled}/{grossRows.length}</span>}
            </button>
            <Popover
              panelClass="sm:w-72"
              className="flex-1 sm:flex-none"
              trigger={(open, toggle) => (
                <button onClick={toggle} className={`w-full ${seg(!!accActiveView || open)}`}>
                  {accActiveView && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${colorOf(accActiveView.a.key).dot}`} />}
                  <span className="truncate">{accActiveView ? accActiveView.a.label : 'Аккаунты'}</span>
                  <ChevronDown size={13} className="text-gray-400 flex-shrink-0" />
                </button>
              )}
            >
              {close => (
                <div className="p-2">
                  {sum.accs.map(x => (
                    <button key={x.a.key} onClick={() => { setView(x.a.key); close() }}
                      className={`w-full flex items-center gap-3 px-3 h-11 rounded-xl text-left text-sm ${view === x.a.key ? 'bg-indigo-50 text-[#4F46E5] dark:text-indigo-300 font-semibold' : 'text-gray-800 hover:bg-gray-50'}`}>
                      <span className={`w-2.5 h-2.5 rounded-full ${colorOf(x.a.key).dot}`} />
                      <span className="flex-1 min-w-0 truncate">{x.a.label} <span className="text-xs font-normal text-gray-400">· {x.cars}</span></span>
                      <span className={`text-xs tabular-nums ${x.t.net < 0 ? 'text-red-500' : 'text-gray-500'}`}>{moneyShort(x.t.net)}</span>
                    </button>
                  ))}
                  <button onClick={() => { close(); openNewAccount() }} className="mt-1 w-full flex items-center gap-2 px-3 h-11 rounded-xl text-sm font-medium text-[#4F46E5] dark:text-indigo-300 hover:bg-indigo-50">
                    <Plus size={15} /> Новый аккаунт
                  </button>
                </div>
              )}
            </Popover>
            <button onClick={() => setView('expenses')} className={seg(view === 'expenses')}>Расходы</button>
            <button onClick={() => setView('payments')} className={seg(view === 'payments')}>Платежи</button>
          </div>
        )
      })()}

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map(i => <div key={i} className="h-40 rounded-[18px] bg-white card-shadow animate-pulse" />)}
        </div>
      ) : view === 'summary' ? (
        <>
          {/* Главная строка */}
          <div className="bg-white rounded-[18px] border border-gray-100/80 card-shadow">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4 sm:px-5">
              <div className="min-w-[170px]">
                <p className="text-xs font-medium text-gray-500">Чистая прибыль · {monthName(period)}</p>
                <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                  <span className={`text-2xl font-bold tracking-tight tabular-nums ${profitUp ? 'text-emerald-600' : 'text-red-600'}`}>{money(sum.profit)}</span>
                  {delta !== null && (
                    <span className={`inline-flex items-center gap-0.5 text-xs font-medium tabular-nums ${delta >= 0 ? 'text-emerald-600' : 'text-red-500'}`} title="К прошлому месяцу">
                      {delta >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{abs(delta)}
                    </span>
                  )}
                </div>
              </div>
              <div className="order-3 sm:order-none w-full sm:w-auto sm:flex-1 grid grid-cols-3 sm:grid-cols-6 gap-x-4 gap-y-2 border-t border-gray-100 pt-3 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-6">
                {[
                  { label: 'Gross', value: money(sum.total.gross), cls: 'text-gray-900' },
                  { label: 'Клеймы (чистыми)', value: money(sum.total.claim + sum.total.supp - sum.total.ded - sum.total.repair), cls: 'text-gray-900' },
                  { label: 'Прочее, платежи', value: sum.total.other || sum.total.payment ? `−${abs(sum.total.other + sum.total.payment)}` : '—', cls: 'text-gray-500' },
                  { label: 'Компания', value: `−${abs(sum.company)}`, cls: 'text-gray-500', go: 'expenses' },
                  { label: 'Сотрудник', value: `−${abs(sum.staff)}`, cls: 'text-gray-500', go: 'expenses' },
                  { label: 'Платежи', value: `−${abs(sum.pays)}`, cls: 'text-gray-500', go: 'payments' },
                ].map(st => (
                  <button key={st.label} onClick={() => st.go && setView(st.go)} disabled={!st.go} className={`text-left ${st.go ? 'hover:opacity-70' : 'cursor-default'}`}>
                    <span className="block text-[11px] uppercase tracking-wide text-gray-400">{st.label}</span>
                    <span className={`block text-sm font-semibold tabular-nums ${st.cls}`}>{st.value}</span>
                  </button>
                ))}
              </div>
              <div className="ml-auto flex gap-1.5">
                <button onClick={shareReport} className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><Send size={15} className="text-[#229ED9]" /> Telegram</button>
                <button onClick={async () => { if (await copyText(reportText)) flash('Текст скопирован') }} className="inline-flex items-center rounded-xl border border-gray-200 px-2.5 py-2 text-gray-500 hover:bg-gray-50" aria-label="Копировать текст"><Copy size={15} /></button>
              </div>
            </div>
          </div>

          {/* Аккаунты — таблица */}
          <div className="bg-white rounded-[18px] border border-gray-100/80 card-shadow overflow-hidden">
            <div className="flex items-center justify-between px-4 sm:px-5 py-3.5">
              <h2 className="text-base font-bold text-gray-900">По аккаунтам</h2>
              <span className="hidden sm:inline text-xs text-gray-400">нажмите на строку, чтобы открыть таблицу аккаунта</span>
            </div>
            {/* Телефон — списком, нажмите на аккаунт */}
            <ul className="sm:hidden divide-y divide-gray-100 border-t border-gray-100">
              {sum.accs.filter(x => x.cars > 0 || x.t.net !== 0).map(x => (
                <li key={x.a.key}>
                  <button onClick={() => setView(x.a.key)} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-gray-50">
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${colorOf(x.a.key).dot}`} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[15px] font-semibold text-gray-900 truncate">{x.a.label} <span className="text-xs font-normal text-gray-400">· {x.cars}</span></span>
                      <span className="block text-xs text-gray-500 truncate">gross {money(x.t.gross)} · клеймы {money(x.t.claim + x.t.supp - x.t.ded - x.t.repair)}{x.t.other + x.t.payment ? ` · расходы −${abs(x.t.other + x.t.payment)}` : ''}</span>
                    </span>
                    <span className={`text-base font-bold tabular-nums ${x.t.net < 0 ? 'text-red-600' : 'text-gray-900'}`}>{money(x.t.net)}</span>
                  </button>
                </li>
              ))}
              <li className="flex items-center justify-between px-4 py-2.5 bg-gray-50 text-sm font-semibold"><span>Итого по аккаунтам</span><span className="tabular-nums">{money(sum.total.net)}</span></li>
              <li><button onClick={() => setView('expenses')} className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-gray-600"><span>Расходы компании</span><span className="tabular-nums">−{abs(sum.company)}</span></button></li>
              <li><button onClick={() => setView('expenses')} className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-gray-600"><span>Затраты на сотрудника</span><span className="tabular-nums">−{abs(sum.staff)}</span></button></li>
              <li><button onClick={() => setView('payments')} className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-gray-600"><span>Платежи</span><span className="tabular-nums">−{abs(sum.pays)}</span></button></li>
              <li className={`flex items-center justify-between px-4 py-3 font-bold ${profitUp ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}><span className="text-gray-900">Чистая прибыль</span><span className="tabular-nums">{money(sum.profit)}</span></li>
            </ul>

            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full min-w-[780px] border-collapse text-[15px] sm:text-sm tabular-nums">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-gray-500">
                    <th className="sticky left-0 z-10 bg-gray-100 border-y border-r border-gray-200 px-4 py-2.5 text-left font-semibold">Аккаунт</th>
                    <th className="bg-gray-100 border-y border-r border-gray-200 px-3 py-2.5 text-right font-semibold">Gross</th>
                    <th className="bg-gray-100 border-y border-r border-gray-200 px-3 py-2.5 text-right font-semibold">Клеймы <span className="normal-case font-normal">(после вычета и ремонта)</span></th>
                    <th className="bg-gray-100 border-y border-r border-gray-200 px-3 py-2.5 text-right font-semibold">Прочее</th>
                    <th className="bg-gray-100 border-y border-r border-gray-200 px-3 py-2.5 text-right font-semibold">Платежи машин</th>
                    <th className="bg-gray-100 border-y border-r border-gray-200 px-3 py-2.5 text-right font-semibold">Итог</th>
                    <th className="bg-gray-100 border-y border-gray-200 px-4 py-2.5 text-left font-semibold w-[170px]">Доля дохода</th>
                  </tr>
                </thead>
                <tbody>
                  {sum.accs.filter(x => x.cars > 0 || x.t.net !== 0).map(x => {
                    const share = positiveTotal > 0 && x.t.net > 0 ? x.t.net / positiveTotal * 100 : 0
                    return (
                      <tr key={x.a.key} onClick={() => setView(x.a.key)} className="group cursor-pointer">
                        <td className="sticky left-0 z-10 bg-white group-hover:bg-indigo-50/60 border-b border-r border-gray-200 px-4 py-2.5">
                          <span className="flex items-center gap-2">
                            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${colorOf(x.a.key).dot}`} />
                            <span className="font-semibold text-gray-900">{x.a.label}</span>
                            <span className="text-xs text-gray-400">{x.cars} {x.cars === 1 ? 'машина' : x.cars >= 2 && x.cars <= 4 ? 'машины' : 'машин'}</span>
                          </span>
                        </td>
                        <td className="group-hover:bg-indigo-50/60 border-b border-r border-gray-200 px-3 py-2.5 text-right text-gray-700">{money(x.t.gross)}</td>
                        <td className="group-hover:bg-indigo-50/60 border-b border-r border-gray-200 px-3 py-2.5 text-right text-gray-700">{money(x.t.claim + x.t.supp - x.t.ded - x.t.repair)}</td>
                        <td className="group-hover:bg-indigo-50/60 border-b border-r border-gray-200 px-3 py-2.5 text-right text-gray-500">{x.t.other ? `−${abs(x.t.other)}` : '—'}</td>
                        <td className="group-hover:bg-indigo-50/60 border-b border-r border-gray-200 px-3 py-2.5 text-right text-gray-500">{x.t.payment ? `−${abs(x.t.payment)}` : '—'}</td>
                        <td className={`group-hover:bg-indigo-50/60 border-b border-r border-gray-200 px-3 py-2.5 text-right font-bold ${x.t.net < 0 ? 'text-red-600' : 'text-gray-900'}`}>{money(x.t.net)}</td>
                        <td className="group-hover:bg-indigo-50/60 border-b border-gray-200 px-4 py-2.5">
                          <span className="flex items-center gap-2">
                            <span className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100"><span className={`block h-full rounded-full ${colorOf(x.a.key).dot}`} style={{ width: `${share}%` }} /></span>
                            <span className="w-9 text-right text-xs text-gray-500">{share ? `${Math.round(share)}%` : '—'}</span>
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-semibold text-gray-800">
                    <td className="sticky left-0 z-10 bg-gray-50 border-b border-r border-gray-200 px-4 py-2.5">Итого по аккаунтам</td>
                    <td className="bg-gray-50 border-b border-r border-gray-200 px-3 py-2.5 text-right">{money(sum.total.gross)}</td>
                    <td className="bg-gray-50 border-b border-r border-gray-200 px-3 py-2.5 text-right">{money(sum.total.claim + sum.total.supp - sum.total.ded - sum.total.repair)}</td>
                    <td className="bg-gray-50 border-b border-r border-gray-200 px-3 py-2.5 text-right text-gray-500">{sum.total.other ? `−${abs(sum.total.other)}` : '—'}</td>
                    <td className="bg-gray-50 border-b border-r border-gray-200 px-3 py-2.5 text-right text-gray-500">{sum.total.payment ? `−${abs(sum.total.payment)}` : '—'}</td>
                    <td className="bg-gray-50 border-b border-r border-gray-200 px-3 py-2.5 text-right">{money(sum.total.net)}</td>
                    <td className="bg-gray-50 border-b border-gray-200" />
                  </tr>
                  <tr className="cursor-pointer text-gray-600 hover:bg-gray-50" onClick={() => setView('expenses')}>
                    <td className="sticky left-0 z-10 bg-white border-b border-r border-gray-200 px-4 py-2.5">Расходы компании</td>
                    <td colSpan={4} className="border-b border-r border-gray-200 px-3 py-2.5 text-right text-xs text-gray-400">{(sum.exp?.items || []).length} поз. · покупки и прочее</td>
                    <td className="border-b border-r border-gray-200 px-3 py-2.5 text-right">−{abs(sum.company)}</td>
                    <td className="border-b border-gray-200" />
                  </tr>
                  <tr className="cursor-pointer text-gray-600 hover:bg-gray-50" onClick={() => setView('expenses')}>
                    <td className="sticky left-0 z-10 bg-white border-b border-r border-gray-200 px-4 py-2.5">Затраты на сотрудника</td>
                    <td colSpan={4} className="border-b border-r border-gray-200 px-3 py-2.5 text-right text-xs text-gray-400">расходы {money(n(sum.exp?.salary1))} · зарплата {money(n(sum.exp?.salary2))}{sum.ded ? ` · вычеты −${abs(sum.ded)}` : ''}{sum.dedPending ? ` · вычеты ${money(sum.dedPending)} — после ввода зарплаты` : ''}</td>
                    <td className="border-b border-r border-gray-200 px-3 py-2.5 text-right">−{abs(sum.staff)}</td>
                    <td className="border-b border-gray-200" />
                  </tr>
                  <tr className="cursor-pointer text-gray-600 hover:bg-gray-50" onClick={() => setView('payments')}>
                    <td className="sticky left-0 z-10 bg-white border-b border-r border-gray-200 px-4 py-2.5">Платежи</td>
                    <td colSpan={4} className="border-b border-r border-gray-200 px-3 py-2.5 text-right text-xs text-gray-400">{payments.filter(x => x.period === period).length} платежей · машины, страховки, GPS</td>
                    <td className="border-b border-r border-gray-200 px-3 py-2.5 text-right">−{abs(sum.pays)}</td>
                    <td className="border-b border-gray-200" />
                  </tr>
                  <tr className={profitUp ? 'bg-emerald-50' : 'bg-red-50'}>
                    <td className={`sticky left-0 z-10 border-r border-gray-200 px-4 py-3 font-bold text-gray-900 ${profitUp ? 'bg-emerald-50' : 'bg-red-50'}`}>Чистая прибыль</td>
                    <td colSpan={4} className="border-r border-gray-200" />
                    <td className={`border-r border-gray-200 px-3 py-3 text-right text-base font-bold ${profitUp ? 'text-emerald-700' : 'text-red-600'}`}>{money(sum.profit)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
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
                        <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{r.c.name}{r.c.car ? <span className="font-mono text-xs text-gray-500"> {r.c.car.plate}</span> : null} <span className="text-gray-400">· {r.a.label}</span></span>
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
                          <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{r.c.name}{r.c.car ? <span className="font-mono text-xs text-gray-500"> {r.c.car.plate}</span> : null} <span className="text-gray-400">· {r.a.label}</span></span>
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
      ) : view === 'payments' ? (
        <PaymentsPanel period={period} items={payments.filter(x => x.period === period)}
          prevCount={payments.filter(x => x.period === pKey(subMonths(month, 1))).length} prevLabel={monthName(pKey(subMonths(month, 1)), 'LLLL').toLowerCase()}
          onAdd={addPayment} onUpdate={updatePayment} onDelete={deletePayment} onCopyPrev={copyPrevPayments} />
      ) : view === 'expenses' ? (
        <ExpensesPanel key={period} period={period} payroll={payroll} deductions={deductions.filter(x => x.date.startsWith(period.slice(0, 7)))} onDeductionsChanged={load} onSave={saveExpenses}
          value={sum.exp || { period, salary1: 0, salary2: 0, items: [] }} />
      ) : view === 'gross' ? (
        <div className="bg-white rounded-[18px] border border-gray-100/80 card-shadow overflow-hidden">
          <div className="px-4 sm:px-5 pt-5 pb-4 border-b border-gray-100">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Gross за {monthName(period, 'LLLL')}</h2>
                <p className="text-sm text-gray-500 mt-0.5">Впишите, сколько пришло с Turo по каждой машине. <span className="hidden sm:inline">Enter — следующая машина.</span></p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold tabular-nums text-gray-900">{money(sum.total.gross)}</p>
                <p className={`text-xs ${saveState === 'error' ? 'text-red-600' : saveState === 'saved' ? 'text-emerald-600' : 'text-gray-400'}`}>{saveLabel}</p>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${grossRows.length ? grossFilled / grossRows.length * 100 : 0}%` }} />
              </div>
              <span className="text-xs font-medium tabular-nums text-gray-500">заполнено {grossFilled} из {grossRows.length}</span>
            </div>
          </div>
          {sum.accs.filter(x => x.cars > 0).map(x => {
            const rows = grossRows.filter(r => r.a.key === x.a.key)
            return (
              <div key={x.a.key}>
                <div className="flex items-center justify-between gap-2 bg-gray-50 px-4 sm:px-5 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <span className="inline-flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${colorOf(x.a.key).dot}`} />{x.a.label}</span>
                  <span className="tabular-nums normal-case">{money(x.t.gross)}</span>
                </div>
                {rows.map(r => {
                  const idx = grossRows.indexOf(r)
                  const g = n(entryOf(r.c.id, period)?.gross)
                  const prev = entryOf(r.c.id, prevP)
                  return (
                    <div key={r.c.id} className="grid grid-cols-[1fr_148px] sm:grid-cols-[1fr_auto_160px] items-center gap-3 border-t border-gray-100 px-4 sm:px-5 py-2.5 sm:py-1.5">
                      <div className="min-w-0">
                        <p className="truncate text-[15px] sm:text-sm font-medium text-gray-900">{r.c.name}</p>
                        <p className="truncate text-xs text-gray-400">
                          <span className="font-mono font-semibold text-gray-600">{r.c.car?.plate}</span>
                          {/* На телефоне прошлый месяц — под названием */}
                          {prev && n(prev.gross) ? <span className="sm:hidden">{r.c.car ? ' · ' : ''}было {money(n(prev.gross))}</span> : null}
                        </p>
                      </div>
                      <span className="hidden sm:block text-xs tabular-nums text-gray-400 text-right" title="Прошлый месяц">{prev && n(prev.gross) ? <>было {money(n(prev.gross))}</> : ''}</span>
                      <div className="flex items-center gap-1.5">
                        <NumCell grid="gross" row={idx} col={0} value={g} placeholder="0" strong boxed
                          onCommit={v => patchEntry(r.c.id, e => ({ ...e, gross: v }))} />
                        <Check size={16} className={g > 0 ? 'text-emerald-500 flex-shrink-0' : 'text-transparent flex-shrink-0'} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      ) : activeAcc ? (
        <div className="bg-white rounded-[18px] border border-gray-100/80 card-shadow overflow-hidden">
          {/* Шапка аккаунта: имя и действия, ниже — итоги месяца одной строкой */}
          <div className="px-4 sm:px-5 pt-4 pb-3 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <span className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold flex-shrink-0 ${colorOf(activeAcc.a.key).soft}`}>{activeAcc.a.label.slice(0, 1)}</span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold text-gray-900 truncate">{activeAcc.a.label}</h2>
                <p className={`text-xs truncate ${saveState === 'error' ? 'text-red-600' : saveState === 'saved' ? 'text-emerald-600' : 'text-gray-400'}`}>{accCars.length} {accCars.length === 1 ? 'машина' : accCars.length >= 2 && accCars.length <= 4 ? 'машины' : 'машин'} · {saveLabel}</p>
              </div>
              <button onClick={() => openEditAccount(activeAcc.a)} className="btn-secondary inline-flex items-center justify-center gap-1.5 w-9 sm:w-auto sm:px-3 h-9" aria-label="Настроить аккаунт"><Pencil size={15} /><span className="hidden sm:inline">Аккаунт</span></button>
              <button onClick={() => setAddCar(true)} className="btn-primary inline-flex items-center gap-1.5 px-3 h-9"><Plus size={16} /> Машина</button>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              {[
                { label: 'Итог', value: money(activeAcc.t.net), cls: activeAcc.t.net < 0 ? 'text-red-600' : 'text-gray-900', strong: true },
                { label: 'Gross', value: money(activeAcc.t.gross), cls: 'text-gray-900' },
                { label: 'Клеймы', value: money(activeAcc.t.claim + activeAcc.t.supp - activeAcc.t.ded), cls: 'text-gray-900' },
                { label: 'Расходы', value: activeAcc.t.repair + activeAcc.t.other + activeAcc.t.payment ? `−${abs(activeAcc.t.repair + activeAcc.t.other + activeAcc.t.payment)}` : '—', cls: 'text-gray-500' },
              ].map(st => (
                <div key={st.label} className={`rounded-xl px-1.5 py-2 ${st.strong ? (activeAcc.t.net < 0 ? 'bg-red-50' : 'bg-emerald-50') : 'bg-gray-50'}`}>
                  <p className="text-[10px] uppercase tracking-wide text-gray-500">{st.label}</p>
                  <p className={`text-sm font-bold tabular-nums truncate ${st.cls}`}>{st.value}</p>
                </div>
              ))}
            </div>
          </div>
          {accCars.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">В этом аккаунте нет машин за этот месяц</div>
          ) : (<>
            {/* Телефон: у каждой машины — Gross прямо здесь, остальное по нажатию на машину */}
            <ul className="sm:hidden divide-y divide-gray-100">
              {accCars.map((c, ri) => {
                const e = entryOf(c.id, period)
                const t = calc(e)
                const extras = [
                  t.claim + t.supp ? `клейм ${money(t.claim + t.supp - t.ded)}` : '',
                  t.repair ? `ремонт −${abs(t.repair)}` : '',
                  t.other ? `прочее −${abs(t.other)}` : '',
                  t.payment ? `платёж −${abs(t.payment)}` : '',
                ].filter(Boolean)
                return (
                  <li key={c.id} className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <button onClick={() => setDrawer(c.id)} className="flex-1 min-w-0 text-left">
                        <span className="block text-[15px] font-semibold text-gray-900 truncate">{c.name}</span>
                        <span className="block text-xs text-gray-500 truncate"><span className="font-mono font-semibold text-gray-600">{c.car?.plate || 'не привязана'}</span>{extras.length ? ` · ${extras.join(' · ')}` : ''}</span>
                      </button>
                      <span className={`text-base font-bold tabular-nums whitespace-nowrap ${!e ? 'text-gray-300' : t.net < 0 ? 'text-red-600' : 'text-gray-900'}`}>{e ? money(t.net) : '—'}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-500 w-12">Gross</span>
                      <div className="flex-1">
                        <NumCell grid={`m-acc-${activeAcc.a.key}`} row={ri} col={0} value={n(e?.gross)} placeholder="0" strong boxed onCommit={v => patchEntry(c.id, x => ({ ...x, gross: v }))} />
                      </div>
                      <button onClick={() => setDrawer(c.id)} className="h-11 px-3 rounded-xl bg-gray-100 text-sm font-medium text-gray-700">Ещё</button>
                    </div>
                  </li>
                )
              })}
            </ul>

            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full min-w-[1010px] table-fixed border-collapse text-[15px] sm:text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-gray-500">
                    <th className="sticky left-0 z-20 bg-gray-100 border-b border-r border-gray-200 px-4 py-2.5 w-[190px] text-left font-semibold">Машина</th>
                    <th className="bg-gray-100 border-b border-r border-gray-200 px-3 py-2.5 w-[120px] text-right font-semibold">Gross</th>
                    <th className="bg-gray-100 border-b border-r border-gray-200 px-3 py-2.5 w-[110px] text-right font-semibold">Claim</th>
                    <th className="bg-gray-100 border-b border-r border-gray-200 px-3 py-2.5 w-[120px] text-right font-semibold">Supplement</th>
                    <th className="bg-gray-100 border-b border-r border-gray-200 px-3 py-2.5 w-[80px] text-right font-semibold">% выч.</th>
                    <th className="bg-gray-100 border-b border-r border-gray-200 px-3 py-2.5 w-[110px] text-right font-semibold">Вычет</th>
                    <th className="bg-gray-100 border-b border-r border-gray-200 px-3 py-2.5 w-[110px] text-right font-semibold">Ремонт</th>
                    <th className="bg-gray-100 border-b border-r border-gray-200 px-3 py-2.5 w-[120px] text-right font-semibold">Прочее</th>
                    <th className="bg-gray-100 border-b border-r border-gray-200 px-3 py-2.5 w-[110px] text-right font-semibold" title="Ежемесячный платёж за машину (кредит/лизинг), если платите вы. Переносится в следующий месяц сам.">Платёж</th>
                    <th className="bg-gray-100 border-b border-gray-200 px-4 py-2.5 text-right font-semibold">Итог</th>
                  </tr>
                </thead>
                <tbody>
                  {accCars.map((c, ri) => {
                    const e = entryOf(c.id, period)
                    const t = calc(e)
                    const items = e?.claim_items || []
                    const first = items[0]
                    const grid = `acc-${activeAcc.a.key}`
                    const cell = 'border-b border-r border-gray-200 p-0 bg-white group-hover:bg-indigo-50/40 group-focus-within:bg-indigo-50/60'
                    const calcCell = 'border-b border-r border-gray-200 px-3 py-2.5 text-right tabular-nums bg-gray-50 group-focus-within:bg-indigo-50/60'
                    return (
                      <tr key={c.id} className="group">
                        <td className="sticky left-0 z-10 border-b border-r border-gray-200 bg-white group-hover:bg-indigo-50/40 group-focus-within:bg-indigo-50 px-4 py-1.5">
                          <button onClick={() => setDrawer(c.id)} className="text-left" title="Подробнее: несколько клеймов, прочие расходы, история">
                            <span className="block font-medium text-gray-900 hover:text-indigo-600">{c.name}</span>
                            <span className={`block text-[11px] font-mono ${c.car ? 'font-semibold text-gray-600' : 'text-gray-400'}`}>{c.car?.plate || 'не привязана'}</span>
                          </button>
                        </td>
                        <td className={`${cell} w-[120px]`}><NumCell grid={grid} row={ri} col={0} value={n(e?.gross)} strong onCommit={v => patchEntry(c.id, x => ({ ...x, gross: v }))} /></td>
                        {items.length > 1 ? (
                          <td colSpan={3} className={cell}>
                            <button onClick={() => setDrawer(c.id)} className="w-full px-3 py-2.5 text-right text-indigo-700 hover:bg-indigo-50">
                              {items.length} клейма · {money(t.claim)} / {money(t.supp)}
                            </button>
                          </td>
                        ) : (
                          <>
                            <td className={`${cell} w-[120px]`}><NumCell grid={grid} row={ri} col={1} value={n(first?.claim)} onCommit={v => setClaimField(c.id, 'claim', v)} /></td>
                            <td className={`${cell} w-[120px]`}><NumCell grid={grid} row={ri} col={2} value={n(first?.supplement)} onCommit={v => setClaimField(c.id, 'supplement', v)} /></td>
                            <td className={`${cell} w-[80px]`}><NumCell grid={grid} row={ri} col={3} value={n(first?.pct)} pct placeholder={first ? '0' : '20'} onCommit={v => setClaimField(c.id, 'pct', v)} /></td>
                          </>
                        )}
                        <td className={`${calcCell} text-gray-500`}>{t.ded ? `−${abs(t.ded)}` : ''}</td>
                        <td className={`${cell} w-[110px]`}><NumCell grid={grid} row={ri} col={4} value={n(e?.repair)} onCommit={v => patchEntry(c.id, x => ({ ...x, repair: v }))} /></td>
                        <td className={cell}>
                          <button onClick={() => setDrawer(c.id)} className={`w-full px-3 py-2.5 text-right tabular-nums hover:bg-indigo-50 ${t.other ? 'text-red-600' : 'text-gray-300'}`} title={(e?.other_items || []).map(o => `${o.desc}: ${o.amount}`).join('\n') || 'Добавить расход'}>
                            {t.other ? `−${abs(t.other)}` : '+ добавить'}
                          </button>
                        </td>
                        <td className={`${cell} w-[110px]`}><NumCell grid={grid} row={ri} col={5} value={n(e?.payment)} onCommit={v => patchEntry(c.id, x => ({ ...x, payment: v }))} /></td>
                        <td className={`border-b border-gray-200 px-4 py-2.5 text-right font-bold tabular-nums bg-gray-50 group-focus-within:bg-indigo-50/60 ${!e ? 'text-gray-300' : t.net < 0 ? 'text-red-600' : 'text-gray-900'}`}>{e ? money(t.net) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-semibold tabular-nums text-gray-800">
                    <td className="sticky left-0 z-10 bg-gray-100 border-r border-gray-200 px-4 py-3 text-left">Итого</td>
                    <td className="bg-gray-100 border-r border-gray-200 px-3 py-3 text-right">{money(activeAcc.t.gross)}</td>
                    <td className="bg-gray-100 border-r border-gray-200 px-3 py-3 text-right">{money(activeAcc.t.claim)}</td>
                    <td className="bg-gray-100 border-r border-gray-200 px-3 py-3 text-right">{money(activeAcc.t.supp)}</td>
                    <td className="bg-gray-100 border-r border-gray-200" />
                    <td className="bg-gray-100 border-r border-gray-200 px-3 py-3 text-right text-gray-500">−{abs(activeAcc.t.ded)}</td>
                    <td className="bg-gray-100 border-r border-gray-200 px-3 py-3 text-right text-gray-500">−{abs(activeAcc.t.repair)}</td>
                    <td className="bg-gray-100 border-r border-gray-200 px-3 py-3 text-right text-gray-500">−{abs(activeAcc.t.other)}</td>
                    <td className="bg-gray-100 border-r border-gray-200 px-3 py-3 text-right text-gray-500">{activeAcc.t.payment ? `−${abs(activeAcc.t.payment)}` : '—'}</td>
                    <td className={`bg-gray-100 px-4 py-3 text-right text-base font-bold ${activeAcc.t.net < 0 ? 'text-red-600' : 'text-gray-900'}`}>{money(activeAcc.t.net)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>)}
          <p className="sm:hidden px-4 py-3 text-xs text-gray-400 border-t border-gray-100">Gross вписывайте прямо здесь. Клеймы, ремонт, прочие расходы и платёж — кнопка «Ещё» или нажмите на машину.</p>
          <p className="hidden sm:block px-5 py-3 text-xs text-gray-400 border-t border-gray-100">Белые ячейки можно редактировать — нажмите и пишите цифру, сохраняется само. «Платёж» — платёж за машину, если его платите вы; в новый месяц переносится сам (поставьте 0, если платежа больше нет). Enter — следующая строка, Tab — следующая колонка. Серые считаются автоматически. Несколько клеймов, прочие расходы и история — нажмите на название машины.</p>
        </div>
      ) : null}

      {/* Панель машины */}
      {drawerCar && (
        <CarDrawer key={`${drawerCar.id}|${period}`}
          rcar={drawerCar} accLabel={drawerAcc?.label || ''} period={period}
          entry={entryOf(drawerCar.id, period)} history={drawerHistory} lifetime={drawerLifetime}
          fleetOptions={[...(drawerCar.car_id ? fleet.filter(f => f.id === drawerCar.car_id) : []), ...freeFleet]}
          onSave={saveEntry} onClose={() => setDrawer(null)}
          onLink={id => linkCar(drawerCar, id)} onSold={() => markSold(drawerCar)} onUnsold={() => unSold(drawerCar)} />
      )}

      {/* Новая машина */}
      {addCar && activeAcc && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-[2px] flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={e => { if (e.target === e.currentTarget) setAddCar(false) }}>
          <div className="bg-white rounded-t-[22px] sm:rounded-[20px] shadow-2xl p-5 sm:p-6 w-full max-w-sm space-y-4 animate-in" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Новая машина</h2>
              <p className="text-sm text-gray-500">{activeAcc.a.label} · с {format(month, 'MMMM yyyy', { locale: ru })}</p>
            </div>
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 mb-1">Машина из «Авто»</span>
              <select id="income-new-car" autoFocus value={newCarId} onChange={e => setNewCarId(e.target.value)} className={inputCls}>
                <option value="">Выберите машину…</option>
                {freeFleet.filter(f => inFleet(f, period)).map(f => <option key={f.id} value={f.id}>{f.make} {f.model} {f.plate}</option>)}
              </select>
            </label>
            <p className="text-xs text-gray-500">Название и номер берутся из «Авто». Нет нужной машины — сначала добавьте её в «Авто → Машины».</p>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setAddCar(false)} className="btn-secondary flex-1 h-11">Отмена</button>
              <button onClick={createCar} disabled={!newCarId} className="btn-primary flex-1 h-11">Добавить</button>
            </div>
          </div>
        </div>
      )}

      {accForm && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-[2px] flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={e => { if (e.target === e.currentTarget) setAccForm(null) }}>
          <div className="bg-white rounded-t-[22px] sm:rounded-[20px] shadow-2xl p-5 sm:p-6 w-full max-w-sm space-y-4 animate-in" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
            <div>
              <h2 className="text-lg font-bold text-gray-900">{accForm.key ? 'Настройки аккаунта' : 'Новый аккаунт Turo'}</h2>
              <p className="text-sm text-gray-500">{accForm.key ? 'Имя и месяцы, когда аккаунт работает' : 'Машины добавите после — кнопкой «Машина» в аккаунте'}</p>
            </div>
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 mb-1">Имя аккаунта</span>
              <input autoFocus value={accForm.label} onChange={e => setAccForm(f => f && ({ ...f, label: e.target.value }))} placeholder="Например, Карам" className={inputCls} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-sm font-medium text-gray-700 mb-1">Работает с</span>
                <select value={accForm.from} onChange={e => setAccForm(f => f && ({ ...f, from: e.target.value }))} className={inputCls}>
                  {Array.from({ length: 25 }, (_, i) => pKey(addMonths(subMonths(new Date(), 12), i))).map(p => <option key={p} value={p}>{monthName(p)}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-gray-700 mb-1">Последний месяц</span>
                <select value={accForm.until} onChange={e => setAccForm(f => f && ({ ...f, until: e.target.value }))} className={inputCls}>
                  <option value="">Работает</option>
                  {Array.from({ length: 25 }, (_, i) => pKey(addMonths(subMonths(new Date(), 12), i))).filter(p => p >= accForm.from).map(p => <option key={p} value={p}>{monthName(p)}</option>)}
                </select>
              </label>
            </div>
            {accForm.key && accForm.until && <p className="text-xs text-gray-500">После {monthName(accForm.until, 'LLLL')} аккаунт исчезнет из вкладок. Данные за прошлые месяцы сохранятся.</p>}
            <div className="flex gap-3 pt-1">
              <button onClick={() => setAccForm(null)} className="btn-secondary flex-1 h-11">Отмена</button>
              <button onClick={saveAccount} disabled={!accForm.label.trim()} className="btn-primary flex-1 h-11">{accForm.key ? 'Сохранить' : 'Добавить'}</button>
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

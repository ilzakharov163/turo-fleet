'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { Car } from '@/types'
import { Send, Copy, Check, Download, ChevronLeft, ChevronRight, Car as CarIcon, ShieldAlert, Users, Layers, Wallet } from 'lucide-react'
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isWithinInterval, isSameMonth, addMonths, subMonths, startOfDay } from 'date-fns'
import { ru } from 'date-fns/locale'
import { notify } from '@/lib/ui'
import { calcSalary, calcEntry } from '@/lib/calc'

// ── Типы ──
interface Block {
  car_id: string
  start_date: string
  end_date: string | null
  reason: string | null
}

interface Claim {
  id: string
  car_id: string | null
  status: 'waiting' | 'in_repair' | 'done'
  opened_date: string | null
  completed_date: string | null
  initial_payment_received: boolean
  supplement_paid: boolean
  notes: string | null
  created_at: string
  car?: { make: string; model: string; plate: string } | null
}

type Cell = string | number

// ── Доходы (данные раздела «Доходы») ──
interface RevAcc { key: string; label: string; sort: number; active_from: string; active_until: string | null }
interface RevCar { id: string; account: string; name: string; added_from: string; sold_from: string | null }
interface RevEntry { revenue_car_id: string; period: string; gross: number; repair: number; claim_items: { claim: number; supplement: number; pct: number }[]; other_items: { desc: string; amount: number }[] }
interface RevExp { period: string; salary1: number; salary2: number; items: { desc: string; amount: number }[] }
const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
function revCalc(e?: RevEntry) {
  const t = calcEntry(e)
  return { gross: t.gross, net: t.net }
}
const usd = (v: number) => { const r = Math.round(v * 100) / 100; return `${r < 0 ? '−' : ''}$${Math.abs(r).toLocaleString('en-US', { maximumFractionDigits: 2 })}` }

interface Report {
  key: string
  title: string
  subtitle: string
  icon: typeof CarIcon
  color: string
  text: string
  csv: Cell[][]
  file: string
}


const carName = (c?: { make: string; model: string; plate: string } | null) => (c ? `${c.make} ${c.model} ${c.plate}` : '— без авто —')
const d = (iso: string) => format(parseISO(iso), 'd MMM', { locale: ru })
const blockEnd = (b: Block) => (b.end_date ? parseISO(b.end_date) : new Date(9999, 0))
const byName = (a: Car, b: Car) => `${a.make} ${a.model} ${a.plate}`.localeCompare(`${b.make} ${b.model} ${b.plate}`)

function downloadCsv(rows: Cell[][], file: string) {
  const esc = (v: Cell) => `"${String(v).replace(/"/g, '""')}"`
  const csv = '﻿' + rows.map(r => r.map(esc).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function shareText(text: string, onCopied: () => void) {
  if (typeof navigator !== 'undefined' && navigator.share) {
    try { await navigator.share({ text }) } catch { /* отменено */ }
    return
  }
  await copyText(text, onCopied)
}

async function copyText(text: string, onCopied: () => void) {
  try {
    await navigator.clipboard.writeText(text)
    onCopied()
  } catch {
    notify('Не удалось скопировать — попробуй ещё раз', 'error')
  }
}

export default function ReportsView() {
  const [loading, setLoading] = useState(true)
  const [cars, setCars] = useState<Car[]>([])
  const [blocks, setBlocks] = useState<Block[]>([])
  const [claims, setClaims] = useState<Claim[]>([])
  const [rev, setRev] = useState<{ accs: RevAcc[]; cars: RevCar[]; entries: RevEntry[]; exp: RevExp[]; pays: { period: string; amount: number }[] }>({ accs: [], cars: [], entries: [], exp: [], pays: [] })
  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()))
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const [carsRes, blocksRes, claimsRes, raRes, rcRes, reRes, rxRes, rpRes] = await Promise.all([
      supabase.from('cars').select('*'),
      supabase.from('car_blocks').select('car_id, start_date, end_date, reason'),
      supabase.from('claims').select('*, car:cars(make,model,plate)').order('opened_date', { ascending: true }),
      supabase.from('revenue_accounts').select('key, label, sort, active_from, active_until').order('sort'),
      supabase.from('revenue_cars').select('id, account, name, added_from, sold_from').order('sort'),
      supabase.from('revenue_entries').select('revenue_car_id, period, gross, repair, claim_items, other_items'),
      supabase.from('revenue_month_expenses').select('period, salary1, salary2, items'),
      supabase.from('revenue_payments').select('period, amount'),
    ])
    setCars(carsRes.data || [])
    setBlocks((blocksRes.data as Block[]) || [])
    setClaims((claimsRes.data as Claim[]) || [])
    setRev({ accs: (raRes.data as RevAcc[]) || [], cars: (rcRes.data as RevCar[]) || [], entries: (reRes.data as RevEntry[]) || [], exp: (rxRes.data as RevExp[]) || [], pays: (rpRes.data as { period: string; amount: number }[]) || [] })
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function flash(key: string) {
    setCopied(key)
    setTimeout(() => setCopied(c => (c === key ? null : c)), 2000)
  }

  const now = new Date()
  const today = startOfDay(now)
  const todayLabel = format(now, 'd MMMM yyyy', { locale: ru })
  const monthLabel = format(month, 'LLLL yyyy', { locale: ru })
  const listed = cars.filter(c => !c.delisted).sort(byName)
  const delistedCount = cars.length - listed.length

  // ── 1. Автопарк сегодня ──
  const fleetRows = listed.map(car => {
    const b = blocks.find(x => x.car_id === car.id && isWithinInterval(today, { start: parseISO(x.start_date), end: blockEnd(x) }))
    return { car, block: b || null }
  })
  const activeCars = fleetRows.filter(r => !r.block)
  const idleCars = fleetRows.filter(r => r.block)
  const idleLine = (r: { car: Car; block: Block | null }) => {
    const parts = [r.block?.reason, r.block?.end_date ? `до ${d(r.block.end_date)}` : 'без даты окончания'].filter(Boolean)
    return `• ${carName(r.car)} — ${parts.join(', ')}`
  }
  const fleetText = [
    `🚗 Автопарк на ${todayLabel}`,
    '',
    `✅ Активны — ${activeCars.length}`,
    ...activeCars.map(r => `• ${carName(r.car)}`),
    '',
    `⛔ В простое — ${idleCars.length}`,
    ...(idleCars.length ? idleCars.map(idleLine) : ['• нет']),
    '',
    `Всего в работе: ${listed.length}${delistedCount ? ` (снято с листинга: ${delistedCount})` : ''}`,
  ].join('\n')
  const fleetCsv: Cell[][] = [
    ['Авто', 'Номер', 'Статус', 'Причина простоя', 'Простой до'],
    ...fleetRows.map(r => [`${r.car.make} ${r.car.model}`, r.car.plate, r.block ? 'В простое' : 'Активна', r.block?.reason || '', r.block ? (r.block.end_date || 'без даты') : '']),
  ]

  // ── 2. Клеймы ──
  const waiting = claims.filter(c => c.status === 'waiting')
  const inRepair = claims.filter(c => c.status === 'in_repair')
  const doneInMonth = claims.filter(c => {
    if (c.status !== 'done') return false
    const dd = c.completed_date || c.opened_date || c.created_at
    return dd ? isSameMonth(parseISO(dd), month) : false
  })
  const claimLine = (c: Claim, done = false) => {
    if (done) return `• ${carName(c.car)} — завершён ${c.completed_date ? d(c.completed_date) : '—'}`
    const yn = (v: boolean) => (v ? 'да' : 'нет')
    return [
      `• ${carName(c.car)}${c.opened_date ? ` (открыт ${d(c.opened_date)})` : ''}`,
      `    Initial получен: ${yn(c.initial_payment_received)}`,
      `    Supplement получен: ${yn(c.supplement_paid)}`,
    ].join('\n')
  }
  const claimsText = [
    `🛠 Клеймы на ${todayLabel}`,
    '',
    `⏳ Ожидают ремонта — ${waiting.length}`,
    ...(waiting.length ? waiting.map(c => claimLine(c)) : ['• нет']),
    '',
    `🔧 В ремонте — ${inRepair.length}`,
    ...(inRepair.length ? inRepair.map(c => claimLine(c)) : ['• нет']),
    '',
    `✅ Завершены за ${monthLabel} — ${doneInMonth.length}`,
    ...(doneInMonth.length ? doneInMonth.map(c => claimLine(c, true)) : ['• нет']),
  ].join('\n')
  const statusRu: Record<Claim['status'], string> = { waiting: 'Ожидает ремонта', in_repair: 'В ремонте', done: 'Завершён' }
  const claimsCsv: Cell[][] = [
    ['Авто', 'Номер', 'Статус', 'Открыт', 'Завершён', 'Initial payment', 'Supplement', 'Заметки'],
    ...[...waiting, ...inRepair, ...doneInMonth].map(c => [
      c.car ? `${c.car.make} ${c.car.model}` : '—', c.car?.plate || '', statusRu[c.status],
      c.opened_date || '', c.completed_date || '', c.initial_payment_received ? 'да' : 'нет', c.supplement_paid ? 'да' : 'нет', c.notes || '',
    ]),
  ]

  // ── 3. Зарплата работника ──
  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) })
  const payroll = listed.map(car => {
    const carBlocks = blocks.filter(b => b.car_id === car.id)
    const inactive = days.filter(day => carBlocks.some(b => isWithinInterval(day, { start: parseISO(b.start_date), end: blockEnd(b) }))).length
    return { car, inactive, salary: calcSalary(inactive, days.length) }
  })
  const full = payroll.filter(p => p.salary === 150)
  const half = payroll.filter(p => p.salary === 75)
  const zero = payroll.filter(p => p.salary === 0)
  const salaryTotal = payroll.reduce((s, p) => s + p.salary, 0)
  const salaryText = [
    `💵 Зарплата за ${monthLabel}`,
    '',
    ...(full.length ? [`✅ $150 × ${full.length} = $${full.length * 150}`, ...full.map(p => `• ${carName(p.car)}`), ''] : []),
    ...(half.length ? [`🟡 $75 × ${half.length} = $${half.length * 75} (простой 14+ дней)`, ...half.map(p => `• ${carName(p.car)} — простой ${p.inactive} дн.`), ''] : []),
    ...(zero.length ? [`⛔ $0 × ${zero.length} (не работали весь месяц)`, ...zero.map(p => `• ${carName(p.car)}`), ''] : []),
    `Итого: $${salaryTotal}`,
  ].join('\n')
  const salaryCsv: Cell[][] = [
    ['Авто', 'Номер', 'Дней работы', 'Дней простоя', 'Зарплата, $'],
    ...payroll.map(p => [`${p.car.make} ${p.car.model}`, p.car.plate, days.length - p.inactive, p.inactive, p.salary]),
    [],
    ['Итого', '', '', '', salaryTotal],
  ]

  // ── 4. Доходы ──
  const revP = format(month, 'yyyy-MM-01')
  const revRows = rev.accs.map(a => {
    const hasEntry = (id: string) => rev.entries.some(e => e.revenue_car_id === id && e.period === revP)
    const cars = rev.cars.filter(c => c.account === a.key && ((c.added_from <= revP && (!c.sold_from || revP < c.sold_from)) || hasEntry(c.id)))
    const t = cars.reduce((acc, c) => { const r = revCalc(rev.entries.find(e => e.revenue_car_id === c.id && e.period === revP)); return { gross: acc.gross + r.gross, net: acc.net + r.net } }, { gross: 0, net: 0 })
    const active = (a.active_from <= revP && (!a.active_until || revP <= a.active_until)) || cars.some(c => hasEntry(c.id))
    return { a, cars: cars.length, ...t, active }
  }).filter(x => x.active && (x.cars > 0 || x.net !== 0))
  const revExp = rev.exp.find(x => x.period === revP)
  const revExpTotal = num(revExp?.salary1) + num(revExp?.salary2) + (revExp?.items || []).reduce((s, i) => s + num(i.amount), 0)
  const revGross = revRows.reduce((s, x) => s + x.gross, 0)
  const revTotal = revRows.reduce((s, x) => s + x.net, 0)
  const revPays = rev.pays.filter(x => x.period === revP).reduce((s, x) => s + num(x.amount), 0)
  const revProfit = revTotal - revExpTotal - revPays
  const incomeText = [
    `💰 Доходы за ${monthLabel}`,
    '',
    ...(revRows.length ? revRows.map(x => `• ${x.a.label}: ${usd(x.net)}`) : ['• нет данных']),
    '',
    `Gross: ${usd(revGross)}`,
    `Итого по аккаунтам: ${usd(revTotal)}`,
    `Расходы компании: −${usd(Math.abs(revExpTotal))}`,
    `Платежи: −${usd(Math.abs(revPays))}`,
    '',
    `${revProfit >= 0 ? '✅' : '🔻'} Чистая прибыль: ${usd(revProfit)}`,
  ].join('\n')
  const incomeCsv: Cell[][] = [
    ['Аккаунт', 'Машин', 'Gross', 'Итог'],
    ...revRows.map(x => [x.a.label, x.cars, Math.round(x.gross * 100) / 100, Math.round(x.net * 100) / 100] as Cell[]),
    [],
    ['Итого по аккаунтам', '', Math.round(revGross * 100) / 100, Math.round(revTotal * 100) / 100],
    ['Расходы компании', '', '', Math.round(revExpTotal * 100) / 100],
    ['Платежи', '', '', Math.round(revPays * 100) / 100],
    ['Чистая прибыль', '', '', Math.round(revProfit * 100) / 100],
  ]

  const reports: Report[] = [
    {
      key: 'fleet', title: 'Автопарк сегодня', icon: CarIcon, color: 'bg-indigo-50 text-[#4F46E5] dark:text-indigo-300',
      subtitle: `${activeCars.length} активны · ${idleCars.length} в простое`,
      text: fleetText, csv: fleetCsv, file: `avtopark-${format(now, 'yyyy-MM-dd')}.csv`,
    },
    {
      key: 'claims', title: 'Клеймы', icon: ShieldAlert, color: 'bg-indigo-50 text-[#4F46E5] dark:text-indigo-300',
      subtitle: `${waiting.length} ждут · ${inRepair.length} в ремонте · ${doneInMonth.length} завершено`,
      text: claimsText, csv: claimsCsv, file: `kleimy-${format(now, 'yyyy-MM-dd')}.csv`,
    },
    {
      key: 'salary', title: 'Зарплата работника', icon: Users, color: 'bg-indigo-50 text-[#4F46E5] dark:text-indigo-300',
      subtitle: `$${salaryTotal} · ${full.length} × $150 · ${half.length} × $75${zero.length ? ` · ${zero.length} × $0` : ''}`,
      text: salaryText, csv: salaryCsv, file: `zarplata-${format(month, 'yyyy-MM')}.csv`,
    },
    // Без доступа к «Доходам» база не отдаёт аккаунты — отчёт не показываем
    ...(rev.accs.length ? [{
      key: 'income', title: 'Доходы', icon: Wallet, color: 'bg-indigo-50 text-[#4F46E5] dark:text-indigo-300',
      subtitle: `прибыль ${usd(revProfit)} · gross ${usd(revGross)}`,
      text: incomeText, csv: incomeCsv, file: `dohody-${format(month, 'yyyy-MM')}.csv`,
    }] : []),
  ]

  const allText = reports.map(r => r.text).join('\n\n— — —\n\n')
  const isCurrentMonth = isSameMonth(month, now)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Отчёты</h1>
          <p className="text-sm text-gray-400 mt-0.5">Готовые сообщения для Telegram — партнёру или себе</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setMonth(m => subMonths(m, 1))} className="p-2 rounded-lg bg-white border border-gray-200 text-gray-500 hover:bg-gray-50" aria-label="Предыдущий месяц">
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-[130px] text-center text-sm font-semibold text-gray-800 capitalize">{monthLabel}</span>
          <button onClick={() => setMonth(m => addMonths(m, 1))} className="p-2 rounded-lg bg-white border border-gray-200 text-gray-500 hover:bg-gray-50" aria-label="Следующий месяц">
            <ChevronRight size={16} />
          </button>
          {!isCurrentMonth && (
            <button onClick={() => setMonth(startOfMonth(new Date()))} className="text-xs font-medium text-[#4F46E5] hover:underline ml-1">Текущий</button>
          )}
        </div>
      </div>

      {/* All in one */}
      <div className="bg-white rounded-[18px] p-4 border border-gray-100/80 card-shadow flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-[#4F46E5] dark:text-indigo-300 flex items-center justify-center flex-shrink-0">
            <Layers size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">Все отчёты одним сообщением</p>
            <p className="text-xs text-gray-400">Автопарк + клеймы + зарплата + доходы</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => shareText(allText, () => flash('all'))} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-[#229ED9] hover:bg-[#1c8cc2] disabled:opacity-50 text-white text-sm font-medium transition-colors">
            <Send size={15} /> В Telegram
          </button>
          <button onClick={() => copyText(allText, () => flash('all'))} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-white border border-gray-200 hover:bg-gray-100 disabled:opacity-50 text-gray-700 text-sm font-medium transition-colors">
            {copied === 'all' ? <><Check size={15} className="text-green-600" /> Скопировано</> : <><Copy size={15} /> Копировать</>}
          </button>
        </div>
      </div>

      {/* Report cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {reports.map(r => (
          <div key={r.key} className="bg-white rounded-[18px] border border-gray-100/80 card-shadow flex flex-col overflow-hidden">
            <div className="flex items-start gap-3 p-4 pb-3">
              <div className={`w-10 h-10 rounded-xl ${r.color} flex items-center justify-center flex-shrink-0`}>
                <r.icon size={18} />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-bold text-gray-900">{r.title}</h2>
                <p className="text-xs text-gray-500 mt-0.5">{loading ? 'Загрузка…' : r.subtitle}</p>
              </div>
            </div>
            <pre className="mx-4 mb-3 flex-1 max-h-72 overflow-auto rounded-xl bg-gray-50 border border-gray-100 p-3 text-xs leading-relaxed text-gray-700 whitespace-pre-wrap font-sans">
              {loading ? 'Загрузка…' : r.text}
            </pre>
            <div className="flex flex-wrap gap-2 px-4 pb-4">
              <button onClick={() => shareText(r.text, () => flash(r.key))} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-[#229ED9] hover:bg-[#1c8cc2] disabled:opacity-50 text-white text-sm font-medium transition-colors">
                <Send size={15} /> В Telegram
              </button>
              <button onClick={() => copyText(r.text, () => flash(r.key))} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-white border border-gray-200 hover:bg-gray-100 disabled:opacity-50 text-gray-700 text-sm font-medium transition-colors">
                {copied === r.key ? <><Check size={15} className="text-green-600" /> Скопировано</> : <><Copy size={15} /> Копировать</>}
              </button>
              <button onClick={() => downloadCsv(r.csv, r.file)} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-white border border-gray-200 hover:bg-gray-100 disabled:opacity-50 text-gray-700 text-sm font-medium transition-colors">
                <Download size={15} /> Excel
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400">
        «Автопарк» и незавершённые клеймы — на сегодня. Зарплата и завершённые клеймы — за выбранный месяц. На телефоне «В Telegram» открывает меню «Поделиться», на компьютере — копирует текст.
      </p>
    </div>
  )
}

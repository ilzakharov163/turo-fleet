'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { Car as CarIcon, DollarSign, Users, ArrowRight, Plus, Tag, ShieldAlert, CalendarDays, Receipt, Check, ChevronRight, Wrench, FileText, Wallet } from 'lucide-react'
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isWithinInterval, addDays, differenceInCalendarDays, startOfDay, subMonths } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Car } from '@/types'
import { calcSalary, calcEntry, inFleet } from '@/lib/calc'


const STICKER_INTERVAL = 45
const STICKER_WARN = 7

type CarShort = { make: string; model: string; plate: string }

interface RecentExpense {
  id: string
  title: string
  amount: number
  date: string
  car: CarShort | null
}

interface Block {
  car_id: string
  start_date: string
  end_date: string | null
  reason: string | null
}

type Tone = 'red' | 'yellow' | 'blue' | 'green'

interface Attention {
  key: string
  href: string
  tone: Tone
  icon: typeof Tag
  title: string
  detail: string
}

interface IdleCar {
  car: Car
  until: string | null
  reason: string | null
}

const TONES: Record<Tone, { row: string; icon: string; badge: string }> = {
  red: { row: 'hover:bg-red-50/60', icon: 'bg-red-100 text-red-600', badge: 'bg-red-500' },
  yellow: { row: 'hover:bg-yellow-50/60', icon: 'bg-yellow-100 text-yellow-700', badge: 'bg-yellow-400' },
  blue: { row: 'hover:bg-blue-50/60', icon: 'bg-blue-100 text-blue-600', badge: 'bg-blue-500' },
  green: { row: 'hover:bg-green-50/60', icon: 'bg-green-100 text-green-600', badge: 'bg-green-500' },
}

const plate = (c?: CarShort | null) => (c ? `${c.make} ${c.model} ${c.plate}` : '—')

// ── Прибыль (те же формулы, что в «Доходах») ──
interface RevEntry { period: string; gross: number; repair: number; claim_items: { claim: number; supplement: number; pct: number }[] | null; other_items: { amount: number }[] | null }
interface RevExp { period: string; salary1: number; salary2: number; items: { amount: number }[] | null }
const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
const entryNet = (e: RevEntry) => calcEntry(e).net
const usd = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

interface Profit { period: string; value: number; delta: number | null; hasGross: boolean }

export default function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [cars, setCars] = useState<Car[]>([])
  const [monthTotal, setMonthTotal] = useState(0)
  const [unpaidTotal, setUnpaidTotal] = useState(0)
  const [salary, setSalary] = useState({ total: 0, full: 0, half: 0, zero: 0, ded: 0 })
  const [attention, setAttention] = useState<Attention[]>([])
  const [idle, setIdle] = useState<IdleCar[]>([])
  const [recent, setRecent] = useState<RecentExpense[]>([])
  const [profit, setProfit] = useState<Profit | null>(null)
  const [openClaims, setOpenClaims] = useState(0)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const now = new Date()
      const today = startOfDay(now)
      const monthStart = format(startOfMonth(now), 'yyyy-MM-dd')

      loadProfit()

      const [carsRes, monthExpRes, recentRes, blocksRes, stickerCarsRes, stickerChRes, claimsRes, dedRes] = await Promise.all([
        supabase.from('cars').select('*'),
        supabase.from('expenses').select('amount, paid').gte('date', monthStart),
        supabase.from('expenses').select('id, title, amount, date, car:cars(make,model,plate)').order('date', { ascending: false }).order('created_at', { ascending: false }).limit(6),
        supabase.from('car_blocks').select('car_id, start_date, end_date, reason'),
        supabase.from('sticker_cars').select('car_id, car:cars(make,model,plate)'),
        supabase.from('sticker_changes').select('car_id, changed_date').order('changed_date', { ascending: false }),
        supabase.from('claims').select('id, status'),
        supabase.from('salary_deductions').select('amount').gte('date', monthStart),
      ])

      const allCars: Car[] = carsRes.data || []
      const listed = allCars.filter(c => inFleet(c, monthStart))
      const blocks: Block[] = (blocksRes.data as Block[]) || []
      const blockEnd = (b: Block) => (b.end_date ? parseISO(b.end_date) : new Date(9999, 0))

      // ── Зарплата работника (как в календаре) ──
      const days = eachDayOfInterval({ start: startOfMonth(now), end: endOfMonth(now) })
      const sal = { total: 0, full: 0, half: 0, zero: 0, ded: ((dedRes.data || []) as { amount: number }[]).reduce((t, d) => t + Number(d.amount), 0) }
      for (const car of listed) {
        const carBlocks = blocks.filter(b => b.car_id === car.id)
        const inactive = days.filter(d => carBlocks.some(b => isWithinInterval(d, { start: parseISO(b.start_date), end: blockEnd(b) }))).length
        const s = calcSalary(inactive, days.length)
        sal.total += s
        if (s === 150) sal.full++
        else if (s === 75) sal.half++
        else sal.zero++
      }

      // ── Расходы за месяц ──
      const monthExp = (monthExpRes.data || []) as { amount: number; paid: boolean | null }[]
      const total = monthExp.reduce((s, e) => s + Number(e.amount), 0)
      const unpaid = monthExp.filter(e => !e.paid)
      const unpaidSum = unpaid.reduce((s, e) => s + Number(e.amount), 0)

      // ── Сейчас в простое ──
      const idleNow: IdleCar[] = []
      for (const car of listed) {
        const b = blocks.find(x => x.car_id === car.id && isWithinInterval(today, { start: parseISO(x.start_date), end: blockEnd(x) }))
        if (b) idleNow.push({ car, until: b.end_date, reason: b.reason })
      }
      idleNow.sort((a, b) => (a.until ?? '9999').localeCompare(b.until ?? '9999'))

      // ── Требует внимания ──
      const items: Attention[] = []

      const stickerCars = (stickerCarsRes.data || []) as unknown as { car_id: string; car: CarShort | null }[]
      const changes = (stickerChRes.data || []) as { car_id: string; changed_date: string }[]
      const stickerRows = stickerCars.map(sc => {
        const last = changes.find(ch => ch.car_id === sc.car_id)?.changed_date
        const left = last ? differenceInCalendarDays(addDays(parseISO(last), STICKER_INTERVAL), now) : -1
        return { ...sc, left }
      })
      const due = stickerRows.filter(r => r.left <= 0)
      const soon = stickerRows.filter(r => r.left > 0 && r.left <= STICKER_WARN).sort((a, b) => a.left - b.left)
      if (due.length) {
        items.push({
          key: 'stickers-due', href: '/cars?tab=stickers', tone: 'red', icon: Tag,
          title: `Наклейки: пора менять — ${due.length}`,
          detail: due.slice(0, 3).map(r => plate(r.car)).join(', ') + (due.length > 3 ? ` и ещё ${due.length - 3}` : ''),
        })
      }
      if (soon.length) {
        items.push({
          key: 'stickers-soon', href: '/cars?tab=stickers', tone: 'yellow', icon: Tag,
          title: `Наклейки: скоро менять — ${soon.length}`,
          detail: `Ближайшая через ${soon[0].left} дн. · ${plate(soon[0].car)}`,
        })
      }

      const claims = (claimsRes.data || []) as { status: string }[]
      const waiting = claims.filter(c => c.status === 'waiting').length
      const inRepair = claims.filter(c => c.status === 'in_repair').length
      if (waiting) {
        items.push({ key: 'claims-wait', href: '/cars?tab=claims', tone: 'yellow', icon: ShieldAlert, title: `Клеймы ждут ремонта — ${waiting}`, detail: 'Нужно отправить в ремонт' })
      }
      if (inRepair) {
        items.push({ key: 'claims-repair', href: '/cars?tab=claims', tone: 'blue', icon: Wrench, title: `В ремонте — ${inRepair}`, detail: 'Проверь статус у мастера' })
      }
      if (unpaidSum > 0) {
        items.push({
          key: 'unpaid', href: '/expenses', tone: 'yellow', icon: Receipt,
          title: `Не оплачено расходов — $${unpaidSum.toFixed(2)}`,
          detail: `${unpaid.length} ${unpaid.length === 1 ? 'запись' : 'записей'} за ${format(now, 'LLLL', { locale: ru })}`,
        })
      }

      setCars(allCars)
      setMonthTotal(total)
      setUnpaidTotal(unpaidSum)
      setSalary(sal)
      setIdle(idleNow)
      setAttention(items)
      setOpenClaims(waiting + inRepair)
      setRecent((recentRes.data || []) as unknown as RecentExpense[])
      setLoading(false)
    }

    // ── Прибыль за текущий месяц ──
    async function loadProfit() {
      const supabase = createClient()
      // Видят только те, у кого есть доступ к «Доходам» (как в Sidebar)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: prof } = await supabase.from('profiles').select('role, permissions').eq('id', user.id).single()
      const role = (prof?.role ?? 'admin') as string
      if (role !== 'admin' && !((prof?.permissions as string[] | null) ?? []).includes('/income')) return

      const [entRes, expRes, payRes, dedRes2] = await Promise.all([
        supabase.from('revenue_entries').select('period, gross, repair, claim_items, other_items'),
        supabase.from('revenue_month_expenses').select('period, salary1, salary2, items'),
        supabase.from('revenue_payments').select('period, amount'),
        supabase.from('salary_deductions').select('date, amount'),
      ])
      const entries = (entRes.data || []) as RevEntry[]
      const exps = (expRes.data || []) as RevExp[]
      const pays = (payRes.data || []) as { period: string; amount: number }[]
      const deds = (dedRes2.data || []) as { date: string; amount: number }[]

      const period = format(new Date(), 'yyyy-MM-01')

      const monthProfit = (p: string) => {
        const net = entries.filter(e => e.period === p).reduce((s, e) => s + entryNet(e), 0)
        const m = exps.find(x => x.period === p)
        const exp = num(m?.salary1) + num(m?.salary2) + (m?.items || []).reduce((s, i) => s + num(i.amount), 0)
        const pay = pays.filter(x => x.period === p).reduce((s, x) => s + num(x.amount), 0)
        // Штрафы/вычеты уменьшают затраты на сотрудника
        const ded = deds.filter(x => x.date.startsWith(p.slice(0, 7))).reduce((s, x) => s + num(x.amount), 0)
        return { value: net - exp + ded - pay, has: entries.some(e => e.period === p) || exp > 0 || pay > 0 || ded > 0 }
      }
      const cur = monthProfit(period)
      const prev = monthProfit(format(subMonths(parseISO(period), 1), 'yyyy-MM-01'))
      const hasGross = entries.some(e => e.period === period && num(e.gross) > 0)
      setProfit({ period, value: cur.value, delta: prev.has ? cur.value - prev.value : null, hasGross })
    }

    load()
  }, [])

  const listed = cars.filter(c => inFleet(c, format(startOfMonth(new Date()), 'yyyy-MM-dd')))
  const activeCount = listed.length - idle.length
  const monthName = format(new Date(), 'LLLL', { locale: ru })

  const profitMonth = profit ? format(parseISO(profit.period), 'LLLL', { locale: ru }) : ''
  const prevMonth = profit ? format(subMonths(parseISO(profit.period), 1), 'LLLL', { locale: ru }) : ''

  const statCards = [
    ...(profit ? [{
      label: `Прибыль · ${profitMonth}`,
      value: usd(profit.value),
      negative: profit.value < 0,
      sub: !profit.hasGross ? 'Gross за месяц ещё не внесён' : profit.delta === null ? 'Чистая прибыль за месяц' : `${profit.delta >= 0 ? '+' : ''}${usd(profit.delta)} к ${/[ьй]$/.test(prevMonth) ? prevMonth.slice(0, -1) + 'ю' : prevMonth + 'у'}`,
      href: '/income',
      icon: Wallet,
      tint: profit.value < 0 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600',
      wide: true,
    }] : []),
    {
      label: 'В работе',
      value: activeCount,
      sub: `Из ${listed.length} · ${idle.length ? `в простое ${idle.length}` : 'все работают'}`,
      href: '/cars',
      icon: CarIcon,
      tint: 'bg-indigo-50 text-[#4F46E5] dark:text-indigo-300',
    },
    {
      label: 'Расходы',
      value: `$${monthTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
      sub: unpaidTotal > 0 ? `За ${monthName}, не оплачено $${unpaidTotal.toFixed(0)}` : `За ${monthName}, всё оплачено`,
      href: '/expenses',
      icon: DollarSign,
      tint: 'bg-indigo-50 text-[#4F46E5] dark:text-indigo-300',
    },
    {
      label: 'Зарплата',
      value: `$${(salary.total - salary.ded).toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
      sub: salary.ded ? `$${salary.total.toLocaleString('en-US')} − вычеты $${salary.ded.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : `${salary.full} × $150 · ${salary.half} × $75${salary.zero ? ` · ${salary.zero} × $0` : ''}`,
      href: '/cars?tab=downtime',
      icon: Users,
      tint: 'bg-indigo-50 text-[#4F46E5] dark:text-indigo-300',
    },
    {
      label: 'Клеймы',
      value: openClaims,
      sub: openClaims ? 'Открыто сейчас' : 'Открытых нет',
      href: '/cars?tab=claims',
      icon: ShieldAlert,
      tint: 'bg-indigo-50 text-[#4F46E5] dark:text-indigo-300',
    },
  ]

  const quickActions = [
    { label: 'Добавить расход', href: '/expenses', icon: Plus },
    { label: 'Отметить простой', href: '/cars?tab=downtime', icon: CalendarDays },
    { label: 'Новый клейм', href: '/cars?tab=claims', icon: ShieldAlert },
    { label: 'Наклейки', href: '/cars?tab=stickers', icon: Tag },
    { label: 'Отчёты в Telegram', href: '/reports', icon: FileText },
  ]

  return (
    <div className="space-y-5">
      {/* Показатели — одна строка; на телефоне прибыль сверху, остальное 2×2 */}
      <div className={`bg-white rounded-[18px] border border-gray-100/80 card-shadow overflow-hidden grid grid-cols-2 ${profit ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
        {statCards.map((card, idx) => (
          <Link
            key={card.label}
            href={card.href}
            className={`group relative p-4 sm:p-5 hover:bg-gray-50/70 transition-colors
              ${'wide' in card ? 'col-span-2 lg:col-span-1 border-b lg:border-b-0' : ''}
              ${idx > 0 ? 'lg:border-l border-gray-100' : ''}
              ${'wide' in card ? '' : (statCards.indexOf(card) - (profit ? 1 : 0)) % 2 === 1 ? 'border-l border-gray-100 lg:border-l' : ''}
              ${'wide' in card ? '' : (statCards.indexOf(card) - (profit ? 1 : 0)) < 2 ? 'border-b border-gray-100 lg:border-b-0' : ''}`}
          >
            <p className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
              <card.icon size={14} className="text-gray-400" />
              <span className="truncate">{card.label}</span>
              <ChevronRight size={13} className="ml-auto flex-shrink-0 text-gray-300 group-hover:text-gray-500 transition-colors" />
            </p>
            <p className={`mt-1.5 text-2xl font-bold tracking-tight tabular-nums whitespace-nowrap ${'negative' in card && card.negative ? 'text-red-600' : 'text-gray-900'}`}>
              {loading ? <span className="skeleton block h-7 w-20" /> : card.value}
            </p>
            <p className="mt-1 text-xs text-gray-400 line-clamp-2">{loading ? '' : card.sub}</p>
          </Link>
        ))}
      </div>

      {/* Quick actions */}
      <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
        {quickActions.map(a => (
          <Link
            key={a.label}
            href={a.href}
            className="flex-shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors"
          >
            <a.icon size={16} className="text-[#4F46E5]" />
            {a.label}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Требует внимания */}
        <div className="bg-white rounded-[18px] border border-gray-100/80 card-shadow overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <h2 className="text-base font-bold text-gray-900">Требует внимания</h2>
            {!loading && attention.length > 0 && (
              <span className="text-xs font-semibold text-white bg-red-500 rounded-full px-2 py-0.5">{attention.length}</span>
            )}
          </div>
          {loading ? (
            <div className="px-5 pb-5 space-y-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-10" />)}</div>
          ) : attention.length === 0 ? (
            <div className="px-5 pb-6 flex items-center gap-3">
              <span className="w-9 h-9 rounded-xl bg-green-100 text-green-600 flex items-center justify-center"><Check size={18} /></span>
              <div>
                <p className="text-sm font-semibold text-gray-800">Всё в порядке</p>
                <p className="text-xs text-gray-400">Наклейки, клеймы и расходы без срочных дел</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 pb-2">
              {attention.map(a => {
                const t = TONES[a.tone]
                return (
                  <Link key={a.key} href={a.href} className={`flex items-center gap-3 px-5 py-3 transition-colors ${t.row}`}>
                    <span className={`w-9 h-9 flex-shrink-0 rounded-xl flex items-center justify-center ${t.icon}`}>
                      <a.icon size={17} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800">{a.title}</p>
                      <p className="text-xs text-gray-500 truncate">{a.detail}</p>
                    </div>
                    <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Сейчас в простое */}
        <div className="bg-white rounded-[18px] border border-gray-100/80 card-shadow overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <h2 className="text-base font-bold text-gray-900">
              Сейчас в простое {!loading && <span className="text-gray-400 font-medium">· {idle.length}</span>}
            </h2>
            <Link href="/cars?tab=downtime" className="text-sm text-[#4F46E5] dark:text-indigo-300 hover:underline underline-offset-2 flex items-center gap-1 font-medium">
              Простои <ArrowRight size={14} />
            </Link>
          </div>
          {loading ? (
            <div className="px-5 pb-5 space-y-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-10" />)}</div>
          ) : idle.length === 0 ? (
            <div className="px-5 pb-6 text-sm text-gray-500">Все машины сегодня в работе</div>
          ) : (
            <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto pb-2">
              {idle.map(({ car, until, reason }) => (
                <Link key={car.id} href="/cars?tab=downtime" className="flex items-center gap-3 px-5 py-2.5 hover:bg-gray-50 transition-colors">
                  <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">
                      {car.make} {car.model} <span className="font-semibold">{car.plate}</span>
                    </p>
                    {reason && <p className="text-xs text-gray-400 truncate">{reason}</p>}
                  </div>
                  <span className="text-xs text-gray-500 flex-shrink-0">
                    {until ? `до ${format(parseISO(until), 'd MMM', { locale: ru })}` : 'без даты'}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Последние расходы */}
      <div className="bg-white rounded-[18px] border border-gray-100/80 overflow-hidden card-shadow">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Последние расходы</h2>
          <Link href="/expenses" className="text-sm text-[#4F46E5] dark:text-indigo-300 hover:underline underline-offset-2 flex items-center gap-1 font-medium">
            Все расходы <ArrowRight size={14} />
          </Link>
        </div>
        {loading ? (
          <div className="p-5 space-y-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-10" />)}</div>
        ) : recent.length === 0 ? (
          <div className="px-5 py-8 text-center text-gray-400 text-sm">Расходов пока нет</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {recent.map(e => (
              <Link key={e.id} href="/expenses" className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                <div className="w-14 flex-shrink-0 text-xs text-gray-400 tabular-nums">{format(parseISO(e.date), 'd MMM', { locale: ru })}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{e.title}</p>
                  <p className="text-xs text-gray-400 truncate">{e.car ? plate(e.car) : 'Без авто'}</p>
                </div>
                <span className="text-sm font-bold text-gray-900 tabular-nums">${Number(e.amount).toFixed(2)}</span>
              </Link>
            ))}
          </div>
        )}
        <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-400">
          За {monthName}: <span className="font-semibold text-gray-700">${monthTotal.toFixed(2)}</span>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { Car as CarIcon, DollarSign, Users, TrendingUp, Clock, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isWithinInterval } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Car } from '@/types'

interface Stats {
  total: number
  active: number
  inactive: number
  monthExpenses: number
  operatorSalary: number
}

interface RecentExpense {
  id: string
  title: string
  amount: number
  date: string
  car: { make: string; model: string; plate: string } | null
}

const DONUT_COLORS = ['#22C55E', '#F59E0B', '#EF4444', '#E5E7EB']

function calcSalary(activeDays: number): number {
  const weeks = activeDays / 7
  if (weeks >= 3) return 150
  if (weeks >= 2) return 75
  return 0
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, inactive: 0, monthExpenses: 0, operatorSalary: 0 })
  const [recentExpenses, setRecentExpenses] = useState<RecentExpense[]>([])
  const [salaryPayments, setSalaryPayments] = useState<{ id: string; amount: number; period: string; created_at: string }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]

      const [carsRes, expensesRes, recentRes, blocksRes, payRes] = await Promise.all([
        supabase.from('cars').select('*'),
        supabase.from('expenses').select('amount').gte('date', monthStart),
        supabase.from('expenses').select('id, title, amount, date, car:cars(make,model,plate)').order('date', { ascending: false }).limit(5),
        supabase.from('car_blocks').select('car_id, start_date, end_date'),
        supabase.from('salary_payments').select('id, amount, period, created_at').gte('created_at', monthStart).order('created_at', { ascending: false }),
      ])

      const cars: Car[] = carsRes.data || []
      const expenses = expensesRes.data || []
      const blocks = blocksRes.data || []

      // Calculate operator salary for current month
      const mStart = startOfMonth(now)
      const mEnd = endOfMonth(now)
      const daysInMonth = eachDayOfInterval({ start: mStart, end: mEnd })

      let totalSalary = 0
      for (const car of cars.filter(c => !c.delisted)) {
        const activeDays = daysInMonth.filter(day => {
          return !blocks.some(b => {
            if (b.car_id !== car.id) return false
            const bStart = parseISO(b.start_date)
            const bEnd = b.end_date ? parseISO(b.end_date) : now
            return isWithinInterval(day, { start: bStart, end: bEnd })
          })
        }).length
        totalSalary += calcSalary(activeDays)
      }

      setStats({
        total: cars.length,
        active: cars.filter(c => c.status === 'active').length,
        inactive: cars.filter(c => c.status === 'inactive').length,
        monthExpenses: expenses.reduce((s, e) => s + Number(e.amount), 0),
        operatorSalary: totalSalary,
      })

      const raw = (recentRes.data || []) as unknown as RecentExpense[]
      setRecentExpenses(raw)
      setSalaryPayments(payRes.data || [])
      setLoading(false)
    }
    load()
  }, [])

  const donutData = [
    { name: 'Активны', value: stats.active },
    { name: 'Неактивны', value: stats.inactive },
    { name: 'Без данных', value: Math.max(0, stats.total - stats.active - stats.inactive) },
  ].filter(d => d.value > 0)

  const statCards = [
    {
      label: 'Автомобили',
      value: stats.total,
      sub: 'Всего в парке',
      icon: CarIcon,
      gradient: 'from-[#3B82F6] to-[#2563EB]',
      shadow: 'shadow-blue-200',
    },
    {
      label: 'Расходы за месяц',
      value: `$${stats.monthExpenses.toLocaleString('ru-RU')}`,
      sub: 'Текущий месяц',
      icon: DollarSign,
      gradient: 'from-[#8B5CF6] to-[#7C3AED]',
      shadow: 'shadow-purple-200',
    },
    {
      label: 'Зарплата операторов',
      value: `$${stats.operatorSalary}`,
      sub: 'Текущий месяц',
      icon: Users,
      gradient: 'from-[#10B981] to-[#059669]',
      shadow: 'shadow-emerald-200',
    },
    {
      label: 'Активных',
      value: stats.active,
      sub: `Неактивных: ${stats.inactive}`,
      icon: TrendingUp,
      gradient: 'from-[#F59E0B] to-[#D97706]',
      shadow: 'shadow-amber-200',
    },
  ]

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {statCards.map(card => (
          <div key={card.label} className="bg-white rounded-[18px] p-5 border border-gray-100/80 card-shadow">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-sm text-gray-500 font-medium">{card.label}</p>
                <p className="text-3xl font-bold text-gray-900 mt-1 tracking-tight">{loading ? '—' : card.value}</p>
              </div>
              <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${card.gradient} flex items-center justify-center shadow-lg ${card.shadow}`}>
                <card.icon size={22} className="text-white" strokeWidth={2} />
              </div>
            </div>
            <p className="text-xs text-gray-400">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Middle row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Donut chart */}
        <div className="bg-white rounded-[18px] p-6 border border-gray-100/80 card-shadow">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-gray-900">Статус автомобилей</h2>
            <Link href="/cars" className="text-sm text-blue-500 hover:text-blue-700 flex items-center gap-1 font-medium">
              Все авто <ArrowRight size={14} />
            </Link>
          </div>
          {loading ? (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">Загрузка...</div>
          ) : (
            <div className="flex items-center gap-6">
              <div className="relative w-44 h-44 flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={donutData.length ? donutData : [{ name: 'Нет данных', value: 1 }]} cx="50%" cy="50%" innerRadius={52} outerRadius={72} paddingAngle={3} dataKey="value" strokeWidth={0}>
                      {(donutData.length ? donutData : [{ name: 'Нет данных', value: 1 }]).map((_, i) => (
                        <Cell key={i} fill={donutData.length ? DONUT_COLORS[i] : '#E5E7EB'} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-2xl font-bold text-gray-900">{stats.total}</span>
                  <span className="text-xs text-gray-400">Всего</span>
                </div>
              </div>
              <div className="space-y-3 flex-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-[#22C55E]" />
                    <span className="text-sm text-gray-600">Активны</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold text-gray-900">{stats.active}</span>
                    <span className="text-xs text-gray-400 ml-1">({stats.total ? Math.round(stats.active / stats.total * 100) : 0}%)</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-[#EF4444]" />
                    <span className="text-sm text-gray-600">Неактивны</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold text-gray-900">{stats.inactive}</span>
                    <span className="text-xs text-gray-400 ml-1">({stats.total ? Math.round(stats.inactive / stats.total * 100) : 0}%)</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Salary breakdown */}
        <div className="bg-white rounded-[18px] p-6 border border-gray-100/80 card-shadow">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-gray-900">Зарплата операторов</h2>
            <Link href="/calendar" className="text-sm text-blue-500 hover:text-blue-700 flex items-center gap-1 font-medium">
              Календарь <ArrowRight size={14} />
            </Link>
          </div>
          {(() => {
            const paid = salaryPayments.reduce((s, p) => s + Number(p.amount), 0)
            const remaining = stats.operatorSalary - paid
            return (
              <>
                <div className="flex gap-3 mb-4">
                  <div className="flex-1 bg-gray-50 rounded-xl p-3 text-center">
                    <p className="text-xl font-bold text-gray-900">${stats.operatorSalary}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">Заработано</p>
                  </div>
                  <div className="flex-1 bg-emerald-50 rounded-xl p-3 text-center">
                    <p className="text-xl font-bold text-emerald-600">${paid.toFixed(0)}</p>
                    <p className="text-[11px] text-emerald-500 mt-0.5">Выплачено</p>
                  </div>
                  <div className="flex-1 bg-rose-50 rounded-xl p-3 text-center">
                    <p className="text-xl font-bold text-rose-400">${remaining.toFixed(0)}</p>
                    <p className="text-[11px] text-rose-400 mt-0.5">Остаток</p>
                  </div>
                </div>
                {salaryPayments.length > 0 && (
                  <div className="border border-gray-100 rounded-xl divide-y divide-gray-50 max-h-40 overflow-y-auto">
                    {salaryPayments.map(p => (
                      <div key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span className="text-gray-500">{p.period || '—'}</span>
                        <span className="font-semibold text-gray-900">${Number(p.amount).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )
          })()}
        </div>
      </div>

      {/* Recent expenses */}
      <div className="bg-white rounded-[18px] border border-gray-100/80 overflow-hidden card-shadow">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Последние расходы</h2>
          <Link href="/expenses" className="text-sm text-blue-500 hover:text-blue-700 flex items-center gap-1 font-medium">
            Все расходы <ArrowRight size={14} />
          </Link>
        </div>
        {loading ? (
          <div className="px-6 py-8 text-center text-gray-400 text-sm">Загрузка...</div>
        ) : recentExpenses.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-400 text-sm">Расходов пока нет</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 uppercase tracking-wider bg-gray-50/60">
                <th className="px-6 py-3 font-medium">Дата</th>
                <th className="px-6 py-3 font-medium">Авто</th>
                <th className="px-6 py-3 font-medium">Статья</th>
                <th className="px-6 py-3 font-medium text-right">Сумма</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {recentExpenses.map(e => (
                <tr key={e.id} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-6 py-3.5 text-gray-500">
                    <div className="flex items-center gap-2">
                      <Clock size={13} className="text-gray-300" />
                      {format(parseISO(e.date), 'dd MMM yyyy', { locale: ru })}
                    </div>
                  </td>
                  <td className="px-6 py-3.5">
                    {e.car ? (
                      <span className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 px-2.5 py-1 rounded-lg text-xs font-medium">
                        <CarIcon size={11} />
                        {e.car.make} {e.car.model} {e.car.plate}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-6 py-3.5 font-medium text-gray-800">{e.title}</td>
                  <td className="px-6 py-3.5 text-right">
                    <span className="font-bold text-gray-900">${Number(e.amount).toFixed(2)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

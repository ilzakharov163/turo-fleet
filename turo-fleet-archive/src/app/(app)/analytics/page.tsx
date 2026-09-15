'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { Car } from '@/types'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line
} from 'recharts'
import { format, subMonths, startOfMonth, endOfMonth, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import Select from '@/components/ui/Select'

export default function AnalyticsPage() {
  const [cars, setCars] = useState<Car[]>([])
  const [allExpenses, setAllExpenses] = useState<{ title: string; amount: number; date: string; car_id: string }[]>([])
  const [filterCar, setFilterCar] = useState('')
  const [filterMonth, setFilterMonth] = useState('')
  const [filterTitle, setFilterTitle] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: carsData } = await supabase.from('cars').select('*').order('make')
      setCars(carsData || [])
      const { data: expData } = await supabase.from('expenses').select('title, amount, date, car_id')
      setAllExpenses(expData || [])
      setLoading(false)
    }
    load()
  }, [])

  // Months list (last 12)
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = subMonths(new Date(), 11 - i)
    return { value: format(d, 'yyyy-MM'), label: format(d, 'LLL yyyy', { locale: ru }) }
  })

  // Unique titles
  const titles = Array.from(new Set(allExpenses.map(e => e.title))).sort()

  // Apply filters
  const filtered = allExpenses.filter(e => {
    if (filterCar && e.car_id !== filterCar) return false
    if (filterMonth && !e.date.startsWith(filterMonth)) return false
    if (filterTitle && e.title !== filterTitle) return false
    return true
  })

  // Monthly chart data
  const monthlyData = months.map(m => ({
    month: m.label,
    amount: allExpenses.filter(e => {
      if (filterCar && e.car_id !== filterCar) return false
      if (filterTitle && e.title !== filterTitle) return false
      return e.date.startsWith(m.value)
    }).reduce((s, e) => s + Number(e.amount), 0),
  }))

  // Per car
  const carData = cars.map(car => ({
    name: `${car.make} ${car.model}`,
    amount: filtered.filter(e => e.car_id === car.id).reduce((s, e) => s + Number(e.amount), 0),
  })).filter(r => r.amount > 0).sort((a, b) => b.amount - a.amount)

  // Top items
  const grouped: Record<string, { total: number; count: number }> = {}
  filtered.forEach(e => {
    if (!grouped[e.title]) grouped[e.title] = { total: 0, count: 0 }
    grouped[e.title].total += Number(e.amount)
    grouped[e.title].count++
  })
  const topItems = Object.entries(grouped).map(([title, v]) => ({ title, ...v })).sort((a, b) => b.total - a.total).slice(0, 10)

  const totalAll = filtered.reduce((s, e) => s + Number(e.amount), 0)

  return (
    <div className="p-8">
      {/* Filters */}
      <div className="flex items-center gap-3 mb-8 flex-wrap">
        <Select
          value={filterMonth}
          onChange={setFilterMonth}
          options={[{ value: '', label: 'Все месяцы' }, ...months.map(m => ({ value: m.value, label: m.label }))]}
        />
        <Select
          value={filterCar}
          onChange={setFilterCar}
          options={[{ value: '', label: 'Все авто' }, ...cars.map(c => ({ value: c.id, label: `${c.make} ${c.model}` }))]}
        />
        <Select
          value={filterTitle}
          onChange={setFilterTitle}
          options={[{ value: '', label: 'Все статьи' }, ...titles.map(t => ({ value: t, label: t }))]}
        />
        {(filterMonth || filterCar || filterTitle) && (
          <button
            onClick={() => { setFilterMonth(''); setFilterCar(''); setFilterTitle('') }}
            className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-[10px] bg-white hover:bg-gray-50 transition-colors"
          >
            Сбросить
          </button>
        )}
      </div>

      {loading ? <div className="text-gray-400">Загрузка...</div> : (
        <div className="space-y-8">
          {/* Summary card */}
          <div className="bg-white rounded-[18px] p-6 card-shadow border border-gray-100/80">
            <p className="text-sm text-gray-500">
              {filterMonth ? `Расходы за ${months.find(m => m.value === filterMonth)?.label}` : 'Всего расходов за 12 месяцев'}
              {filterTitle ? ` · ${filterTitle}` : ''}
            </p>
            <p className="text-3xl font-bold text-gray-900 mt-1">${totalAll.toFixed(2)}</p>
          </div>

          {/* Monthly chart — скрываем если выбран конкретный месяц */}
          {!filterMonth && (
            <div className="bg-white rounded-[18px] p-6 card-shadow border border-gray-100/80">
              <h2 className="text-base font-semibold mb-6">Расходы по месяцам</h2>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `$${v}`} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null
                      return (
                        <div style={{ background: '#fff', borderRadius: 12, padding: '8px 14px', border: '1px solid rgba(17,17,26,0.06)' }}>
                          <p style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 2 }}>{label}</p>
                          <p style={{ fontSize: 16, fontWeight: 700, color: '#111827', lineHeight: 1 }}>${Number(payload[0].value).toFixed(2)}</p>
                        </div>
                      )
                    }}
                  />
                  <Line type="monotone" dataKey="amount" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Per car chart */}
          {carData.length > 0 && (
            <div className="bg-white rounded-[18px] p-6 card-shadow border border-gray-100/80">
              <h2 className="text-base font-semibold mb-6">Расходы по авто</h2>
              <ResponsiveContainer width="100%" height={Math.max(260, carData.length * 40)}>
                <BarChart data={carData} layout="vertical" barCategoryGap={8}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={v => `$${v}`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={160} interval={0} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null
                      return (
                        <div style={{ background: '#fff', borderRadius: 12, padding: '8px 14px', border: '1px solid rgba(17,17,26,0.06)' }}>
                          <p style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 2 }}>{label}</p>
                          <p style={{ fontSize: 16, fontWeight: 700, color: '#111827', lineHeight: 1 }}>${Number(payload[0].value).toFixed(2)}</p>
                        </div>
                      )
                    }}
                  />
                  <Bar dataKey="amount" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Top items */}
          {topItems.length > 0 && (
            <div className="bg-white rounded-[18px] p-6 card-shadow border border-gray-100/80">
              <h2 className="text-base font-semibold mb-4">Топ статей расходов</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b">
                    <th className="pb-3 font-medium">Статья</th>
                    <th className="pb-3 font-medium text-center">Кол-во</th>
                    <th className="pb-3 font-medium text-right">Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {topItems.map((item, i) => (
                    <tr key={i} className="border-b last:border-0 cursor-pointer hover:bg-gray-50"
                      onClick={() => setFilterTitle(filterTitle === item.title ? '' : item.title)}>
                      <td className={`py-3 ${filterTitle === item.title ? 'text-[#4F46E5] font-semibold' : ''}`}>{item.title}</td>
                      <td className="py-3 text-center text-gray-500">{item.count}</td>
                      <td className="py-3 text-right font-semibold">${item.total.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

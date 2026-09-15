'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { log } from '@/lib/logger'
import { Car, CarBlock } from '@/types'
import { ChevronLeft, ChevronRight, Plus, X, Trash2 } from 'lucide-react'
import {
  startOfMonth, endOfMonth, eachDayOfInterval, format, isSameMonth,
  addMonths, subMonths, parseISO, isWithinInterval, differenceInDays,
  startOfWeek, endOfWeek, isToday
} from 'date-fns'
import { ru } from 'date-fns/locale'
import DatePicker from '@/components/ui/DatePicker'

interface PayrollRow {
  car: Car
  activeWeeks: number
  salary: number
}

function calcSalary(activeWeeks: number): number {
  if (activeWeeks >= 3) return 150
  if (activeWeeks === 2) return 75
  return 0
}

export default function CalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [ownerTab, setOwnerTab] = useState<'main' | 'ilya'>('main')
  const [cars, setCars] = useState<Car[]>([])
  const [blocks, setBlocks] = useState<CarBlock[]>([])
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ car_id: '', start_date: '', end_date: '', reason: '' })
  const [editBlock, setEditBlock] = useState<CarBlock | null>(null)

  // Зарплата (ручные выплаты)
  const [payments, setPayments] = useState<{ id: string; amount: number; period: string; owner_group: string }[]>([])
  const [payAmount, setPayAmount] = useState('')
  const [payStart, setPayStart] = useState('')
  const [payEnd, setPayEnd] = useState('')

  const load = useCallback(async () => {
    const supabase = createClient()
    const [carsRes, blocksRes, payRes] = await Promise.all([
      supabase.from('cars').select('*').order('make'),
      supabase.from('car_blocks').select('*, car:cars(*)'),
      supabase.from('salary_payments').select('id, amount, period, owner_group').order('created_at', { ascending: false }),
    ])
    setCars(carsRes.data || [])
    setBlocks(blocksRes.data as CarBlock[] || [])
    setPayments(payRes.data || [])
  }, [])

  async function addPayment(e: React.FormEvent) {
    e.preventDefault()
    if (!payAmount) return
    let period: string | null = null
    if (payStart && payEnd) period = `${format(parseISO(payStart), 'd MMM', { locale: ru })} – ${format(parseISO(payEnd), 'd MMM yyyy', { locale: ru })}`
    else if (payStart) period = format(parseISO(payStart), 'd MMM yyyy', { locale: ru })
    const supabase = createClient()
    const { data } = await supabase.from('salary_payments').insert({ amount: parseFloat(payAmount), period, owner_group: ownerTab }).select().single()
    if (data) await log('create', 'salary', data.id, { amount: parseFloat(payAmount), period: period || '', owner_group: ownerTab })
    setPayAmount(''); setPayStart(''); setPayEnd('')
    load()
  }

  async function deletePayment(id: string) {
    const supabase = createClient()
    const p = payments.find(x => x.id === id)
    await supabase.from('salary_payments').delete().eq('id', id)
    await log('delete', 'salary', id, { amount: p?.amount, period: p?.period || '' })
    load()
  }

  useEffect(() => { load() }, [load])

  const days = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) })

  function isBlocked(carId: string, day: Date): CarBlock | undefined {
    return blocks.find(b => {
      if (b.car_id !== carId) return false
      const start = parseISO(b.start_date)
      // open-ended block (no end_date) = blocked until today
      const end = b.end_date ? parseISO(b.end_date) : new Date()
      return isWithinInterval(day, { start, end })
    })
  }

  function calcPayroll(): PayrollRow[] {
    const monthStart = startOfMonth(currentMonth)
    const monthEnd = endOfMonth(currentMonth)
    const totalDays = differenceInDays(monthEnd, monthStart) + 1

    return cars.map(car => {
      // Считаем активные дни — дни месяца не покрытые блокировкой
      let inactiveDays = 0
      days.forEach(day => { if (isBlocked(car.id, day)) inactiveDays++ })
      const activeDays = totalDays - inactiveDays
      const activeWeeks = Math.floor(activeDays / 7)
      return { car, activeWeeks, salary: calcSalary(activeWeeks) }
    })
  }

  async function handleSaveBlock(e: React.FormEvent) {
    e.preventDefault()
    const supabase = createClient()
    if (editBlock) {
      await supabase.from('car_blocks').update({ ...form, car_id: form.car_id }).eq('id', editBlock.id)
      await log('update', 'car_block', editBlock.id, form)
    } else {
      const { data } = await supabase.from('car_blocks').insert(form).select().single()
      if (data) await log('create', 'car_block', data.id, form)
    }
    setShowModal(false)
    setEditBlock(null)
    setForm({ car_id: '', start_date: '', end_date: '', reason: '' })
    load()
  }

  async function handleDeleteBlock(block: CarBlock) {
    const supabase = createClient()
    await supabase.from('car_blocks').delete().eq('id', block.id)
    await log('delete', 'car_block', block.id, { car_id: block.car_id, start: block.start_date, end: block.end_date })
    load()
  }

  const tabLabels: Record<string, string> = { main: 'Основной парк', ilya: 'Парк Ильи' }
  const tabCars = cars.filter(c => (c.owner_group || 'main') === ownerTab && !c.delisted)
  const payroll = calcPayroll().filter(r => (r.car.owner_group || 'main') === ownerTab && !r.car.delisted)
  const totalPayroll = payroll.reduce((s, r) => s + r.salary, 0)

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-2">
          {(['main', 'ilya'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setOwnerTab(tab)}
              className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all ${ownerTab === tab ? 'bg-[#4F46E5] text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'}`}
            >
              {tabLabels[tab]}
            </button>
          ))}
        </div>
        <button
          onClick={() => { setShowModal(true); setEditBlock(null); setForm({ car_id: '', start_date: '', end_date: '', reason: '' }) }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} /> Добавить блокировку
        </button>
      </div>

      {/* Month navigation */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => setCurrentMonth(m => subMonths(m, 1))} className="p-2 rounded-lg hover:bg-gray-100">
          <ChevronLeft size={18} />
        </button>
        <span className="text-lg font-semibold capitalize">
          {format(currentMonth, 'LLLL yyyy', { locale: ru })}
        </span>
        <button onClick={() => setCurrentMonth(m => addMonths(m, 1))} className="p-2 rounded-lg hover:bg-gray-100">
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Calendar grid */}
      <div className="bg-white rounded-[18px] overflow-x-auto mb-8 card-shadow border border-gray-100/80">
        <table className="text-xs min-w-full">
          <thead>
            <tr className="border-b">
              <th className="px-4 py-3 text-left text-gray-500 font-medium w-36 sticky left-0 bg-white">Авто</th>
              {days.map(day => (
                <th key={day.toISOString()} className={`px-1.5 py-3 text-center font-medium min-w-[32px] ${format(day, 'EEEE') === 'Sunday' || format(day, 'EEEE') === 'Saturday' ? 'text-blue-400' : 'text-gray-500'}`}>
                  <div className="flex flex-col items-center gap-0.5">
                    <div className={`w-7 h-7 flex items-center justify-center rounded-full text-sm ${isToday(day) ? 'bg-[#4F46E5] text-white font-bold' : ''}`}>
                      {format(day, 'd')}
                    </div>
                    <div className="text-gray-300 text-[10px]">{format(day, 'EE', { locale: ru })}</div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tabCars.map(car => (
              <tr key={car.id} className="border-b last:border-0">
                <td className="px-4 py-3 font-medium text-gray-700 sticky left-0 bg-white whitespace-nowrap">
                  {car.make} {car.model} <span className="text-gray-400">{car.plate}</span>
                </td>
                {days.map(day => {
                  const block = isBlocked(car.id, day)
                  return (
                    <td key={day.toISOString()} className="px-0.5 py-1 text-center">
                      {block ? (
                        <div
                          className="bg-red-100 text-red-600 rounded text-xs py-1 cursor-pointer hover:bg-red-200 transition-colors"
                          title={block.reason || 'Неактивен'}
                          onClick={() => { setEditBlock(block); setForm({ car_id: block.car_id, start_date: block.start_date, end_date: block.end_date, reason: block.reason || '' }); setShowModal(true) }}
                        >
                          ✕
                        </div>
                      ) : (
                        <div className="bg-green-50 rounded py-1"> </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Active blocks list */}
      {blocks.filter(b => (b.car?.owner_group || 'main') === ownerTab).length > 0 && (
        <div className="bg-white rounded-[18px] p-6 mb-8 card-shadow border border-gray-100/80">
          <h2 className="text-base font-semibold mb-4">Активные блокировки</h2>
          <div className="space-y-2">
            {blocks.filter(b => (b.car?.owner_group || 'main') === ownerTab).map(b => (
              <div key={b.id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div>
                  <span className="font-medium">{b.car?.make} {b.car?.model} {b.car?.plate}</span>
                  <span className="text-gray-500 text-sm mx-3">
                    {format(parseISO(b.start_date), 'dd.MM.yyyy')} — {b.end_date ? format(parseISO(b.end_date), 'dd.MM.yyyy') : 'по сей день'}
                  </span>
                  {b.reason && <span className="text-gray-400 text-sm">{b.reason}</span>}
                </div>
                <button onClick={() => handleDeleteBlock(b)} className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Payroll section */}
      <div className="bg-white rounded-[18px] p-6 card-shadow border border-gray-100/80">
        <h2 className="text-base font-semibold mb-1">Зарплата операторов за {format(currentMonth, 'LLLL yyyy', { locale: ru })}</h2>
        <p className="text-xs text-gray-400 mb-5">$150/авто · 3–4 акт. недели → $150 · 2 недели → $75 · меньше → $0</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b">
              <th className="pb-3 font-medium">Авто</th>
              <th className="pb-3 font-medium text-center">Акт. недель</th>
              <th className="pb-3 font-medium text-right">Зарплата</th>
            </tr>
          </thead>
          <tbody>
            {payroll.map(({ car, activeWeeks, salary }) => (
              <tr key={car.id} className="border-b last:border-0">
                <td className="py-3">{car.make} {car.model} <span className="text-gray-400">{car.plate}</span></td>
                <td className="py-3 text-center">{activeWeeks}</td>
                <td className={`py-3 text-right font-semibold ${salary > 0 ? 'text-green-600' : 'text-red-400'}`}>
                  ${salary}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2">
              <td colSpan={2} className="pt-3 font-semibold">Итого</td>
              <td className="pt-3 text-right font-bold text-lg text-blue-600">${totalPayroll}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Salary payments (manual) */}
      {(() => {
        const paidSum = payments.filter(p => (p.owner_group || 'main') === ownerTab).reduce((s, p) => s + Number(p.amount), 0)
        const total = totalPayroll
        const remaining = total - paidSum
        return (
          <div className="bg-white rounded-[18px] p-6 card-shadow border border-gray-100/80 mt-5">
            <h2 className="text-base font-semibold mb-1">Выплаты зарплаты</h2>
            <p className="text-xs text-gray-400 mb-5">Сумма за месяц считается автоматически из календаря</p>

            {/* Добавить выплату */}
            <form onSubmit={addPayment} className="flex items-end gap-3 mb-5 flex-wrap">
              <div>
                <label className="block text-xs text-gray-400 font-medium mb-1">Выплачено ($)</label>
                <input type="number" step="0.01" min="0" value={payAmount} onChange={e => setPayAmount(e.target.value)} required placeholder="0.00"
                  className="w-36 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/30 focus:border-indigo-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 font-medium mb-1">Период с</label>
                <div className="w-44"><DatePicker value={payStart} onChange={setPayStart} /></div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 font-medium mb-1">по</label>
                <div className="w-44"><DatePicker value={payEnd} onChange={setPayEnd} /></div>
              </div>
              <button className="bg-[#4F46E5] hover:bg-[#4338CA] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
                Добавить
              </button>
            </form>

            {/* Список выплат */}
            {payments.filter(p => (p.owner_group || 'main') === ownerTab).length > 0 && (
              <div className="border border-gray-100 rounded-xl divide-y divide-gray-50 mb-5">
                {payments.filter(p => (p.owner_group || 'main') === ownerTab).map(p => (
                  <div key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="text-gray-600">{p.period || '—'}</span>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-gray-900">${Number(p.amount).toFixed(2)}</span>
                      <button onClick={() => deletePayment(p.id)} className="text-gray-300 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Итоги */}
            <div className="flex items-center gap-8 pt-2 border-t border-gray-100">
              <div><span className="text-sm text-gray-500">Сумма за месяц: </span><span className="font-bold text-gray-900">${total.toFixed(2)}</span></div>
              <div><span className="text-sm text-gray-500">Выплачено: </span><span className="font-bold text-emerald-600">${paidSum.toFixed(2)}</span></div>
              <div><span className="text-sm text-gray-500">Остаток: </span><span className={`font-bold ${remaining > 0 ? 'text-rose-400' : 'text-emerald-600'}`}>${remaining.toFixed(2)}</span></div>
            </div>
          </div>
        )
      })()}

      {/* Block modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-5">{editBlock ? 'Редактировать блокировку' : 'Добавить блокировку'}</h2>
            <form onSubmit={handleSaveBlock} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Авто</label>
                <select value={form.car_id} onChange={e => setForm(f => ({ ...f, car_id: e.target.value }))} required className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Выберите авто</option>
                  {tabCars.map(c => <option key={c.id} value={c.id}>{c.make} {c.model} {c.plate}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Дата с</label>
                  <DatePicker value={form.start_date} onChange={val => setForm(f => ({ ...f, start_date: val }))} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Дата по</label>
                  <DatePicker value={form.end_date} onChange={val => setForm(f => ({ ...f, end_date: val }))} required />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Причина (необязательно)</label>
                <input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="ДТП, ремонт, ТО..." className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium transition-colors">
                  Сохранить
                </button>
                <button type="button" onClick={() => { setShowModal(false); setEditBlock(null) }} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 rounded-lg text-sm font-medium transition-colors">
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

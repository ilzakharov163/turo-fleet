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
  inactiveDays: number
  salary: number
}

function calcSalary(inactiveDays: number, totalDays: number): number {
  if (inactiveDays >= totalDays) return 0   // весь месяц простой → $0
  if (inactiveDays >= 14) return 75          // 14+ дней простоя → $75
  return 150                                  // менее 14 дней → $150
}

export default function CalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [cars, setCars] = useState<Car[]>([])
  const [blocks, setBlocks] = useState<CarBlock[]>([])
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ car_id: '', start_date: '', end_date: '', reason: '' })
  const [editBlock, setEditBlock] = useState<CarBlock | null>(null)

  // Выплаты зарплаты (ручные)
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
    const { data } = await supabase.from('salary_payments').insert({ amount: parseFloat(payAmount), period, owner_group: 'main' }).select().single()
    if (data) await log('create', 'salary', data.id, { amount: parseFloat(payAmount), period: period || '' })
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
  const totalDays = days.length

  function isBlocked(carId: string, day: Date): CarBlock | undefined {
    return blocks.find(b =>
      b.car_id === carId &&
      isWithinInterval(day, { start: parseISO(b.start_date), end: b.end_date ? parseISO(b.end_date) : new Date(9999, 0) })
    )
  }

  // Расчёт простоя для каждого авто
  const activeCars = cars.filter(c => !c.delisted)
  const payrollRows: PayrollRow[] = activeCars.map(car => {
    const monthBlocks = blocks.filter(b => b.car_id === car.id).filter(b => {
      const s = parseISO(b.start_date)
      const e = b.end_date ? parseISO(b.end_date) : new Date(9999, 0)
      return days.some(d => isWithinInterval(d, { start: s, end: e }))
    })
    const inactiveDays = days.filter(d =>
      monthBlocks.some(b => isWithinInterval(d, { start: parseISO(b.start_date), end: b.end_date ? parseISO(b.end_date) : new Date(9999, 0) }))
    ).length
    return { car, inactiveDays, salary: calcSalary(inactiveDays, totalDays) }
  })

  async function handleSaveBlock(e: React.FormEvent) {
    e.preventDefault()
    if (!form.car_id || !form.start_date) return
    const supabase = createClient()
    const payload = { car_id: form.car_id, start_date: form.start_date, end_date: form.end_date || null, reason: form.reason || null }
    if (editBlock) {
      await supabase.from('car_blocks').update(payload).eq('id', editBlock.id)
      await log('update', 'car_block', editBlock.id, payload)
    } else {
      const { data } = await supabase.from('car_blocks').insert(payload).select().single()
      if (data) await log('create', 'car_block', data.id, payload)
    }
    setShowModal(false)
    setForm({ car_id: '', start_date: '', end_date: '', reason: '' })
    setEditBlock(null)
    load()
  }

  async function handleDeleteBlock(b: CarBlock) {
    if (!confirm('Удалить блокировку?')) return
    const supabase = createClient()
    await supabase.from('car_blocks').delete().eq('id', b.id)
    await log('delete', 'car_block', b.id, { car_id: b.car_id })
    load()
  }

  const totalSalary = payrollRows.reduce((s, r) => s + r.salary, 0)

  return (
    <div className="p-8 space-y-8">

      {/* Calendar */}
      <div className="bg-white rounded-[18px] p-6 card-shadow border border-gray-100/80">
        <div className="flex items-center justify-between mb-6">
          <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-2 rounded-xl hover:bg-gray-100 transition-colors"><ChevronLeft size={18} /></button>
          <h2 className="text-base font-semibold capitalize">{format(currentMonth, 'LLLL yyyy', { locale: ru })}</h2>
          <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-2 rounded-xl hover:bg-gray-100 transition-colors"><ChevronRight size={18} /></button>
        </div>

        {/* Grid header */}
        <div className="grid grid-cols-[180px_repeat(31,minmax(28px,1fr))] gap-px mb-1">
          <div />
          {days.map(d => (
            <div key={d.toISOString()} className={`text-center text-[10px] font-medium pb-1 ${
              isToday(d) ? 'text-[#4F46E5]' : 'text-gray-400'
            }`}>{format(d, 'd')}</div>
          ))}
        </div>

        {/* Cars rows */}
        {activeCars.map(car => (
          <div key={car.id} className="grid grid-cols-[180px_repeat(31,minmax(28px,1fr))] gap-px mb-0.5">
            <div className="text-xs text-gray-600 flex items-center pr-2 truncate">{car.make} {car.model}</div>
            {days.map(d => {
              const bl = isBlocked(car.id, d)
              return (
                <button
                  key={d.toISOString()}
                  onClick={() => {
                    if (bl) {
                      setEditBlock(bl)
                      setForm({ car_id: bl.car_id, start_date: bl.start_date, end_date: bl.end_date || '', reason: bl.reason || '' })
                      setShowModal(true)
                    } else {
                      setEditBlock(null)
                      setForm({ car_id: car.id, start_date: format(d, 'yyyy-MM-dd'), end_date: '', reason: '' })
                      setShowModal(true)
                    }
                  }}
                  className={`h-6 rounded-[3px] transition-colors ${
                    bl ? 'bg-red-400 hover:bg-red-500' : isToday(d) ? 'bg-indigo-50 hover:bg-indigo-100' : 'bg-gray-100 hover:bg-gray-200'
                  }`}
                />
              )
            })}
          </div>
        ))}
      </div>

      {/* Payroll section */}
      <div className="bg-white rounded-[18px] p-6 card-shadow border border-gray-100/80">
        <h2 className="text-base font-semibold mb-1">Зарплата сотрудника за {format(currentMonth, 'LLLL yyyy', { locale: ru })}</h2>
        <p className="text-xs text-gray-400 mb-5">Простой &lt; 14 дней → $150 · простой ≥ 14 дней → $75 · весь месяц → $0</p>
        <table className="w-full text-sm mb-6">
          <thead>
            <tr className="text-left text-gray-400 border-b">
              <th className="pb-2 font-medium">Авто</th>
              <th className="pb-2 font-medium text-center">Дней простоя</th>
              <th className="pb-2 font-medium text-right">Зарплата</th>
            </tr>
          </thead>
          <tbody>
            {payrollRows.map(({ car, inactiveDays, salary }) => (
              <tr key={car.id} className="border-b last:border-0">
                <td className="py-2">{car.make} {car.model}</td>
                <td className="py-2 text-center text-gray-500">{inactiveDays}</td>
                <td className={`py-2 text-right font-semibold ${
                  salary === 150 ? 'text-green-600' : salary === 75 ? 'text-yellow-600' : 'text-red-500'
                }`}>${salary}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="pt-3 font-semibold text-gray-700">Итого</td>
              <td className="pt-3 text-right font-bold text-gray-900">${totalSalary}</td>
            </tr>
          </tfoot>
        </table>

        {/* Manual payment log */}
        <h3 className="text-sm font-semibold text-gray-700 mb-3">История выплат</h3>
        <form onSubmit={addPayment} className="flex gap-2 items-end mb-4 flex-wrap">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Сумма ($)</label>
            <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} placeholder="0" min="0" step="0.01"
              className="border border-gray-200 rounded-[10px] px-3 py-2 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/20" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Период с</label>
            <DatePicker value={payStart} onChange={setPayStart} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">по</label>
            <DatePicker value={payEnd} onChange={setPayEnd} />
          </div>
          <button type="submit" className="flex items-center gap-1.5 px-4 py-2 bg-[#4F46E5] text-white text-sm font-medium rounded-[10px] hover:bg-[#4338CA] transition-colors">
            <Plus size={15} /> Добавить
          </button>
        </form>
        {payments.filter(p => p.owner_group === 'main').length === 0
          ? <p className="text-sm text-gray-400">Выплат пока нет</p>
          : <div className="space-y-2">
              {payments.filter(p => p.owner_group === 'main').map(p => (
                <div key={p.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <span className="font-semibold text-sm">${p.amount}</span>
                    {p.period && <span className="text-xs text-gray-400 ml-2">{p.period}</span>}
                  </div>
                  <button onClick={() => deletePayment(p.id)} className="text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
        }
      </div>

      {/* Block modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div className="bg-white rounded-[18px] p-6 w-full max-w-sm card-shadow">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold">{editBlock ? 'Редактировать блокировку' : 'Добавить блокировку'}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <form onSubmit={handleSaveBlock} className="space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Авто</label>
                <select value={form.car_id} onChange={e => setForm(f => ({ ...f, car_id: e.target.value }))}
                  className="w-full border border-gray-200 rounded-[10px] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/20" required>
                  <option value="">Выберите авто</option>
                  {cars.map(c => <option key={c.id} value={c.id}>{c.make} {c.model} · {c.plate}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Дата с</label>
                  <DatePicker value={form.start_date} onChange={v => setForm(f => ({ ...f, start_date: v }))} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Дата по</label>
                  <DatePicker value={form.end_date} onChange={v => setForm(f => ({ ...f, end_date: v }))} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Причина</label>
                <input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="необязательно"
                  className="w-full border border-gray-200 rounded-[10px] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/20" />
              </div>
              <div className="flex gap-3 pt-1">
                {editBlock && (
                  <button type="button" onClick={() => handleDeleteBlock(editBlock)}
                    className="flex-1 py-2 rounded-[10px] border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-colors">
                    Удалить
                  </button>
                )}
                <button type="submit"
                  className="flex-1 py-2 rounded-[10px] bg-[#4F46E5] text-white text-sm font-medium hover:bg-[#4338CA] transition-colors">
                  {editBlock ? 'Сохранить' : 'Добавить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

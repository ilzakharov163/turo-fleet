'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { log } from '@/lib/logger'
import { Car, CarBlock } from '@/types'
import { ChevronLeft, ChevronRight, Plus, X, Send, Copy, Check, Download } from 'lucide-react'
import {
  startOfMonth, endOfMonth, eachDayOfInterval, format, isSameMonth,
  addMonths, subMonths, parseISO, isWithinInterval, differenceInDays,
  startOfWeek, endOfWeek, isToday
} from 'date-fns'
import { ru } from 'date-fns/locale'
import DatePicker from '@/components/ui/DatePicker'
import { inputCls } from '@/components/ui/PageShell'
import { notify, ask } from '@/lib/ui'
import { calcSalary } from '@/lib/calc'

interface PayrollRow {
  car: Car
  inactiveDays: number
  salary: number
}


export default function DowntimeView() {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [cars, setCars] = useState<Car[]>([])
  const [blocks, setBlocks] = useState<CarBlock[]>([])
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ car_id: '', start_date: '', end_date: '', reason: '' })
  const [editBlock, setEditBlock] = useState<CarBlock | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    const supabase = createClient()
    const [carsRes, blocksRes] = await Promise.all([
      supabase.from('cars').select('*').order('make'),
      supabase.from('car_blocks').select('*, car:cars(*)'),
    ])
    setCars(carsRes.data || [])
    setBlocks(blocksRes.data as CarBlock[] || [])
  }, [])


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
  const activeCars = cars.filter(c => !c.delisted).sort((a, b) => `${a.make} ${a.model} ${a.plate}`.localeCompare(`${b.make} ${b.model} ${b.plate}`))
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
    if (!await ask('Удалить простой?', { ok: 'Удалить', danger: true })) return
    const supabase = createClient()
    await supabase.from('car_blocks').delete().eq('id', b.id)
    await log('delete', 'car_block', b.id, { car_id: b.car_id })
    load()
  }

  const totalSalary = payrollRows.reduce((s, r) => s + r.salary, 0)

  // ── Экспорт зарплаты для Telegram / Excel ──
  const fullRows = payrollRows.filter(r => r.salary === 150)
  const halfRows = payrollRows.filter(r => r.salary === 75)
  const zeroRows = payrollRows.filter(r => r.salary === 0)

  function payrollText() {
    const monthLabel = format(currentMonth, 'LLLL yyyy', { locale: ru })
    const name = (r: PayrollRow) => `${r.car.make} ${r.car.model} ${r.car.plate}`
    const lines: string[] = [`Зарплата за ${monthLabel}`, '']
    if (fullRows.length) {
      lines.push(`✅ $150 × ${fullRows.length} = $${fullRows.length * 150}`)
      fullRows.forEach(r => lines.push(`• ${name(r)}`))
      lines.push('')
    }
    if (halfRows.length) {
      lines.push(`🟡 $75 × ${halfRows.length} = $${halfRows.length * 75} (простой 14+ дней)`)
      halfRows.forEach(r => lines.push(`• ${name(r)} — простой ${r.inactiveDays} дн.`))
      lines.push('')
    }
    if (zeroRows.length) {
      lines.push(`⛔ $0 × ${zeroRows.length} (не работали весь месяц)`)
      zeroRows.forEach(r => lines.push(`• ${name(r)}`))
      lines.push('')
    }
    lines.push(`Итого: $${totalSalary}`)
    return lines.join('\n')
  }

  async function copyPayroll() {
    try {
      await navigator.clipboard.writeText(payrollText())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      notify('Не удалось скопировать — попробуй ещё раз', 'error')
    }
  }

  async function sharePayroll() {
    const text = payrollText()
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share({ text }) } catch { /* отменено */ }
    } else {
      copyPayroll()
    }
  }

  function downloadPayrollCsv() {
    const esc = (val: string | number) => `"${String(val).replace(/"/g, '""')}"`
    const rows: (string | number)[][] = [
      ['Авто', 'Номер', 'Дней работы', 'Дней простоя', 'Зарплата, $'],
      ...payrollRows.map(r => [`${r.car.make} ${r.car.model}`, r.car.plate, totalDays - r.inactiveDays, r.inactiveDays, r.salary]),
      [],
      ['Итого', '', '', '', totalSalary],
    ]
    const csv = '\ufeff' + rows.map(r => r.map(esc).join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `zarplata-${format(currentMonth, 'yyyy-MM')}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }


  return (
    <div className="space-y-4 sm:space-y-5">

      {/* Телефон — карточки машин с полоской месяца */}
      <div className="sm:hidden space-y-3">
        <div className="bg-white rounded-[18px] p-3 card-shadow border border-gray-100/80">
          <div className="flex items-center justify-between">
            <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center"><ChevronLeft size={18} /></button>
            <h2 className="text-base font-semibold capitalize">{format(currentMonth, 'LLLL yyyy', { locale: ru })}</h2>
            <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center"><ChevronRight size={18} /></button>
          </div>
          <div className="flex items-center justify-between gap-2 mt-3">
            <p className="text-xs text-gray-500">
              В простое сейчас: <span className="font-semibold text-red-500">{activeCars.filter(c => isBlocked(c.id, new Date())).length}</span>
              {' · '}Зарплата: <span className="font-semibold text-gray-900">${totalSalary}</span>
            </p>
            <button
              onClick={() => { setEditBlock(null); setForm({ car_id: '', start_date: format(new Date(), 'yyyy-MM-dd'), end_date: '', reason: '' }); setShowModal(true) }}
              className="flex-shrink-0 inline-flex items-center gap-1 px-3 h-9 rounded-xl bg-[#4F46E5] text-white text-sm font-medium"
            >
              <Plus size={15} /> Простой
            </button>
          </div>
        </div>

        {[...payrollRows].sort((a, b) => (isBlocked(b.car.id, new Date()) ? 1 : 0) - (isBlocked(a.car.id, new Date()) ? 1 : 0) || b.inactiveDays - a.inactiveDays).map(({ car, inactiveDays, salary }) => {
          const monthBlocks = blocks
            .filter(b => b.car_id === car.id && b.start_date <= format(days[days.length - 1], 'yyyy-MM-dd') && (!b.end_date || b.end_date >= format(days[0], 'yyyy-MM-dd')))
            .sort((a, b) => a.start_date.localeCompare(b.start_date))
          const idleNow = !!isBlocked(car.id, new Date())
          return (
            <div key={car.id} className="bg-white rounded-[18px] p-3.5 card-shadow border border-gray-100/80">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate">
                    {idleNow && <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1.5 align-middle" />}
                    {car.make} {car.model}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    <span className="font-mono font-semibold text-gray-600">{car.plate}</span>
                    {inactiveDays > 0 && <> · простой {inactiveDays} дн.</>}
                  </p>
                </div>
                <span className={`flex-shrink-0 px-2 py-1 rounded-lg text-xs font-bold tabular-nums ${
                  salary === 150 ? 'bg-green-50 text-green-600' : salary === 75 ? 'bg-yellow-50 text-yellow-600' : 'bg-red-50 text-red-500'
                }`}>${salary}</span>
              </div>

              {/* Полоска месяца */}
              <div className="flex gap-[2px] mt-3">
                {days.map(d => {
                  const bl = isBlocked(car.id, d)
                  return (
                    <span
                      key={d.toISOString()}
                      className={`flex-1 h-3 rounded-[2px] ${bl ? 'bg-red-400' : 'bg-gray-100'} ${isToday(d) ? 'ring-1 ring-[#4F46E5] ring-offset-1' : ''}`}
                    />
                  )
                })}
              </div>
              <div className="flex justify-between text-[10px] text-gray-400 mt-1 tabular-nums">
                <span>1</span><span>{Math.ceil(totalDays / 2)}</span><span>{totalDays}</span>
              </div>

              <div className="flex flex-wrap gap-1.5 mt-2">
                {monthBlocks.map(b => (
                  <button
                    key={b.id}
                    onClick={() => { setEditBlock(b); setForm({ car_id: b.car_id, start_date: b.start_date, end_date: b.end_date || '', reason: b.reason || '' }); setShowModal(true) }}
                    className="inline-flex items-center gap-1 max-w-full px-2.5 h-8 rounded-lg bg-red-50 text-red-600 text-xs font-medium"
                  >
                    <span className="truncate">
                      {format(parseISO(b.start_date), 'd MMM', { locale: ru })} — {b.end_date ? format(parseISO(b.end_date), 'd MMM', { locale: ru }) : 'без даты'}
                      {b.reason ? ` · ${b.reason}` : ''}
                    </span>
                  </button>
                ))}
                <button
                  onClick={() => { setEditBlock(null); setForm({ car_id: car.id, start_date: format(new Date(), 'yyyy-MM-dd'), end_date: '', reason: '' }); setShowModal(true) }}
                  className="inline-flex items-center gap-1 px-2.5 h-8 rounded-lg bg-gray-50 text-gray-600 text-xs font-medium"
                >
                  <Plus size={13} /> Простой
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Calendar (компьютер) */}
      <div className="hidden sm:block bg-white rounded-[18px] p-6 card-shadow border border-gray-100/80 overflow-x-auto">
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
            <div className="text-xs text-gray-600 flex items-center gap-1.5 pr-2 min-w-0" title={`${car.make} ${car.model} · ${car.plate}`}><span className="truncate">{car.make} {car.model}</span><span className="flex-shrink-0 font-semibold text-gray-800 tabular-nums">{car.plate}</span></div>
            {days.map(d => {
              const bl = isBlocked(car.id, d)
              return (
                <button
                  key={d.toISOString()}
                  title={bl ? `${car.make} ${car.model} · ${car.plate}${bl.reason ? " — " + bl.reason : ""}` : `${car.plate} · ${format(d, "d MMM", { locale: ru })}`}
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
      <div className="bg-white rounded-[18px] p-4 sm:p-6 card-shadow border border-gray-100/80">
        <h2 className="text-base font-semibold mb-1">Зарплата сотрудника за {format(currentMonth, 'LLLL yyyy', { locale: ru })}</h2>
        <p className="text-xs text-gray-400 mb-5">Простой &lt; 14 дней → $150 · простой ≥ 14 дней → $75 · весь месяц → $0</p>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5 p-3 rounded-xl bg-gray-50 border border-gray-100">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="text-green-600 font-semibold">{fullRows.length} × $150</span>
            <span className="text-yellow-600 font-semibold">{halfRows.length} × $75</span>
            <span className="text-red-500 font-semibold">{zeroRows.length} × $0</span>
            <span className="text-gray-900 font-bold">= ${totalSalary}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={sharePayroll} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-[#229ED9] hover:bg-[#1c8cc2] text-white text-sm font-medium transition-colors">
              <Send size={15} /> Отправить в Telegram
            </button>
            <button type="button" onClick={copyPayroll} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-white border border-gray-200 hover:bg-gray-100 text-gray-700 text-sm font-medium transition-colors">
              {copied ? <><Check size={15} className="text-green-600" /> Скопировано</> : <><Copy size={15} /> Копировать текст</>}
            </button>
            <button type="button" onClick={downloadPayrollCsv} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-white border border-gray-200 hover:bg-gray-100 text-gray-700 text-sm font-medium transition-colors">
              <Download size={15} /> Excel
            </button>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b">
              <th className="pb-2 font-medium">Авто</th>
              <th className="pb-2 font-medium text-center"><span className="sm:hidden">Работа</span><span className="hidden sm:inline">Дней работы</span></th>
              <th className="pb-2 font-medium text-center"><span className="sm:hidden">Простой</span><span className="hidden sm:inline">Дней простоя</span></th>
              <th className="pb-2 font-medium text-right">Зарплата</th>
            </tr>
          </thead>
          <tbody>
            {payrollRows.map(({ car, inactiveDays, salary }) => (
              <tr key={car.id} className="border-b last:border-0">
                <td className="py-2">{car.make} {car.model} <span className="ml-1 text-xs font-semibold text-gray-500">{car.plate}</span></td>
                <td className="py-2 text-center text-gray-500">{totalDays - inactiveDays}</td>
                <td className="py-2 text-center text-gray-500">{inactiveDays}</td>
                <td className={`py-2 text-right font-semibold ${
                  salary === 150 ? 'text-green-600' : salary === 75 ? 'text-yellow-600' : 'text-red-500'
                }`}>${salary}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="pt-3 font-semibold text-gray-700">Итого</td>
              <td className="pt-3 text-right font-bold text-gray-900">${totalSalary}</td>
            </tr>
          </tfoot>
        </table>

      </div>

      {/* Block modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-[2px] flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div className="bg-white rounded-t-[22px] sm:rounded-[20px] p-5 sm:p-6 w-full max-w-sm shadow-2xl animate-in" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold">{editBlock ? 'Редактировать простой' : 'Добавить простой'}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <form onSubmit={handleSaveBlock} className="space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Авто</label>
                <select value={form.car_id} onChange={e => setForm(f => ({ ...f, car_id: e.target.value }))}
                  className={inputCls} required>
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
                  className={inputCls} />
              </div>
              <div className="flex gap-3 pt-1">
                {editBlock && (
                  <button type="button" onClick={() => handleDeleteBlock(editBlock)}
                    className="flex-1 h-11 rounded-[10px] border border-red-200 text-red-500 text-sm font-semibold hover:bg-red-50 transition-colors">
                    Удалить
                  </button>
                )}
                <button type="submit"
                  className="btn-primary flex-1 h-11">
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

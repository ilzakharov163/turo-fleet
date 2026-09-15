'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { log } from '@/lib/logger'
import { Car } from '@/types'
import { Plus, X, Pencil, AlertCircle, Wrench, Clock } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import DatePicker from '@/components/ui/DatePicker'

interface Claim {
  id: string
  car_id: string | null
  status: 'waiting' | 'in_repair' | 'done'
  opened_date: string | null
  initial_payment_received: boolean
  supplement_paid: boolean
  still_listed: boolean
  notes: string | null
  created_at: string
  car?: Car
}

const STATUS_LABELS: Record<string, string> = {
  waiting: 'Ожидает ремонта',
  in_repair: 'В ремонте',
  done: 'Завершён',
}

const STATUS_COLORS: Record<string, string> = {
  waiting: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  in_repair: 'bg-blue-100 text-blue-700 border-blue-200',
  done: 'bg-green-100 text-green-700 border-green-200',
}

const STATUS_DOT: Record<string, string> = {
  waiting: 'bg-yellow-400',
  in_repair: 'bg-blue-500',
  done: 'bg-green-500',
}

const emptyForm = {
  car_id: '',
  status: 'waiting' as Claim['status'],
  opened_date: '',
  initial_payment_received: false,
  supplement_paid: false,
  still_listed: true,
  notes: '',
}

export default function ClaimsPage() {
  const [claims, setClaims] = useState<Claim[]>([])
  const [cars, setCars] = useState<Car[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editClaim, setEditClaim] = useState<Claim | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [filterStatus, setFilterStatus] = useState<'all' | 'waiting' | 'in_repair' | 'done'>('all')

  const load = useCallback(async () => {
    const supabase = createClient()
    const [claimsRes, carsRes] = await Promise.all([
      supabase.from('claims').select('*, car:cars(*)').order('created_at', { ascending: false }),
      supabase.from('cars').select('*').order('make'),
    ])
    setClaims(claimsRes.data as Claim[] || [])
    setCars(carsRes.data || [])
  }, [])

  useEffect(() => { load() }, [load])

  function openAdd() {
    setEditClaim(null)
    setForm(emptyForm)
    setShowModal(true)
  }

  function openEdit(c: Claim) {
    setEditClaim(c)
    setForm({
      car_id: c.car_id || '',
      status: c.status,
      opened_date: c.opened_date || '',
      initial_payment_received: c.initial_payment_received,
      supplement_paid: c.supplement_paid,
      still_listed: c.still_listed,
      notes: c.notes || '',
    })
    setShowModal(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const supabase = createClient()
    const payload = {
      car_id: form.car_id || null,
      status: form.status,
      opened_date: form.opened_date || null,
      initial_payment_received: form.initial_payment_received,
      supplement_paid: form.supplement_paid,
      still_listed: form.still_listed,
      notes: form.notes || null,
    }
    if (editClaim) {
      await supabase.from('claims').update(payload).eq('id', editClaim.id)
      await log('update', 'claim', editClaim.id, payload)
    } else {
      const { data } = await supabase.from('claims').insert(payload).select().single()
      if (data) await log('create', 'claim', data.id, payload)
    }
    setShowModal(false)
    load()
  }

  async function handleDelete(c: Claim) {
    if (!confirm('Удалить клейм?')) return
    const supabase = createClient()
    await supabase.from('claims').delete().eq('id', c.id)
    await log('delete', 'claim', c.id, { car_id: c.car_id })
    load()
  }

  async function toggleField(c: Claim, field: 'initial_payment_received' | 'supplement_paid') {
    const supabase = createClient()
    const val = !c[field]
    await supabase.from('claims').update({ [field]: val }).eq('id', c.id)
    await log('update', 'claim', c.id, { [field]: val })
    load()
  }

  async function setStatus(c: Claim, status: Claim['status']) {
    const supabase = createClient()
    await supabase.from('claims').update({ status }).eq('id', c.id)
    await log('update', 'claim', c.id, { status })
    load()
  }

  const filtered = claims.filter(c => filterStatus === 'all' || c.status === filterStatus)
  const waiting = claims.filter(c => c.status === 'waiting').length
  const inRepair = claims.filter(c => c.status === 'in_repair').length

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Клеймы и ремонт</h1>
          <p className="text-sm text-gray-400 mt-0.5">Отслеживание машин в очереди и в процессе ремонта</p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} /> Добавить клейм
        </button>
      </div>

      {/* Summary chips */}
      <div className="flex gap-3 mb-6">
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
          <Clock size={16} className="text-yellow-600" />
          <span className="text-sm font-semibold text-yellow-700">{waiting} ожидают ремонта</span>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
          <Wrench size={16} className="text-blue-600" />
          <span className="text-sm font-semibold text-blue-700">{inRepair} в ремонте</span>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-5">
        {(['all', 'waiting', 'in_repair', 'done'] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterStatus === s ? 'bg-[#4F46E5] text-white' : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'}`}
          >
            {s === 'all' ? 'Все' : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Claims list */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-[18px] p-12 card-shadow border border-gray-100/80 text-center">
          <AlertCircle size={32} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Нет клеймов</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(c => (
            <div key={c.id} className="bg-white rounded-[18px] p-5 card-shadow border border-gray-100/80">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <span className="font-semibold text-gray-800">
                      {c.car ? `${c.car.make} ${c.car.model} ${c.car.plate}` : '— без авто —'}
                    </span>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_COLORS[c.status]}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[c.status]}`} />
                      {STATUS_LABELS[c.status]}
                    </span>
                    {c.still_listed && c.status !== 'done' && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-purple-50 text-purple-600 border border-purple-100 font-medium">
                        Листинг активен
                      </span>
                    )}
                  </div>
                  {c.opened_date && (
                    <p className="text-xs text-gray-400 mb-3">
                      Открыт: {format(parseISO(c.opened_date), 'd MMMM yyyy', { locale: ru })}
                    </p>
                  )}
                  <div className="flex items-center gap-4 flex-wrap">
                    <button
                      onClick={() => toggleField(c, 'initial_payment_received')}
                      className={`flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-lg border transition-all ${c.initial_payment_received ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'}`}
                    >
                      <span className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center ${c.initial_payment_received ? 'bg-green-500 border-green-500' : 'border-gray-300'}`}>
                        {c.initial_payment_received && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
                      </span>
                      Initial payment
                    </button>
                    <button
                      onClick={() => toggleField(c, 'supplement_paid')}
                      className={`flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-lg border transition-all ${c.supplement_paid ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-500 border-red-200 hover:bg-red-100'}`}
                    >
                      <span className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center ${c.supplement_paid ? 'bg-green-500 border-green-500' : 'border-red-300'}`}>
                        {c.supplement_paid && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
                      </span>
                      Supplement {c.supplement_paid ? 'оплачен' : 'не оплачен'}
                    </button>
                  </div>
                  {c.notes && (
                    <p className="text-sm text-gray-500 mt-3 bg-gray-50 rounded-lg px-3 py-2">{c.notes}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {c.status === 'waiting' && (
                    <button onClick={() => setStatus(c, 'in_repair')} className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-600 font-medium px-3 py-1.5 rounded-lg border border-blue-100 transition-colors whitespace-nowrap">→ В ремонт</button>
                  )}
                  {c.status === 'in_repair' && (
                    <button onClick={() => setStatus(c, 'done')} className="text-xs bg-green-50 hover:bg-green-100 text-green-600 font-medium px-3 py-1.5 rounded-lg border border-green-100 transition-colors whitespace-nowrap">→ Завершить</button>
                  )}
                  <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"><Pencil size={15} /></button>
                  <button onClick={() => handleDelete(c)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"><X size={15} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg">
            <h2 className="text-lg font-semibold mb-5">{editClaim ? 'Редактировать клейм' : 'Новый клейм'}</h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Авто</label>
                <select value={form.car_id} onChange={e => setForm(f => ({ ...f, car_id: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Выберите авто</option>
                  {cars.filter(c => !c.delisted).map(c => (<option key={c.id} value={c.id}>{c.make} {c.model} {c.plate}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Статус</label>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as Claim['status'] }))} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="waiting">Ожидает ремонта</option>
                  <option value="in_repair">В ремонте</option>
                  <option value="done">Завершён</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Дата открытия клейма</label>
                <DatePicker value={form.opened_date} onChange={val => setForm(f => ({ ...f, opened_date: val }))} />
              </div>
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={form.initial_payment_received} onChange={e => setForm(f => ({ ...f, initial_payment_received: e.target.checked }))} className="w-4 h-4 rounded accent-blue-600" />
                  <span className="text-sm text-gray-700">Initial payment получен</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={form.supplement_paid} onChange={e => setForm(f => ({ ...f, supplement_paid: e.target.checked }))} className="w-4 h-4 rounded accent-blue-600" />
                  <span className="text-sm text-gray-700">Supplement оплачен</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={form.still_listed} onChange={e => setForm(f => ({ ...f, still_listed: e.target.checked }))} className="w-4 h-4 rounded accent-blue-600" />
                  <span className="text-sm text-gray-700">Машина остаётся в листинге (мелкий ущерб)</span>
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Заметки</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Описание повреждений, детали клейма..." rows={3} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium transition-colors">Сохранить</button>
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 rounded-lg text-sm font-medium transition-colors">Отмена</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

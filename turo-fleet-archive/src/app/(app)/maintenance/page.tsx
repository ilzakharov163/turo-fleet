'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { log } from '@/lib/logger'
import { Car, Maintenance } from '@/types'
import { Wrench, AlertTriangle, CheckCircle, Edit2 } from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import { differenceInDays, parseISO, format } from 'date-fns'

const OIL_INTERVAL_MILES = 5000

interface CarMaintenance {
  car: Car
  maintenance: Maintenance | null
  priority: 'urgent' | 'soon' | 'ok' | 'unknown'
  daysUntil?: number
}

function getPriority(m: Maintenance | null): { priority: CarMaintenance['priority']; daysUntil?: number } {
  if (!m) return { priority: 'unknown' }
  if (m.oil_change_date) {
    const days = differenceInDays(parseISO(m.oil_change_date), new Date())
    if (days < 0) return { priority: 'urgent', daysUntil: days }
    if (days <= 14) return { priority: 'soon', daysUntil: days }
    return { priority: 'ok', daysUntil: days }
  }
  return { priority: 'unknown' }
}

const priorityOrder = { urgent: 0, soon: 1, unknown: 2, ok: 3 }

export default function MaintenancePage() {
  const [items, setItems] = useState<CarMaintenance[]>([])
  const [loading, setLoading] = useState(true)
  const [editItem, setEditItem] = useState<CarMaintenance | null>(null)
  const [form, setForm] = useState({ oil_change_date: '', oil_change_miles: '', notes: '' })

  const load = useCallback(async () => {
    const supabase = createClient()
    const [carsRes, maintRes] = await Promise.all([
      supabase.from('cars').select('*').order('make'),
      supabase.from('maintenance').select('*'),
    ])
    const cars = carsRes.data || []
    const maints = maintRes.data || []

    const result: CarMaintenance[] = cars.map(car => {
      const m = maints.find(m => m.car_id === car.id) || null
      const { priority, daysUntil } = getPriority(m)
      return { car, maintenance: m, priority, daysUntil }
    })

    result.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
    setItems(result)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editItem) return
    const supabase = createClient()
    const payload = {
      car_id: editItem.car.id,
      oil_change_date: form.oil_change_date || null,
      oil_change_miles: form.oil_change_miles ? parseInt(form.oil_change_miles) : null,
      notes: form.notes || null,
      updated_at: new Date().toISOString(),
    }
    if (editItem.maintenance) {
      await supabase.from('maintenance').update(payload).eq('id', editItem.maintenance.id)
      await log('update', 'maintenance', editItem.maintenance.id, payload)
    } else {
      const { data } = await supabase.from('maintenance').insert(payload).select().single()
      if (data) await log('create', 'maintenance', data.id, payload)
    }
    setEditItem(null)
    load()
  }

  function openEdit(item: CarMaintenance) {
    setEditItem(item)
    setForm({
      oil_change_date: item.maintenance?.oil_change_date || '',
      oil_change_miles: item.maintenance?.oil_change_miles ? String(item.maintenance.oil_change_miles) : '',
      notes: item.maintenance?.notes || '',
    })
  }

  const priorityConfig = {
    urgent: { label: 'Просрочено', icon: AlertTriangle, color: 'text-red-600 bg-red-50', badge: 'bg-red-100 text-red-700' },
    soon: { label: 'Скоро', icon: AlertTriangle, color: 'text-yellow-600 bg-yellow-50', badge: 'bg-yellow-100 text-yellow-700' },
    ok: { label: 'OK', icon: CheckCircle, color: 'text-green-600 bg-green-50', badge: 'bg-green-100 text-green-700' },
    unknown: { label: 'Не указано', icon: Wrench, color: 'text-gray-400 bg-gray-50', badge: 'bg-gray-100 text-gray-500' },
  }

  return (
    <div className="p-8">
      <p className="text-sm text-gray-500 mb-8">Список авто по приоритету замены масла</p>

      {loading ? <div className="text-gray-400">Загрузка...</div> : (
        <div className="space-y-3">
          {items.map(item => {
            const cfg = priorityConfig[item.priority]
            const Icon = cfg.icon
            return (
              <div key={item.car.id} className={`bg-white rounded-[18px] p-5 flex items-center justify-between border-l-4 card-shadow border border-gray-100/80 ${item.priority === 'urgent' ? 'border-red-400' : item.priority === 'soon' ? 'border-yellow-400' : item.priority === 'ok' ? 'border-green-400' : 'border-gray-200'}`}>
                <div className="flex items-center gap-4">
                  <div className={`rounded-xl p-2.5 ${cfg.color}`}>
                    <Icon size={20} />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{item.car.make} {item.car.model} <span className="text-gray-400 font-normal">{item.car.plate}</span></p>
                    <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                      {item.maintenance?.oil_change_date && (
                        <span>Дата замены: {format(parseISO(item.maintenance.oil_change_date), 'dd.MM.yyyy')}</span>
                      )}
                      {item.maintenance?.oil_change_miles && (
                        <span>Пробег: {item.maintenance.oil_change_miles.toLocaleString()} mi</span>
                      )}
                      {item.maintenance?.notes && (
                        <span className="text-gray-400">{item.maintenance.notes}</span>
                      )}
                      {!item.maintenance?.oil_change_date && !item.maintenance?.oil_change_miles && (
                        <span className="text-gray-400 italic">Данные не заполнены</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {item.daysUntil !== undefined && (
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${cfg.badge}`}>
                      {item.daysUntil < 0 ? `${Math.abs(item.daysUntil)} дн. назад` : item.daysUntil === 0 ? 'Сегодня' : `через ${item.daysUntil} дн.`}
                    </span>
                  )}
                  <button onClick={() => openEdit(item)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
                    <Edit2 size={16} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-1">Техобслуживание</h2>
            <p className="text-sm text-gray-500 mb-5">{editItem.car.make} {editItem.car.model} {editItem.car.plate}</p>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Дата следующей замены масла</label>
                <DatePicker value={form.oil_change_date} onChange={val => setForm(f => ({ ...f, oil_change_date: val }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Пробег для замены (мили)</label>
                <input type="number" value={form.oil_change_miles} onChange={e => setForm(f => ({ ...f, oil_change_miles: e.target.value }))} placeholder={`например ${OIL_INTERVAL_MILES}`} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Заметки</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium transition-colors">Сохранить</button>
                <button type="button" onClick={() => setEditItem(null)} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 rounded-lg text-sm font-medium transition-colors">Отмена</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

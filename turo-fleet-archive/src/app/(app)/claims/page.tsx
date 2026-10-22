'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { log } from '@/lib/logger'
import { Car } from '@/types'
import { Plus, X, Pencil, ChevronLeft, ChevronRight, Check, StickyNote } from 'lucide-react'
import { format, parseISO, startOfMonth, addMonths, subMonths, isSameMonth } from 'date-fns'
import { ru } from 'date-fns/locale'
import DatePicker from '@/components/ui/DatePicker'

interface Claim {
  id: string
  car_id: string | null
  status: 'waiting' | 'in_repair' | 'done'
  opened_date: string | null
  completed_date: string | null
  initial_payment_received: boolean
  supplement_paid: boolean
  still_listed: boolean
  notes: string | null
  created_at: string
  car?: Car
}

const STATUS_LABELS: Record<Claim['status'], string> = {
  waiting: 'Ожидает ремонта',
  in_repair: 'В ремонте',
  done: 'Завершён',
}

const emptyForm = {
  car_id: '',
  status: 'waiting' as Claim['status'],
  opened_date: '',
  completed_date: '',
  initial_payment_received: false,
  supplement_paid: false,
  still_listed: true,
  notes: '',
}

function today() {
  return format(new Date(), 'yyyy-MM-dd')
}

const short = (iso: string) => format(parseISO(iso), 'd MMM', { locale: ru })

// Дата, по которой завершённый клейм относится к месяцу
function doneDate(c: Claim): string | null {
  return c.completed_date || c.opened_date || c.created_at || null
}

function CarTitle({ c }: { c: Claim }) {
  return c.car ? (
    <>
      {c.car.make} {c.car.model} <span className="font-semibold text-gray-900">{c.car.plate}</span>
    </>
  ) : <span className="text-gray-400">— без авто —</span>
}

export default function ClaimsPage() {
  const [claims, setClaims] = useState<Claim[]>([])
  const [cars, setCars] = useState<Car[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editClaim, setEditClaim] = useState<Claim | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()))
  const [openNotes, setOpenNotes] = useState<string | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const [claimsRes, carsRes] = await Promise.all([
      supabase.from('claims').select('*, car:cars(*)').order('opened_date', { ascending: true }),
      supabase.from('cars').select('*').order('make'),
    ])
    setClaims((claimsRes.data as Claim[]) || [])
    setCars(carsRes.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openAdd() {
    setEditClaim(null)
    setForm({ ...emptyForm, opened_date: today() })
    setShowModal(true)
  }

  function openEdit(c: Claim) {
    setEditClaim(c)
    setForm({
      car_id: c.car_id || '',
      status: c.status,
      opened_date: c.opened_date || '',
      completed_date: c.completed_date || '',
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
      completed_date: form.status === 'done' ? (form.completed_date || today()) : null,
      initial_payment_received: form.initial_payment_received,
      supplement_paid: form.supplement_paid,
      still_listed: form.still_listed,
      notes: form.notes || null,
    }
    if (editClaim) {
      const { error } = await supabase.from('claims').update(payload).eq('id', editClaim.id)
      if (error) { alert(error.message); return }
      await log('update', 'claim', editClaim.id, payload)
    } else {
      const { data, error } = await supabase.from('claims').insert(payload).select().single()
      if (error) { alert(error.message); return }
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
    setShowModal(false)
    load()
  }

  async function toggleField(c: Claim, field: 'initial_payment_received' | 'supplement_paid') {
    const val = !c[field]
    setClaims(prev => prev.map(x => (x.id === c.id ? { ...x, [field]: val } : x)))
    const supabase = createClient()
    const { error } = await supabase.from('claims').update({ [field]: val }).eq('id', c.id)
    if (error) { alert(error.message); load(); return }
    await log('update', 'claim', c.id, { [field]: val })
  }

  async function setStatus(c: Claim, status: Claim['status']) {
    const supabase = createClient()
    const update = { status, completed_date: status === 'done' ? today() : null }
    const { error } = await supabase.from('claims').update(update).eq('id', c.id)
    if (error) { alert(error.message); return }
    await log('update', 'claim', c.id, update)
    load()
  }

  const waiting = claims.filter(c => c.status === 'waiting')
  const inRepair = claims.filter(c => c.status === 'in_repair')
  const done = claims
    .filter(c => {
      if (c.status !== 'done') return false
      const d = doneDate(c)
      return d ? isSameMonth(parseISO(d), month) : false
    })
    .sort((a, b) => (doneDate(b) || '').localeCompare(doneDate(a) || ''))
  const isCurrentMonth = isSameMonth(month, new Date())
  const monthLabel = format(month, 'LLLL yyyy', { locale: ru })

  // ── Строка активного клейма ──
  function ActiveRow({ c }: { c: Claim }) {
    const notesOpen = openNotes === c.id
    return (
      <div className="px-4 py-3">
        <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
          <div className="flex-1 min-w-[180px]">
            <p className="text-sm text-gray-700 truncate"><CarTitle c={c} /></p>
            <p className="text-xs text-gray-400 flex items-center gap-1.5 flex-wrap">
              {c.opened_date ? `открыт ${short(c.opened_date)}` : 'дата не указана'}
              {c.still_listed && <span className="text-purple-500">· листинг активен</span>}
              {c.notes && (
                <button onClick={() => setOpenNotes(notesOpen ? null : c.id)} className="inline-flex items-center gap-0.5 text-gray-400 hover:text-gray-600">
                  · <StickyNote size={11} /> заметка
                </button>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => toggleField(c, 'initial_payment_received')}
              title="Initial payment получен"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors ${c.initial_payment_received ? 'bg-green-50 text-green-700 border-green-200' : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'}`}
            >
              {c.initial_payment_received ? <Check size={11} /> : <span className="w-[11px] h-[11px] rounded-sm border border-gray-300" />} Initial
            </button>
            <button
              onClick={() => toggleField(c, 'supplement_paid')}
              title="Supplement оплачен"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors ${c.supplement_paid ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-500 border-red-200 hover:bg-red-100'}`}
            >
              {c.supplement_paid ? <Check size={11} /> : <span className="w-[11px] h-[11px] rounded-sm border border-red-300" />} Supplement
            </button>
          </div>
          <div className="flex items-center gap-1 ml-auto">
            {c.status === 'waiting' ? (
              <button onClick={() => setStatus(c, 'in_repair')} className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-600 border border-blue-100 hover:bg-blue-100 whitespace-nowrap">→ В ремонт</button>
            ) : (
              <button onClick={() => setStatus(c, 'done')} className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-green-50 text-green-600 border border-green-100 hover:bg-green-100 whitespace-nowrap">→ Завершить</button>
            )}
            <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600" title="Редактировать"><Pencil size={14} /></button>
          </div>
        </div>
        {notesOpen && c.notes && <p className="mt-2 text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">{c.notes}</p>}
      </div>
    )
  }

  function Section({ title, dot, items, empty }: { title: string; dot: string; items: Claim[]; empty: string }) {
    return (
      <div className="bg-white rounded-[18px] border border-gray-100/80 card-shadow overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
          <span className={`w-2 h-2 rounded-full ${dot}`} />
          <h2 className="text-sm font-bold text-gray-900">{title}</h2>
          <span className="text-xs font-semibold text-gray-400">{items.length}</span>
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-4 text-sm text-gray-400">{empty}</p>
        ) : (
          <div className="divide-y divide-gray-100">{items.map(c => <ActiveRow key={c.id} c={c} />)}</div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Клеймы и ремонт</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {loading ? 'Загрузка…' : `${waiting.length} ждут ремонта · ${inRepair.length} в ремонте`}
          </p>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus size={16} /> Добавить клейм
        </button>
      </div>

      {!loading && (
        <>
          <Section title="Ожидают ремонта" dot="bg-yellow-400" items={waiting} empty="Нет машин в очереди" />
          <Section title="В ремонте" dot="bg-blue-500" items={inRepair} empty="Сейчас в ремонте ничего нет" />

          {/* Завершённые — по месяцам, без Initial/Supplement */}
          <div className="bg-white rounded-[18px] border border-gray-100/80 card-shadow overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 flex-wrap">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <h2 className="text-sm font-bold text-gray-900">Завершены</h2>
              <span className="text-xs font-semibold text-gray-400">{done.length}</span>
              <div className="flex items-center gap-1 ml-auto">
                <button onClick={() => setMonth(m => subMonths(m, 1))} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100" aria-label="Предыдущий месяц"><ChevronLeft size={15} /></button>
                <span className="text-xs font-semibold text-gray-700 capitalize min-w-[100px] text-center">{monthLabel}</span>
                <button onClick={() => setMonth(m => addMonths(m, 1))} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100" aria-label="Следующий месяц"><ChevronRight size={15} /></button>
                {!isCurrentMonth && (
                  <button onClick={() => setMonth(startOfMonth(new Date()))} className="text-[11px] font-medium text-[#4F46E5] hover:underline ml-1">Текущий</button>
                )}
              </div>
            </div>
            {done.length === 0 ? (
              <p className="px-4 py-4 text-sm text-gray-400">В этом месяце завершённых нет</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {done.map(c => (
                  <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Check size={14} className="text-green-500 flex-shrink-0" />
                    <p className="flex-1 min-w-0 text-sm text-gray-700 truncate"><CarTitle c={c} /></p>
                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      завершён {c.completed_date ? short(c.completed_date) : '—'}
                    </span>
                    <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-gray-300 hover:bg-gray-100 hover:text-gray-600" title="Редактировать"><Pencil size={13} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold">{editClaim ? 'Редактировать клейм' : 'Новый клейм'}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
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
                <div className="grid grid-cols-3 gap-2">
                  {(['waiting', 'in_repair', 'done'] as const).map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, status: s }))}
                      className={`px-2 py-2 rounded-lg border text-xs font-semibold transition-colors ${form.status === s ? 'border-[#4F46E5] bg-indigo-50 text-[#4F46E5]' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                    >
                      {STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Открыт</label>
                  <DatePicker value={form.opened_date} onChange={val => setForm(f => ({ ...f, opened_date: val }))} />
                </div>
                {form.status === 'done' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Завершён</label>
                    <DatePicker value={form.completed_date} onChange={val => setForm(f => ({ ...f, completed_date: val }))} />
                  </div>
                )}
              </div>
              {form.status !== 'done' && (
                <div className="space-y-2.5">
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
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Заметки</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Описание повреждений, детали клейма..." rows={3} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>
              <div className="flex gap-3 pt-2">
                {editClaim && (
                  <button type="button" onClick={() => handleDelete(editClaim)} className="px-4 py-2 rounded-lg border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-colors">Удалить</button>
                )}
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

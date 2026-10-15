'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { log } from '@/lib/logger'
import { Car } from '@/types'
import { Plus, X, Check, Tag, History, CalendarDays } from 'lucide-react'
import { format, parseISO, addDays, differenceInCalendarDays } from 'date-fns'
import { ru } from 'date-fns/locale'
import DatePicker from '@/components/ui/DatePicker'

// Наклейки меняем раз в полтора месяца
const INTERVAL_DAYS = 45
// За сколько дней до срока подсвечивать жёлтым
const WARN_DAYS = 7

interface StickerCar {
  id: string
  car_id: string
  created_at: string
  car?: Car
}

interface StickerChange {
  id: string
  car_id: string
  changed_date: string
  created_at: string
}

type Level = 'overdue' | 'soon' | 'ok' | 'never'

interface Row {
  entry: StickerCar
  history: StickerChange[]
  last: string | null
  next: Date | null
  daysLeft: number | null
  level: Level
}

function today() {
  return format(new Date(), 'yyyy-MM-dd')
}

function fmt(d: string | Date) {
  return format(typeof d === 'string' ? parseISO(d) : d, 'd MMMM yyyy', { locale: ru })
}

function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  if (b === 1) return one
  return many
}

const LEVEL_STYLES: Record<Level, { card: string; badge: string; dot: string }> = {
  overdue: { card: 'border-red-200 bg-red-50/40', badge: 'bg-red-100 text-red-700 border-red-200', dot: 'bg-red-500' },
  never: { card: 'border-red-200 bg-red-50/40', badge: 'bg-red-100 text-red-700 border-red-200', dot: 'bg-red-500' },
  soon: { card: 'border-yellow-200 bg-yellow-50/40', badge: 'bg-yellow-100 text-yellow-700 border-yellow-200', dot: 'bg-yellow-400' },
  ok: { card: 'border-gray-100/80', badge: 'bg-green-100 text-green-700 border-green-200', dot: 'bg-green-500' },
}

function levelLabel(r: Row) {
  if (r.level === 'never') return 'Нет данных о замене'
  const d = r.daysLeft ?? 0
  if (d < 0) return `Пора менять · просрочено на ${-d} ${plural(-d, 'день', 'дня', 'дней')}`
  if (d === 0) return 'Пора менять · сегодня'
  return `Через ${d} ${plural(d, 'день', 'дня', 'дней')}`
}

export default function StickersPage() {
  const [entries, setEntries] = useState<StickerCar[]>([])
  const [changes, setChanges] = useState<StickerChange[]>([])
  const [cars, setCars] = useState<Car[]>([])
  const [loading, setLoading] = useState(true)

  const [showAdd, setShowAdd] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [addDate, setAddDate] = useState('')

  const [dateFor, setDateFor] = useState<Row | null>(null)
  const [customDate, setCustomDate] = useState('')

  const [openHistory, setOpenHistory] = useState<string | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const [eRes, cRes, carsRes] = await Promise.all([
      supabase.from('sticker_cars').select('*, car:cars(*)').order('created_at'),
      supabase.from('sticker_changes').select('*').order('changed_date', { ascending: false }),
      supabase.from('cars').select('*').order('make'),
    ])
    if (eRes.error) alert(eRes.error.message)
    setEntries((eRes.data as StickerCar[]) || [])
    setChanges((cRes.data as StickerChange[]) || [])
    setCars(carsRes.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const now = new Date()
  const rows: Row[] = entries.map(entry => {
    const history = changes.filter(c => c.car_id === entry.car_id)
    const last = history[0]?.changed_date ?? null
    if (!last) return { entry, history, last, next: null, daysLeft: null, level: 'never' as Level }
    const next = addDays(parseISO(last), INTERVAL_DAYS)
    const daysLeft = differenceInCalendarDays(next, now)
    const level: Level = daysLeft <= 0 ? 'overdue' : daysLeft <= WARN_DAYS ? 'soon' : 'ok'
    return { entry, history, last, next, daysLeft, level }
  }).sort((a, b) => {
    const da = a.daysLeft ?? -99999
    const db = b.daysLeft ?? -99999
    return da - db
  })

  const overdue = rows.filter(r => r.level === 'overdue' || r.level === 'never').length
  const soon = rows.filter(r => r.level === 'soon').length
  const ok = rows.filter(r => r.level === 'ok').length

  const addedIds = new Set(entries.map(e => e.car_id))
  const available = cars.filter(c => !c.delisted && !addedIds.has(c.id))

  function carName(c?: Car) {
    return c ? `${c.make} ${c.model} ${c.plate}` : '— авто удалено —'
  }

  function openAddModal() {
    setSelected([])
    setAddDate('')
    setShowAdd(true)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (selected.length === 0) return
    const supabase = createClient()
    const { error } = await supabase.from('sticker_cars').insert(selected.map(car_id => ({ car_id })))
    if (error) { alert(error.message); return }
    if (addDate) {
      const { error: chErr } = await supabase.from('sticker_changes').insert(selected.map(car_id => ({ car_id, changed_date: addDate })))
      if (chErr) { alert(chErr.message); return }
    }
    await log('create', 'sticker_car', selected.join(','), { cars: selected, changed_date: addDate || null })
    setShowAdd(false)
    load()
  }

  async function recordChange(carId: string, date: string) {
    const supabase = createClient()
    const { data, error } = await supabase.from('sticker_changes').insert({ car_id: carId, changed_date: date }).select().single()
    if (error) { alert(error.message); return }
    if (data) await log('create', 'sticker_change', data.id, { car_id: carId, changed_date: date })
    load()
  }

  async function deleteChange(ch: StickerChange) {
    if (!confirm(`Удалить запись о замене от ${fmt(ch.changed_date)}?`)) return
    const supabase = createClient()
    await supabase.from('sticker_changes').delete().eq('id', ch.id)
    await log('delete', 'sticker_change', ch.id, { car_id: ch.car_id, changed_date: ch.changed_date })
    load()
  }

  async function removeCar(r: Row) {
    if (!confirm(`Убрать ${carName(r.entry.car)} из раздела «Наклейки»? История замен тоже удалится.`)) return
    const supabase = createClient()
    await supabase.from('sticker_changes').delete().eq('car_id', r.entry.car_id)
    await supabase.from('sticker_cars').delete().eq('id', r.entry.id)
    await log('delete', 'sticker_car', r.entry.id, { car_id: r.entry.car_id })
    load()
  }

  async function handleCustomDate(e: React.FormEvent) {
    e.preventDefault()
    if (!dateFor || !customDate) return
    await recordChange(dateFor.entry.car_id, customDate)
    setDateFor(null)
  }

  return (
    <div className="p-0 sm:p-2">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Наклейки</h1>
          <p className="text-sm text-gray-400 mt-0.5">Замена наклеек каждые {INTERVAL_DAYS} дней (полтора месяца)</p>
        </div>
        <button
          onClick={openAddModal}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} /> Добавить машины
        </button>
      </div>

      {/* Summary chips */}
      {rows.length > 0 && (
        <div className="flex gap-2 mb-5 flex-wrap">
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <span className="text-sm font-semibold text-red-700">{overdue} пора менять</span>
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-400" />
            <span className="text-sm font-semibold text-yellow-700">{soon} скоро (≤ {WARN_DAYS} дн.)</span>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-sm font-semibold text-green-700">{ok} в порядке</span>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? null : rows.length === 0 ? (
        <div className="bg-white rounded-[18px] p-12 card-shadow border border-gray-100/80 text-center">
          <Tag size={32} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm font-medium">Пока нет машин</p>
          <p className="text-gray-400 text-sm mt-1">Нажми «Добавить машины» и выбери авто из списка</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(r => {
            const st = LEVEL_STYLES[r.level]
            const showHist = openHistory === r.entry.id
            return (
              <div key={r.entry.id} className={`bg-white rounded-[18px] p-5 card-shadow border ${st.card}`}>
                <div className="flex items-start justify-between gap-4 flex-wrap sm:flex-nowrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <span className="font-semibold text-gray-800">{carName(r.entry.car)}</span>
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${st.badge}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                        {levelLabel(r)}
                      </span>
                    </div>
                    <div className="flex gap-x-5 gap-y-1 flex-wrap text-xs text-gray-500">
                      <span>Последняя замена: <b className="text-gray-700 font-medium">{r.last ? fmt(r.last) : '—'}</b></span>
                      <span>Следующая: <b className="text-gray-700 font-medium">{r.next ? fmt(r.next) : 'сразу'}</b></span>
                    </div>

                    {r.history.length > 0 && (
                      <button
                        onClick={() => setOpenHistory(showHist ? null : r.entry.id)}
                        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-gray-600"
                      >
                        <History size={13} /> История замен ({r.history.length})
                      </button>
                    )}
                    {showHist && (
                      <ul className="mt-2 space-y-1">
                        {r.history.map(h => (
                          <li key={h.id} className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-1.5 w-fit">
                            <Check size={13} className="text-green-500" />
                            {fmt(h.changed_date)}
                            <button onClick={() => deleteChange(h)} className="ml-1 text-gray-300 hover:text-red-500" aria-label="Удалить запись">
                              <X size={13} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0 flex-wrap">
                    <button
                      onClick={() => recordChange(r.entry.car_id, today())}
                      className="inline-flex items-center gap-1.5 text-xs bg-green-50 hover:bg-green-100 text-green-700 font-semibold px-3 py-1.5 rounded-lg border border-green-200 transition-colors whitespace-nowrap"
                    >
                      <Check size={14} /> Поменял сегодня
                    </button>
                    <button
                      onClick={() => { setDateFor(r); setCustomDate(today()) }}
                      title="Указать другую дату замены"
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <CalendarDays size={15} />
                    </button>
                    <button
                      onClick={() => removeCar(r)}
                      title="Убрать из раздела"
                      className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add cars modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-1">Добавить машины</h2>
            <p className="text-sm text-gray-400 mb-4">Выбери авто, для которых нужно следить за наклейками</p>
            <form onSubmit={handleAdd} className="space-y-4">
              {available.length === 0 ? (
                <p className="text-sm text-gray-500 bg-gray-50 rounded-lg px-3 py-3">Все машины уже добавлены</p>
              ) : (
                <div className="border rounded-lg divide-y max-h-72 overflow-y-auto">
                  {available.map(c => (
                    <label key={c.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={selected.includes(c.id)}
                        onChange={e => setSelected(s => e.target.checked ? [...s, c.id] : s.filter(id => id !== c.id))}
                        className="w-4 h-4 rounded accent-blue-600"
                      />
                      <span className="text-sm text-gray-700">{c.make} {c.model} <span className="text-gray-400">{c.plate}</span></span>
                    </label>
                  ))}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Когда последний раз меняли наклейки (необязательно)</label>
                <DatePicker value={addDate} onChange={val => setAddDate(val)} />
                <p className="text-xs text-gray-400 mt-1">Дата применится ко всем выбранным машинам. Если не указать — они будут отмечены красным, пока не отметишь замену.</p>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={selected.length === 0} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium transition-colors">
                  Добавить{selected.length > 0 ? ` (${selected.length})` : ''}
                </button>
                <button type="button" onClick={() => setShowAdd(false)} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 rounded-lg text-sm font-medium transition-colors">Отмена</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Custom date modal */}
      {dateFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-semibold mb-1">Дата замены</h2>
            <p className="text-sm text-gray-400 mb-4">{carName(dateFor.entry.car)}</p>
            <form onSubmit={handleCustomDate} className="space-y-4">
              <DatePicker value={customDate} onChange={val => setCustomDate(val)} />
              <div className="flex gap-3 pt-2">
                <button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium transition-colors">Сохранить</button>
                <button type="button" onClick={() => setDateFor(null)} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 rounded-lg text-sm font-medium transition-colors">Отмена</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

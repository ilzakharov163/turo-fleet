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

const LEVEL_STYLES: Record<Level, { card: string; badge: string; dot: string; text: string }> = {
  overdue: { card: 'border-red-200 bg-red-50/40', badge: 'bg-red-100 text-red-700 border-red-200', dot: 'bg-red-500', text: 'text-red-600' },
  never: { card: 'border-red-200 bg-red-50/40', badge: 'bg-red-100 text-red-700 border-red-200', dot: 'bg-red-500', text: 'text-red-600' },
  soon: { card: 'border-yellow-200 bg-yellow-50/40', badge: 'bg-yellow-100 text-yellow-700 border-yellow-200', dot: 'bg-yellow-400', text: 'text-yellow-700' },
  ok: { card: 'border-gray-100/80', badge: 'bg-green-100 text-green-700 border-green-200', dot: 'bg-green-500', text: 'text-green-700' },
}

function fmtShort(d: string | Date) {
  return format(typeof d === 'string' ? parseISO(d) : d, 'd MMM', { locale: ru })
}

function shortLabel(r: Row) {
  if (r.level === 'never') return 'нет данных'
  const d = r.daysLeft ?? 0
  if (d < 0) return `просрочено ${-d} ${plural(-d, 'день', 'дня', 'дней')}`
  if (d === 0) return 'менять сегодня'
  return `через ${d} ${plural(d, 'день', 'дня', 'дней')}`
}

type Filter = 'all' | 'due' | 'soon' | 'ok'

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
  const [filter, setFilter] = useState<Filter>('all')

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

  const FILTERS: { key: Filter; label: string; count: number; active: string; idle: string; dot: string }[] = [
    { key: 'all', label: 'Все', count: rows.length, active: 'bg-[#4F46E5] text-white border-[#4F46E5]', idle: 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50', dot: 'bg-gray-300' },
    { key: 'due', label: 'Пора менять', count: overdue, active: 'bg-red-600 text-white border-red-600', idle: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100', dot: 'bg-red-500' },
    { key: 'soon', label: 'Скоро', count: soon, active: 'bg-yellow-500 text-white border-yellow-500', idle: 'bg-yellow-50 text-yellow-700 border-yellow-200 hover:bg-yellow-100', dot: 'bg-yellow-400' },
    { key: 'ok', label: 'В порядке', count: ok, active: 'bg-green-600 text-white border-green-600', idle: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100', dot: 'bg-green-500' },
  ]

  const visible = rows.filter(r => {
    if (filter === 'all') return true
    if (filter === 'due') return r.level === 'overdue' || r.level === 'never'
    return r.level === filter
  })

  return (
    <div className="p-0 sm:p-2">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Наклейки</h1>
          <p className="text-sm text-gray-400 mt-0.5">Замена каждые {INTERVAL_DAYS} дней · жёлтым за {WARN_DAYS} дней до срока</p>
        </div>
        <button
          onClick={openAddModal}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} /> Добавить машины
        </button>
      </div>

      {/* Filter switcher */}
      {rows.length > 0 && (
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {FILTERS.map(f => {
            const isActive = filter === f.key
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`flex-shrink-0 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-colors ${isActive ? f.active : f.idle}`}
              >
                {f.key !== 'all' && <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-white' : f.dot}`} />}
                {f.label}
                <span className={`min-w-[20px] px-1.5 rounded-full text-xs leading-5 text-center ${isActive ? 'bg-white/25' : 'bg-white/70'}`}>{f.count}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* List */}
      {loading ? null : rows.length === 0 ? (
        <div className="bg-white rounded-[18px] p-10 card-shadow border border-gray-100/80 text-center">
          <Tag size={28} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm font-medium">Пока нет машин</p>
          <p className="text-gray-400 text-sm mt-1">Нажми «Добавить машины» и выбери авто из списка</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-white rounded-[18px] p-8 card-shadow border border-gray-100/80 text-center text-sm text-gray-400">
          В этой группе машин нет
        </div>
      ) : (
        <div className="bg-white rounded-[18px] card-shadow border border-gray-100/80 overflow-hidden divide-y divide-gray-100">
          {visible.map(r => {
            const st = LEVEL_STYLES[r.level]
            const showHist = openHistory === r.entry.id
            const car = r.entry.car
            return (
              <div key={r.entry.id} className={r.level === 'overdue' || r.level === 'never' ? 'bg-red-50/40' : r.level === 'soon' ? 'bg-yellow-50/40' : ''}>
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${st.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-800 truncate">
                      {car ? <>{car.make} {car.model} <span className="font-normal text-gray-400">{car.plate}</span></> : '— авто удалено —'}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      <span className={`font-semibold ${st.text}`}>{shortLabel(r)}</span>
                      <span className="text-gray-300"> · </span>
                      {r.last ? <>замена {fmtShort(r.last)}</> : 'замен не было'}
                      {r.next && <span className="sm:hidden"><span className="text-gray-300"> · </span>до {fmtShort(r.next)}</span>}
                    </div>
                  </div>
                  <div className="hidden sm:block text-xs text-gray-400 text-right w-32 flex-shrink-0">
                    {r.next ? <>Следующая<br /><span className="text-gray-700 font-medium">{fmt(r.next)}</span></> : <span className="text-red-500 font-medium">Нужна замена</span>}
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button
                      onClick={() => recordChange(r.entry.car_id, today())}
                      title="Поменял сегодня"
                      className="inline-flex items-center gap-1 text-xs bg-green-50 hover:bg-green-100 text-green-700 font-semibold px-2.5 py-1.5 rounded-lg border border-green-200 transition-colors"
                    >
                      <Check size={14} /><span className="hidden sm:inline">Поменял</span>
                    </button>
                    <button
                      onClick={() => { setDateFor(r); setCustomDate(today()) }}
                      title="Указать другую дату замены"
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <CalendarDays size={15} />
                    </button>
                    <button
                      onClick={() => setOpenHistory(showHist ? null : r.entry.id)}
                      title="История замен"
                      className={`p-1.5 rounded-lg transition-colors ${showHist ? 'bg-gray-100 text-gray-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'}`}
                    >
                      <History size={15} />
                    </button>
                    <button
                      onClick={() => removeCar(r)}
                      title="Убрать из раздела"
                      className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>
                {showHist && (
                  <div className="px-4 pb-3 pl-9 flex flex-wrap gap-1.5">
                    {r.history.length === 0 ? (
                      <span className="text-xs text-gray-400">Замен ещё не было</span>
                    ) : r.history.map(h => (
                      <span key={h.id} className="inline-flex items-center gap-1 text-xs text-gray-600 bg-white border border-gray-200 rounded-full pl-2.5 pr-1 py-0.5">
                        {fmt(h.changed_date)}
                        <button onClick={() => deleteChange(h)} className="p-0.5 text-gray-300 hover:text-red-500" aria-label="Удалить запись">
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
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
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-72 overflow-y-auto">
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

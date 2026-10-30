'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { log } from '@/lib/logger'
import { Car, CarBlock } from '@/types'
import { Plus, CheckCircle, XCircle, Trash2, Edit2, Search, EyeOff, Eye, RotateCcw, ChevronDown, Check } from 'lucide-react'
import { Card, Modal, FormField, inputCls, ModalActions, SaveButton, CancelButton } from '@/components/ui/PageShell'
import DatePicker from '@/components/ui/DatePicker'
import CarCard from '@/components/CarCard'
import UnlistSheet from '@/components/UnlistSheet'
import PlateHistory from '@/components/PlateHistory'
import Popover from '@/components/ui/Popover'
import { loadCarAccounts, type CarAccount } from '@/lib/carAccounts'
import { hasCyrillic, latinPlate } from '@/lib/plates'
import { restoreCar } from '@/lib/fleet'
import { canAny, useAccess } from '@/lib/access'
import { ask, notify } from '@/lib/ui'
import { ru } from 'date-fns/locale'
import { format, parseISO } from 'date-fns'

function fmtDate(d: string) {
  return d ? format(parseISO(d), 'MM/dd/yyyy') : ''
}

export default function CarsView() {
  const [cars, setCars] = useState<Car[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editCar, setEditCar] = useState<Car | null>(null)
  const [inactiveModal, setInactiveModal] = useState<Car | null>(null)
  const [inactiveReason, setInactiveReason] = useState('')
  const [inactiveDate, setInactiveDate] = useState('')
  const [inactiveEndDate, setInactiveEndDate] = useState('')
  const [deleteModal, setDeleteModal] = useState<Car | null>(null)
  const [editBlock, setEditBlock] = useState<CarBlock | null>(null)
  const [editBlockForm, setEditBlockForm] = useState({ start_date: '', end_date: '', reason: '' })
  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'work' | 'idle'>('all')   // фильтр списка — карточки сверху
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [form, setForm] = useState({ make: '', model: '', plate: '', owner_group: 'main' as string })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const rowRefs = useRef<Record<string, HTMLElement | null>>({})
  const [carBlocks, setCarBlocks] = useState<CarBlock[]>([])
  const [openCar, setOpenCar] = useState<Car | null>(null)
  const [unlistCar, setUnlistCar] = useState<Car | null>(null)
  const access = useAccess()
  // Фильтр по аккаунту «Доходов» ('' — все)
  const [accFilter, setAccFilter] = useState('')
  const [carAcc, setCarAcc] = useState<{ accounts: CarAccount[]; byCar: Record<string, CarAccount> }>({ accounts: [], byCar: {} })

  async function load() {
    const supabase = createClient()
    const [carsRes, blocksRes, accs] = await Promise.all([
      supabase.from('cars').select('*').order('make').order('model'),
      supabase.from('car_blocks').select('*').order('start_date', { ascending: false }),
      loadCarAccounts(),
    ])
    setCarAcc(accs)
    setCars(carsRes.data || [])
    setCarBlocks(blocksRes.data || [])
    setLoading(false)
  }

  async function handleSaveBlock(e: React.FormEvent) {
    e.preventDefault()
    if (!editBlock) return
    const supabase = createClient()
    await supabase.from('car_blocks').update({
      start_date: editBlockForm.start_date,
      end_date: editBlockForm.end_date || null,
      reason: editBlockForm.reason || null,
    }).eq('id', editBlock.id)
    await log('update', 'car_block', editBlock.id, {
      start_date: editBlockForm.start_date,
      end_date: editBlockForm.end_date || null,
      reason: editBlockForm.reason || null,
    })
    setEditBlock(null)
    load()
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect -- загрузка данных при открытии
  useEffect(() => { load() }, [])

  // Статус машины — только по простоям: в простое, если сегодня попадает в простой
  const today = format(new Date(), 'yyyy-MM-dd')
  const idleOf = (carId: string) => carBlocks.find(b => b.car_id === carId && b.start_date <= today && (!b.end_date || b.end_date >= today))
  const shownBlock = (carId: string) => idleOf(carId)
    || carBlocks.filter(b => b.car_id === carId && b.start_date > today).sort((a, b) => a.start_date.localeCompare(b.start_date))[0]

  function validate(f: typeof form) {
    const errors: Record<string, string> = {}
    if (!f.make.trim()) errors.make = 'Введите марку'
    if (!f.model.trim()) errors.model = 'Введите модель'
    if (!f.plate.trim()) errors.plate = 'Введите номер'
    else if (hasCyrillic(f.plate)) errors.plate = 'Номер латиницей — переключите раскладку на английскую'
    return errors
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const errors = validate(form)
    if (Object.keys(errors).length) { setFormErrors(errors); return }
    const supabase = createClient()
    const { data } = await supabase.from('cars').insert(form).select().single()
    if (data) {
      await log('create', 'car', data.id, form)
      setShowAdd(false); setForm({ make: '', model: '', plate: '', owner_group: 'main' }); setFormErrors({}); load()
    }
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    const errors = validate(form)
    if (Object.keys(errors).length) { setFormErrors(errors); return }
    if (!editCar) return
    const supabase = createClient()
    await supabase.from('cars').update({ ...form, updated_at: new Date().toISOString() }).eq('id', editCar.id)
    await log('update', 'car', editCar.id, { old: { make: editCar.make, model: editCar.model }, new: form })
    setEditCar(null); setFormErrors({}); load()
  }

  async function handleDelete() {
    if (!deleteModal) return
    const supabase = createClient()
    await supabase.from('cars').delete().eq('id', deleteModal.id)
    await log('delete', 'car', deleteModal.id, { make: deleteModal.make, model: deleteModal.model, plate: deleteModal.plate })
    setDeleteModal(null); load()
  }

  async function handleToggleInactive() {
    if (!inactiveModal) return
    const supabase = createClient()
    const current = idleOf(inactiveModal.id)
    const newStatus = current ? 'active' : 'inactive'
    const yesterday = format(new Date(Date.now() - 86400000), 'yyyy-MM-dd')

    if (newStatus === 'inactive') {
      const { error } = await supabase.from('car_blocks').insert({
        car_id: inactiveModal.id,
        start_date: inactiveDate || today,
        end_date: inactiveEndDate || null,
        reason: inactiveReason || null,
      })
      if (error) return
    } else if (current) {
      // Вернуть в работу: простой заканчивается вчера (если начался сегодня — простоя не было)
      const { error } = current.start_date >= today
        ? await supabase.from('car_blocks').delete().eq('id', current.id)
        : await supabase.from('car_blocks').update({ end_date: yesterday }).eq('id', current.id)
      if (error) return
    }

    await supabase.from('cars').update({ status: newStatus, inactive_reason: newStatus === 'inactive' ? inactiveReason : null, updated_at: new Date().toISOString() }).eq('id', inactiveModal.id)
    await log('status_change', 'car', inactiveModal.id, { status: newStatus, reason: inactiveReason })
    setInactiveModal(null); setInactiveReason(''); setInactiveDate(''); setInactiveEndDate(''); load()
  }

  async function handleRestore(car: Car) {
    if (!await ask(`Вернуть ${car.make} ${car.model} ${car.plate} в парк?`, { detail: 'Машина снова появится в списках, зарплате и в «Доходах».', ok: 'Вернуть' })) return
    const ok = await restoreCar({ carId: car.id, from: car.removed_from || null, canFleet: true, canIncome: canAny(access, ['/income']) })
    if (ok) { notify('Машина возвращена', 'success'); load() }
  }

  // «Снять с листинга» — окно с причиной (клейм / другая); «Вернуть в листинг» — для старых снятых машин
  function onListingClick(car: Car) {
    if (car.delisted) handleToggleDelisted(car)
    else setUnlistCar(car)
  }

  async function handleToggleDelisted(car: Car) {
    const supabase = createClient()
    const newDelisted = !car.delisted
    await supabase.from('cars').update({ delisted: newDelisted, updated_at: new Date().toISOString() }).eq('id', car.id)
    await log('update', 'car', car.id, { delisted: newDelisted })
    load()
  }

  function openEdit(car: Car) { setEditCar(car); setForm({ make: car.make, model: car.model, plate: car.plate, owner_group: 'main' }); setFormErrors({}) }

  function handleSearchSelect(car: Car) {
    setSearchQuery('')
    setHighlightId(car.id)
    setTimeout(() => {
      rowRefs.current[car.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 50)
    setTimeout(() => setHighlightId(null), 2000)
  }

  const searchResults = searchQuery.length > 0
    ? cars.filter(c =>
        `${c.make} ${c.model} ${c.plate}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.plate.toLowerCase().includes(searchQuery.toLowerCase())
      ).slice(0, 6)
    : []

  // Убранные (проданы/разбиты) с текущего месяца — в отдельном списке внизу
  const curP = format(new Date(), 'yyyy-MM-01')
  const fleetCars = cars.filter(c => !c.removed_from || c.removed_from > curP)
  const goneCars = cars.filter(c => c.removed_from && c.removed_from <= curP)
  const leavingLabel = (c: Car) => c.removed_from && c.removed_from > curP ? `Уходит с ${format(parseISO(c.removed_from), 'MMMM', { locale: ru })}` : ''
  const inactiveCount = fleetCars.filter(c => idleOf(c.id)).length
  const activeCount = fleetCars.length - inactiveCount
  const byStatus = fleetCars.filter(c => filter === 'all' || (filter === 'idle') === !!idleOf(c.id))
  const listCars = byStatus.filter(c => !accFilter || (accFilter === '-' ? !carAcc.byCar[c.id] : carAcc.byCar[c.id]?.key === accFilter))
  const accCount = (key: string) => byStatus.filter(c => key === '-' ? !carAcc.byCar[c.id] : carAcc.byCar[c.id]?.key === key).length
  const accSel = carAcc.accounts.find(a => a.key === accFilter)


  return (
    <div className="space-y-5">
      {/* Сводка — она же фильтр списка: нажмите «В работе» или «В простое» */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {([
          { key: 'all', label: 'Все', value: fleetCars.length, color: 'text-gray-900', on: 'ring-[#4F46E5] bg-indigo-50' },
          { key: 'work', label: 'В работе', value: activeCount, color: 'text-emerald-600', on: 'ring-emerald-500 bg-emerald-50' },
          { key: 'idle', label: 'В простое', value: inactiveCount, color: 'text-red-500', on: 'ring-red-400 bg-red-50' },
        ] as const).map(s => (
          <button key={s.key} onClick={() => setFilter(s.key)} aria-pressed={filter === s.key}
            className={`text-left rounded-[18px] p-3 sm:p-4 border border-gray-100/80 card-shadow min-w-0 transition-colors ${filter === s.key ? `ring-2 ${s.on}` : 'bg-white'}`}>
            <p className="text-xs text-gray-500 font-medium mb-1 truncate">{s.label}</p>
            <p className={`text-2xl sm:text-3xl font-bold tabular-nums ${s.color}`}>{loading ? '—' : s.value}</p>
          </button>
        ))}
      </div>

      <Card>
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">
            {filter === 'all' ? 'Автомобили' : filter === 'work' ? 'В работе' : 'В простое'}
            {filter !== 'all' && <button onClick={() => setFilter('all')} className="ml-2 text-xs font-medium text-[#4F46E5] dark:text-indigo-300">показать все</button>}
          </h2>
          {carAcc.accounts.length > 0 && (
            <Popover panelClass="sm:w-72" className="mr-auto"
              trigger={(open, toggle) => (
                <button onClick={toggle} className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-xs font-medium transition-colors ${accFilter ? 'bg-indigo-50 border-indigo-200 text-[#4F46E5] dark:text-indigo-300' : 'bg-white border-gray-200 text-gray-600'} ${open ? 'ring-2 ring-indigo-400/20' : ''}`}>
                  {accSel ? <span className={`w-2 h-2 rounded-full ${accSel.dot}`} /> : null}
                  <span className="max-w-[110px] truncate">{accSel ? accSel.label : accFilter === '-' ? 'Без аккаунта' : 'Все аккаунты'}</span>
                  <ChevronDown size={13} className="text-gray-400" />
                </button>
              )}>
              {close => (
                <div className="p-2">
                  <p className="px-2 pt-1 pb-2 text-sm font-semibold text-gray-900">Аккаунт</p>
                  {[{ key: '', label: 'Все аккаунты', dot: '' }, ...carAcc.accounts, { key: '-', label: 'Без аккаунта', dot: 'bg-gray-300' }].map(a => {
                    const n = a.key ? accCount(a.key) : byStatus.length
                    // Аккаунты и «Без аккаунта», где в парке нет машин, не показываем
                    if (a.key && !fleetCars.some(c => a.key === '-' ? !carAcc.byCar[c.id] : carAcc.byCar[c.id]?.key === a.key)) return null
                    return (
                      <button key={a.key || 'all'} onClick={() => { setAccFilter(a.key); close() }}
                        className={`w-full flex items-center gap-3 px-2 py-2.5 rounded-xl text-left ${accFilter === a.key ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}>
                        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${a.dot || 'border border-gray-300'}`} />
                        <span className="flex-1 min-w-0 truncate text-sm text-gray-800">{a.label}</span>
                        <span className="text-xs tabular-nums text-gray-400">{n}</span>
                        {accFilter === a.key && <Check size={14} className="text-[#4F46E5]" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </Popover>
          )}
          <button
            onClick={() => { setShowAdd(true); setForm({ make: '', model: '', plate: '', owner_group: 'main' }); setFormErrors({}) }}
            className="btn-primary flex items-center gap-2 px-4 py-2"
          >
            <Plus size={15} /> <span className="hidden sm:inline">Добавить авто</span><span className="sm:hidden">Добавить</span>
          </button>
        </div>

        {/* Search */}
        <div className="px-4 sm:px-6 py-3 border-b border-gray-100 relative">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Поиск по номеру или названию..."
              className="w-full pl-9 pr-4 py-2 text-base sm:text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-400/30 focus:border-indigo-400"
            />
          </div>
          <div className="mt-2 flex justify-end"><PlateHistory cars={cars} /></div>
          {searchResults.length > 0 && (
            <div className="absolute left-4 right-4 sm:left-6 sm:right-6 top-full mt-1 bg-white rounded-[14px] border border-gray-100 py-1.5 z-50"
              style={{ boxShadow: '0 8px 28px rgba(17,17,26,0.12), 0 2px 8px rgba(17,17,26,0.06)' }}>
              {searchResults.map(car => (
                <button
                  key={car.id}
                  onClick={() => handleSearchSelect(car)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-gray-100 transition-colors text-left"
                >
                  <span className="font-medium text-gray-900">{car.make} {car.model}</span>
                  <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded-lg text-gray-600">{car.plate}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div className="p-4"><div className="space-y-3">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-16" />)}</div></div>
        ) : (<>
          {/* Телефон — карточки */}
          <div className="sm:hidden divide-y divide-gray-100">
            {listCars.map(car => {
              const block = shownBlock(car.id)
              return (
                <div
                  key={car.id}
                  ref={el => { rowRefs.current[car.id] = el }}
                  className={`px-4 py-3.5 transition-colors ${highlightId === car.id ? 'bg-indigo-50' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <button onClick={() => setOpenCar(car)} className="block max-w-full text-left font-semibold text-gray-900 truncate">{car.make} {car.model}</button>
                      <span className="inline-block mt-1 bg-gray-100 text-gray-600 px-2 py-0.5 rounded-lg text-xs font-mono font-semibold">{car.plate}</span>
                      {leavingLabel(car) && <span className="inline-block mt-1 ml-1.5 bg-orange-50 text-orange-600 px-2 py-0.5 rounded-lg text-xs font-semibold">{leavingLabel(car)}</span>}
                    </div>
                    <button
                      onClick={() => (idleOf(car.id) ? setInactiveModal(car) : setUnlistCar(car))}
                      className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold ${
                        !idleOf(car.id) ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'
                      }`}
                    >
                      {!idleOf(car.id) ? <CheckCircle size={12} /> : <XCircle size={12} />}
                      {!idleOf(car.id) ? 'В работе' : 'В простое'}
                    </button>
                  </div>
                  {block && (
                    <button
                      onClick={() => { setEditBlock(block); setEditBlockForm({ start_date: block.start_date, end_date: block.end_date || '', reason: block.reason || '' }) }}
                      className="mt-2 w-full text-left text-xs text-gray-500 bg-gray-50 rounded-lg px-2.5 py-1.5 flex items-center gap-2"
                    >
                      <span className="flex-1 min-w-0 truncate">
                        {block.start_date > today ? 'с ' : ''}{`${fmtDate(block.start_date)}${block.end_date ? ` — ${fmtDate(block.end_date)}` : ''}${block.reason ? ` · ${block.reason}` : ''}`}
                      </span>
                      <Edit2 size={12} className="flex-shrink-0 text-gray-400" />
                    </button>
                  )}
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <button
                      onClick={() => onListingClick(car)}
                      className={`flex-1 h-9 rounded-xl px-2.5 flex items-center justify-center gap-1.5 text-xs font-medium ${car.delisted ? 'bg-orange-50 text-orange-500' : 'bg-gray-50 text-gray-500'}`}
                    >
                      {car.delisted ? <><Eye size={13} /> Вернуть в листинг</> : <><EyeOff size={13} /> Снять с листинга</>}
                    </button>
                    <button onClick={() => openEdit(car)} className="w-9 h-9 rounded-xl bg-gray-50 text-gray-500 flex items-center justify-center"><Edit2 size={15} /></button>
                    <button onClick={() => setDeleteModal(car)} className="w-9 h-9 rounded-xl bg-gray-50 text-gray-400 flex items-center justify-center"><Trash2 size={15} /></button>
                  </div>
                </div>
              )
            })}
            {listCars.length === 0 && <p className="px-4 py-12 text-center text-gray-400 text-sm">{filter === 'idle' ? 'Сейчас в простое никого нет' : filter === 'work' ? 'Нет машин в работе' : 'Авто не добавлено'}</p>}
          </div>

          {/* Компьютер — таблица */}
          <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 uppercase tracking-wider bg-gray-50/60">
                <th className="px-6 py-3 font-medium">Авто</th>
                <th className="px-6 py-3 font-medium">Номер</th>
                <th className="px-6 py-3 font-medium">Статус</th>
                <th className="px-6 py-3 font-medium">Причина</th>
                <th className="px-6 py-3 font-medium text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {listCars.map(car => (
                <tr
                  key={car.id}
                  ref={el => { rowRefs.current[car.id] = el }}
                  className={`transition-colors ${highlightId === car.id ? 'bg-indigo-50' : 'hover:bg-gray-50/60'}`}
                >
                  <td className="px-6 py-4 font-semibold text-gray-900">
                    <button onClick={() => setOpenCar(car)} className="hover:text-[#4F46E5] hover:underline underline-offset-2 text-left">{car.make} {car.model}</button>
                  </td>
                  <td className="px-6 py-4">
                    <span className="bg-gray-100 text-gray-600 px-2.5 py-1 rounded-lg text-xs font-mono font-semibold">{car.plate}</span>
                    {leavingLabel(car) && <span className="ml-2 bg-orange-50 text-orange-600 px-2 py-1 rounded-lg text-xs font-semibold whitespace-nowrap">{leavingLabel(car)}</span>}
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => (idleOf(car.id) ? setInactiveModal(car) : setUnlistCar(car))}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                        !idleOf(car.id)
                          ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                          : 'bg-red-50 text-red-500 hover:bg-red-100'
                      }`}
                    >
                      {!idleOf(car.id) ? <CheckCircle size={12} /> : <XCircle size={12} />}
                      {!idleOf(car.id) ? 'В работе' : 'В простое'}
                    </button>
                  </td>
                  <td className="px-6 py-4 text-gray-400 text-xs">
                    {(() => {
                      const block = shownBlock(car.id)
                      if (!block) return '—'
                      return (
                        <span className="flex items-center gap-2">
                          <span>{fmtDate(block.start_date)} {block.end_date ? `— ${fmtDate(block.end_date)}` : ''}{block.reason ? ` · ${block.reason}` : ''}</span>
                          <button onClick={() => { setEditBlock(block); setEditBlockForm({ start_date: block.start_date, end_date: block.end_date || '', reason: block.reason || '' }) }}
                            className="text-gray-300 hover:text-blue-500 transition-colors"><Edit2 size={12} /></button>
                        </span>
                      )
                    })()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => onListingClick(car)}
                        title={car.delisted ? 'Вернуть в листинг' : 'Снять с листинга'}
                        className={`h-8 rounded-xl px-2.5 flex items-center gap-1.5 text-xs font-medium transition-colors ${car.delisted ? 'bg-orange-50 text-orange-500 hover:bg-orange-100' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-600'}`}
                      >
                        {car.delisted ? <><Eye size={13} /> Вернуть в листинг</> : <><EyeOff size={13} /> Снять с листинга</>}
                      </button>
                      <button onClick={() => openEdit(car)} className="w-8 h-8 rounded-xl hover:bg-blue-50 text-gray-400 hover:text-blue-500 flex items-center justify-center transition-colors"><Edit2 size={14} /></button>
                      <button onClick={() => setDeleteModal(car)} className="w-8 h-8 rounded-xl hover:bg-red-50 text-gray-400 hover:text-red-500 flex items-center justify-center transition-colors"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {listCars.length === 0 && (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-gray-400">Авто не добавлено</td></tr>
              )}
            </tbody>
          </table>
          </div>

          {/* Убранные машины */}
          {goneCars.length > 0 && (
            <details className="border-t border-gray-100 group">
              <summary className="px-4 sm:px-6 py-3.5 text-sm font-medium text-gray-500 cursor-pointer select-none list-none flex items-center justify-between">
                <span>Проданы или разбиты · {goneCars.length}</span>
                <span className="text-xs text-gray-400 group-open:hidden">показать</span>
              </summary>
              <ul className="divide-y divide-gray-100">
                {goneCars.map(car => (
                  <li key={car.id} className="flex items-center gap-3 px-4 sm:px-6 py-3">
                    <button onClick={() => setOpenCar(car)} className="flex-1 min-w-0 text-left">
                      <span className="block text-sm font-medium text-gray-700 truncate">{car.make} {car.model} <span className="font-mono text-xs text-gray-500">{car.plate}</span></span>
                      <span className="block text-xs text-gray-400">нет в парке с {format(parseISO(car.removed_from!), 'MMMM yyyy', { locale: ru })}</span>
                    </button>
                    <button onClick={() => handleRestore(car)} className="btn-secondary inline-flex items-center gap-1.5 px-3 h-9 text-sm"><RotateCcw size={14} /> Вернуть</button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>)}
      </Card>

      {/* Add/Edit Modal */}
      {(showAdd || editCar) && (
        <Modal title={editCar ? 'Редактировать авто' : 'Добавить авто'} onClose={() => { setShowAdd(false); setEditCar(null); setFormErrors({}) }}>
          <form onSubmit={editCar ? handleEdit : handleAdd} className="space-y-4" noValidate>
            <FormField label="Марка">
              <input value={form.make} onChange={e => { setForm(f => ({ ...f, make: e.target.value })); setFormErrors(p => ({ ...p, make: '' })) }} placeholder="Toyota" className={inputCls} />
              {formErrors.make && <p className="text-xs text-red-500 mt-1">{formErrors.make}</p>}
            </FormField>
            <FormField label="Модель">
              <input value={form.model} onChange={e => { setForm(f => ({ ...f, model: e.target.value })); setFormErrors(p => ({ ...p, model: '' })) }} placeholder="Camry" className={inputCls} />
              {formErrors.model && <p className="text-xs text-red-500 mt-1">{formErrors.model}</p>}
            </FormField>
            <FormField label="Номер">
              <input
                value={form.plate}
                onChange={e => { setForm(f => ({ ...f, plate: latinPlate(e.target.value) })); setFormErrors(p => ({ ...p, plate: '' })) }}
                placeholder="9TWL415"
                className={inputCls}
                style={{ textTransform: 'uppercase' }}
              />
              {formErrors.plate && <p className="text-xs text-red-500 mt-1">{formErrors.plate}</p>}
            </FormField>
            <ModalActions><SaveButton /><CancelButton onClick={() => { setShowAdd(false); setEditCar(null); setFormErrors({}) }} /></ModalActions>
          </form>
        </Modal>
      )}

      {/* Delete Modal */}
      {deleteModal && (
        <Modal title="Удалить автомобиль?" onClose={() => setDeleteModal(null)}>
          <p className="text-sm text-gray-500 mb-6 -mt-1">
            {deleteModal.make} {deleteModal.model} <span className="font-mono bg-gray-100 px-2 py-0.5 rounded-lg text-xs">{deleteModal.plate}</span> будет удалён без возможности восстановления.
          </p>
          <div className="flex gap-3">
            <button onClick={handleDelete} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition-all">
              Удалить
            </button>
            <CancelButton onClick={() => setDeleteModal(null)} />
          </div>
        </Modal>
      )}

      {/* Status Modal */}
      {inactiveModal && (
        <Modal title={!idleOf(inactiveModal.id) ? 'Отметить простой' : 'Вернуть в работу'} onClose={() => { setInactiveModal(null); setInactiveReason(''); setInactiveDate(''); setInactiveEndDate('') }}>
          <p className="text-sm text-gray-500 mb-5 -mt-1">{inactiveModal.make} {inactiveModal.model} <span className="font-mono bg-gray-100 px-2 py-0.5 rounded-lg text-xs">{inactiveModal.plate}</span></p>
          {!idleOf(inactiveModal.id) && (
            <div className="space-y-4 mb-5">
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Дата с">
                  <DatePicker value={inactiveDate || format(new Date(), 'yyyy-MM-dd')} onChange={setInactiveDate} />
                </FormField>
                <FormField label="Дата до (необязательно)">
                  <DatePicker value={inactiveEndDate} onChange={setInactiveEndDate} />
                </FormField>
              </div>
              <FormField label="Причина (необязательно)">
                <input value={inactiveReason} onChange={e => setInactiveReason(e.target.value)} placeholder="ДТП, ремонт, ТО..." className={inputCls} />
              </FormField>
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={handleToggleInactive} className={`flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all ${!idleOf(inactiveModal.id) ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}>
              {!idleOf(inactiveModal.id) ? 'В простой' : 'Вернуть в работу'}
            </button>
            <CancelButton onClick={() => { setInactiveModal(null); setInactiveReason(''); setInactiveDate(''); setInactiveEndDate('') }} />
          </div>
        </Modal>
      )}

      {/* Edit block modal */}
      {editBlock && (
        <Modal title="Редактировать период" onClose={() => setEditBlock(null)}>
          <form onSubmit={handleSaveBlock} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Дата с">
                <DatePicker value={editBlockForm.start_date} onChange={v => setEditBlockForm(f => ({ ...f, start_date: v }))} />
              </FormField>
              <FormField label="Дата до (необязательно)">
                <DatePicker value={editBlockForm.end_date} onChange={v => setEditBlockForm(f => ({ ...f, end_date: v }))} />
              </FormField>
            </div>
            <FormField label="Причина (необязательно)">
              <input value={editBlockForm.reason} onChange={e => setEditBlockForm(f => ({ ...f, reason: e.target.value }))} placeholder="ДТП, ремонт, ТО..." className={inputCls} />
            </FormField>
            <ModalActions><SaveButton /><CancelButton onClick={() => setEditBlock(null)} /></ModalActions>
          </form>
        </Modal>
      )}
      {unlistCar && <UnlistSheet car={unlistCar} alreadyIdle={!!idleOf(unlistCar.id)} onClose={() => setUnlistCar(null)} onDone={() => { setUnlistCar(null); load() }} />}
      {openCar && <CarCard car={openCar} onClose={() => setOpenCar(null)} onChanged={() => { setOpenCar(null); load() }} />}
    </div>
  )
}

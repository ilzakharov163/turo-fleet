'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { log } from '@/lib/logger'
import { Car, CarBlock } from '@/types'
import { Plus, CheckCircle, XCircle, Trash2, Edit2, Search, EyeOff, Eye } from 'lucide-react'
import { Card, Modal, FormField, inputCls, ModalActions, SaveButton, CancelButton } from '@/components/ui/PageShell'
import DatePicker from '@/components/ui/DatePicker'
import { format, parseISO } from 'date-fns'

function fmtDate(d: string) {
  return d ? format(parseISO(d), 'MM/dd/yyyy') : ''
}

export default function CarsPage() {
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
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [ownerTab, setOwnerTab] = useState<'main' | 'ilya'>('main')
  const [form, setForm] = useState({ make: '', model: '', plate: '', owner_group: 'main' as 'main' | 'ilya' })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({})
  const [carBlocks, setCarBlocks] = useState<CarBlock[]>([])

  async function load() {
    const supabase = createClient()
    const [carsRes, blocksRes] = await Promise.all([
      supabase.from('cars').select('*').order('make').order('model'),
      supabase.from('car_blocks').select('*').order('start_date', { ascending: false }),
    ])
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

  useEffect(() => { load() }, [])

  function validate(f: typeof form) {
    const errors: Record<string, string> = {}
    if (!f.make.trim()) errors.make = 'Введите марку'
    if (!f.model.trim()) errors.model = 'Введите модель'
    if (!f.plate.trim()) errors.plate = 'Введите номер'
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
    const newStatus = inactiveModal.status === 'active' ? 'inactive' : 'active'
    const today = format(new Date(), 'yyyy-MM-dd')
    const yesterday = format(new Date(Date.now() - 86400000), 'yyyy-MM-dd')

    if (newStatus === 'inactive') {
      await supabase.from('car_blocks').insert({
        car_id: inactiveModal.id,
        start_date: inactiveDate || today,
        end_date: inactiveEndDate || null,
        reason: inactiveReason || null,
      })
    } else {
      const { data: openBlocks } = await supabase
        .from('car_blocks').select('id').eq('car_id', inactiveModal.id).is('end_date', null)
      if (openBlocks?.length) {
        await supabase.from('car_blocks').update({ end_date: yesterday }).eq('id', openBlocks[0].id)
      }
    }

    await supabase.from('cars').update({ status: newStatus, inactive_reason: newStatus === 'inactive' ? inactiveReason : null, updated_at: new Date().toISOString() }).eq('id', inactiveModal.id)
    await log('status_change', 'car', inactiveModal.id, { status: newStatus, reason: inactiveReason })
    setInactiveModal(null); setInactiveReason(''); setInactiveDate(''); setInactiveEndDate(''); load()
  }

  async function handleToggleDelisted(car: Car) {
    const supabase = createClient()
    const newDelisted = !car.delisted
    await supabase.from('cars').update({ delisted: newDelisted, updated_at: new Date().toISOString() }).eq('id', car.id)
    await log('update', 'car', car.id, { delisted: newDelisted })
    load()
  }

  function openEdit(car: Car) { setEditCar(car); setForm({ make: car.make, model: car.model, plate: car.plate, owner_group: car.owner_group || 'main' }); setFormErrors({}) }

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

  const tabCars = cars.filter(c => (c.owner_group || 'main') === ownerTab)
  const activeCount = tabCars.filter(c => c.status === 'active').length
  const inactiveCount = tabCars.filter(c => c.status === 'inactive').length

  const tabLabels: Record<string, string> = { main: 'Основной парк', ilya: 'Парк Ильи' }

  return (
    <div className="space-y-5">
      {/* Owner tabs */}
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

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Всего', value: tabCars.length, color: 'text-gray-900', bg: 'bg-white' },
          { label: 'Активных', value: activeCount, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Неактивных', value: inactiveCount, color: 'text-red-500', bg: 'bg-red-50' },
        ].map(s => (
          <div key={s.label} className={`${s.bg} rounded-[18px] p-4 border border-gray-100/80 card-shadow`}>
            <p className="text-xs text-gray-400 font-medium mb-1">{s.label}</p>
            <p className={`text-3xl font-bold ${s.color}`}>{loading ? '—' : s.value}</p>
          </div>
        ))}
      </div>

      <Card>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">{tabLabels[ownerTab]}</h2>
          <button
            onClick={() => { setShowAdd(true); setForm({ make: '', model: '', plate: '', owner_group: ownerTab }); setFormErrors({}) }}
            className="btn-primary flex items-center gap-2 px-4 py-2"
          >
            <Plus size={15} /> Добавить авто
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-gray-100 relative">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Поиск по номеру или названию..."
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-400/30 focus:border-indigo-400"
            />
          </div>
          {searchResults.length > 0 && (
            <div className="absolute left-6 right-6 top-full mt-1 bg-white rounded-[14px] border border-gray-100 py-1.5 z-50"
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
          <div className="px-6 py-10 text-center text-gray-400 text-sm">Загрузка...</div>
        ) : (
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
              {tabCars.map(car => (
                <tr
                  key={car.id}
                  ref={el => { rowRefs.current[car.id] = el }}
                  className={`transition-colors ${highlightId === car.id ? 'bg-indigo-50' : 'hover:bg-gray-50/60'}`}
                >
                  <td className="px-6 py-4 font-semibold text-gray-900">{car.make} {car.model}</td>
                  <td className="px-6 py-4">
                    <span className="bg-gray-100 text-gray-600 px-2.5 py-1 rounded-lg text-xs font-mono font-semibold">{car.plate}</span>
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => setInactiveModal(car)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                        car.status === 'active'
                          ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                          : 'bg-red-50 text-red-500 hover:bg-red-100'
                      }`}
                    >
                      {car.status === 'active' ? <CheckCircle size={12} /> : <XCircle size={12} />}
                      {car.status === 'active' ? 'Активен' : 'Неактивен'}
                    </button>
                  </td>
                  <td className="px-6 py-4 text-gray-400 text-xs">
                    {(() => {
                      const block = carBlocks.find(b => b.car_id === car.id)
                      if (!block) return car.inactive_reason || '—'
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
                        onClick={() => handleToggleDelisted(car)}
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
              {tabCars.length === 0 && (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-gray-400">Авто не добавлено</td></tr>
              )}
            </tbody>
          </table>
        )}
      </Card>

      {/* Add/Edit Modal */}
      {(showAdd || editCar) && (
        <Modal title={editCar ? 'Редактировать авто' : 'Добавить авто'} onClose={() => { setShowAdd(false); setEditCar(null); setFormErrors({}) }}>
          <form onSubmit={editCar ? handleEdit : handleAdd} className="space-y-4" noValidate>
            <FormField label="Парк">
              <div className="flex gap-2">
                {(['main', 'ilya'] as const).map(g => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, owner_group: g }))}
                    className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${form.owner_group === g ? 'bg-[#4F46E5] text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                  >
                    {tabLabels[g]}
                  </button>
                ))}
              </div>
            </FormField>
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
                onChange={e => { setForm(f => ({ ...f, plate: e.target.value.toUpperCase() })); setFormErrors(p => ({ ...p, plate: '' })) }}
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
        <Modal title={inactiveModal.status === 'active' ? 'Деактивировать авто' : 'Активировать авто'} onClose={() => { setInactiveModal(null); setInactiveReason(''); setInactiveDate(''); setInactiveEndDate('') }}>
          <p className="text-sm text-gray-500 mb-5 -mt-1">{inactiveModal.make} {inactiveModal.model} <span className="font-mono bg-gray-100 px-2 py-0.5 rounded-lg text-xs">{inactiveModal.plate}</span></p>
          {inactiveModal.status === 'active' && (
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
            <button onClick={handleToggleInactive} className={`flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all ${inactiveModal.status === 'active' ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}>
              {inactiveModal.status === 'active' ? 'Деактивировать' : 'Активировать'}
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
    </div>
  )
}

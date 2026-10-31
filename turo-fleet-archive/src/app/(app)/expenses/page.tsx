'use client'

import React, { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { log } from '@/lib/logger'
import { Car, Expense } from '@/types'
import { Plus, Trash2, Edit2, Paperclip, Download, X, Image as ImageIcon, Camera, Search, ListFilter, ChevronDown, Check } from 'lucide-react'
import Select from '@/components/ui/Select'
import { format, parseISO, startOfMonth, subMonths } from 'date-fns'
import { ru } from 'date-fns/locale'
import DatePicker from '@/components/ui/DatePicker'
import MonthPicker from '@/components/ui/MonthPicker'
import Popover from '@/components/ui/Popover'
import { notify, ask } from '@/lib/ui'
import { inputCls } from '@/components/ui/PageShell'

const usd = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [cars, setCars] = useState<Car[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editExpense, setEditExpense] = useState<Expense | null>(null)
  const EXPENSE_CATEGORIES = ['Жетоны для мойки', 'Такси', 'Заказы/Покупки', 'Ремонт', 'Смог чек', 'Выезд из парковки LAX', 'Заправка']
  const [form, setForm] = useState({ car_id: '', title: '', notes: '', amount: '', date: '' })
  const [files, setFiles] = useState<File[]>([])
  const [existingFiles, setExistingFiles] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [filterCar, setFilterCar] = useState('')
  const [filterMonth, setFilterMonth] = useState(format(new Date(), 'yyyy-MM'))
  // Переведено сотруднику на расходы по месяцам ('yyyy-MM' → $) — поле «Расходы» в «Доходы → Расходы» (revenue_month_expenses.salary1).
  // null — нет доступа к «Доходам», карточку не показываем.
  const [transferred, setTransferred] = useState<Record<string, number> | null>(null)
  const [filterCats, setFilterCats] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [noReceipt, setNoReceipt] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const [me, setMe] = useState<string | null>(null)        // кто вошёл — быстрые кнопки по его прошлым расходам

  const load = useCallback(async () => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id || null))
    const [carsRes, expRes, trRes] = await Promise.all([
      supabase.from('cars').select('*').order('make'),
      // Только последние 12 месяцев — столько, сколько вкладок месяцев
      supabase.from('expenses').select('*, car:cars(make,model,plate)').gte('date', format(startOfMonth(subMonths(new Date(), 11)), 'yyyy-MM-dd'))
        .order('date', { ascending: true }).order('created_at', { ascending: true }),
      supabase.from('revenue_month_expenses').select('period, salary1'),
    ])
    setTransferred(trRes.error ? null : Object.fromEntries((trRes.data || []).map(x => [String(x.period).slice(0, 7), Number(x.salary1) || 0])))
    setCars(carsRes.data || [])
    setExpenses(expRes.data as Expense[] || [])

    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- загрузка данных при открытии
  useEffect(() => { load() }, [load])

  async function getSignedUrl(path: string): Promise<string> {
    if (signedUrls[path]) return signedUrls[path]
    const supabase = createClient()
    const { data } = await supabase.storage.from('receipts').createSignedUrl(path, 3600)
    if (data?.signedUrl) setSignedUrls(m => ({ ...m, [path]: data.signedUrl }))
    return data?.signedUrl || ''
  }

  // Новый расход: подставляем машину и статью из последнего добавленного
  function openNew() {
    const last = [...expenses].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0]
    setEditExpense(null)
    setForm({ car_id: last?.car_id || '', title: last?.title || '', notes: '', amount: '', date: format(new Date(), 'yyyy-MM-dd') })
    setFiles([]); setExistingFiles([])
    setShowModal(true)
  }

  // Быстрый расход: статья + сумма и машина из прошлого такого же расхода этого человека, и сразу камера для чека.
  // Камеру открываем в том же нажатии (иначе телефон не разрешит), поэтому поля выбора файла стоят вне окна.
  function openQuick(title: string) {
    const prev = mine.filter(e => e.title === title).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0]
    setEditExpense(null)
    setForm({ car_id: prev?.car_id || mine[0]?.car_id || '', title, notes: '', amount: prev ? String(prev.amount) : '', date: format(new Date(), 'yyyy-MM-dd') })
    setFiles([]); setExistingFiles([])
    setShowModal(true)
    cameraRef.current?.click()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setUploading(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setUploading(false); return }

    // Upload new files; если чек не загрузился — не сохраняем, чтобы не потерять его
    const uploadedPaths: string[] = [...existingFiles]
    for (const file of files) {
      const path = `${user.id}/${Date.now()}_${file.name.replace(/[^\w.\-]+/g, '_')}`
      const { error } = await supabase.storage.from('receipts').upload(path, file)
      if (error) { setUploading(false); return }
      uploadedPaths.push(path)
    }

    const payload = {
      car_id: form.car_id || null,
      title: form.title,
      notes: form.notes || null,
      amount: parseFloat(form.amount),
      date: form.date,
      files: uploadedPaths,
      created_by: user.id,
      updated_at: new Date().toISOString(),
    }

    if (editExpense) {
      const { error } = await supabase.from('expenses').update(payload).eq('id', editExpense.id)
      if (error) { setUploading(false); return }
      await log('update', 'expense', editExpense.id, {
        old: { title: editExpense.title, amount: editExpense.amount },
        new: { title: form.title, amount: form.amount },
      })
    } else {
      const { data, error } = await supabase.from('expenses').insert(payload).select().single()
      if (error) { setUploading(false); return }
      if (data) await log('create', 'expense', data.id, { title: form.title, amount: form.amount })
    }
    notify(editExpense ? 'Расход сохранён' : 'Расход добавлен', 'success')

    setShowModal(false)
    setEditExpense(null)
    setFiles([])
    setExistingFiles([])
    setForm({ car_id: '', title: '', notes: '', amount: '', date: '' })
    setUploading(false)
    load()
  }

  async function handleDelete(exp: Expense) {
    if (!await ask('Удалить расход?', { detail: `${exp.title} · $${Number(exp.amount).toFixed(2)} будет удалён безвозвратно.`, ok: 'Удалить', danger: true })) return
    const supabase = createClient()
    const { error } = await supabase.from('expenses').delete().eq('id', exp.id)
    if (error) return
    if (exp.files?.length) await supabase.storage.from('receipts').remove(exp.files)
    await log('delete', 'expense', exp.id, { title: exp.title, amount: exp.amount })
    load()
  }

  function openEdit(expense: Expense) {
    setEditExpense(expense)
    setForm({ car_id: expense.car_id, title: expense.title, notes: expense.notes || '', amount: String(expense.amount), date: expense.date })
    setExistingFiles(expense.files || [])
    setFiles([])
    setShowModal(true)
  }

  async function compressImage(file: File): Promise<File> {
    if (!file.type.startsWith('image/')) return file
    return new Promise(resolve => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        const MAX = 1920
        let { width, height } = img
        if (width > MAX || height > MAX) {
          if (width > height) { height = Math.round(height * MAX / width); width = MAX }
          else { width = Math.round(width * MAX / height); height = MAX }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width; canvas.height = height
        canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
        canvas.toBlob(blob => {
          URL.revokeObjectURL(url)
          if (blob) resolve(new File([blob], file.name, { type: 'image/jpeg' }))
          else resolve(file)
        }, 'image/jpeg', 0.8)
      }
      img.src = url
    })
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files || [])
    e.target.value = ''
    const total = files.length + existingFiles.length + selected.length
    if (total > 5) { notify('Максимум 5 файлов', 'error'); return }
    const compressed = await Promise.all(selected.map(compressImage))
    setFiles(prev => [...prev, ...compressed])
  }

  async function handlePreview(path: string) {
    const url = await getSignedUrl(path)
    if (path.toLowerCase().endsWith('.pdf')) {
      window.open(url, '_blank')
    } else {
      setPreviewLoading(true)
      setPreviewUrl(url)
    }
  }

  useEffect(() => {
    if (!previewUrl) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { setPreviewUrl(null); setPreviewLoading(false) } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [previewUrl])

  async function handleDownload(path: string) {
    const url = await getSignedUrl(path)
    const res = await fetch(url)
    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = path.split('/').pop() || 'receipt'
    a.click()
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function markPaid(paid: boolean) {
    if (selected.size === 0) return
    const ids = [...selected]
    setExpenses(prev => prev.map(e => ids.includes(e.id) ? { ...e, paid } : e))
    setSelected(new Set())
    const supabase = createClient()
    const { error } = await supabase.from('expenses').update({ paid }).in('id', ids)
    if (error) { load() }
  }

  async function removeExistingFile(path: string) {
    const supabase = createClient()
    await supabase.storage.from('receipts').remove([path])
    setExistingFiles(prev => prev.filter(f => f !== path))
  }

  // Generate last 12 months for tabs
  // Расходы этого человека (новые первыми): частые статьи → быстрые кнопки, последние машины → кнопки в окне
  const mine = expenses.filter(e => !me || e.created_by === me).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  const quickTitles = Object.entries(mine.slice(0, 60).reduce<Record<string, number>>((m, e) => { m[e.title] = (m[e.title] || 0) + 1; return m }, {}))
    .sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 4)
  const recentCars = [...new Set(mine.map(e => e.car_id).filter(Boolean))].slice(0, 3).map(id => cars.find(c => c.id === id)).filter((c): c is Car => !!c)

  const months = Array.from({ length: 12 }, (_, i) => {
    const d = subMonths(new Date(), i)
    return { value: format(d, 'yyyy-MM'), label: format(d, 'LLL yyyy', { locale: ru }) }
  }).reverse()


  const baseFiltered = expenses.filter(e => (filterMonth === 'all' || e.date.startsWith(filterMonth)) && (!filterCar || e.car_id === filterCar))
  const catStats = [...new Set([...EXPENSE_CATEGORIES, ...baseFiltered.map(e => e.title)])]
    .map(name => {
      const items = baseFiltered.filter(e => e.title === name)
      return { name, count: items.length, sum: items.reduce((s, e) => s + Number(e.amount), 0) }
    })
    .filter(c => c.count > 0)
  const q = query.trim().toLowerCase()
  const filtered = baseFiltered.filter(e =>
    (filterCats.size === 0 || filterCats.has(e.title)) &&
    (!noReceipt || !e.files?.length) &&
    (!q || `${e.title} ${e.notes || ''} ${e.amount} ${e.car ? `${e.car.make} ${e.car.model} ${e.car.plate}` : ''}`.toLowerCase().includes(q)))
  const noReceiptCount = baseFiltered.filter(e => !e.files?.length).length
  const totalFiltered = filtered.reduce((s, e) => s + Number(e.amount), 0)
  const paidTotal = filtered.filter(e => e.paid).reduce((s, e) => s + Number(e.amount), 0)
  const unpaidTotal = totalFiltered - paidTotal
  // Переведено сотруднику за выбранный месяц (или за 12 месяцев) и сколько из этого ещё не потрачено (все машины и статьи)
  const monthKeys = filterMonth === 'all' ? months.map(m => m.value) : [filterMonth]
  const transferredSum = transferred ? monthKeys.reduce((s, k) => s + (transferred[k] || 0), 0) : 0
  const spentAll = expenses.filter(e => monthKeys.some(k => e.date.startsWith(k))).reduce((s, e) => s + Number(e.amount), 0)
  const transferLeft = transferredSum - spentAll
  const selectedTotal = filtered.filter(e => selected.has(e.id)).reduce((s, e) => s + Number(e.amount), 0)
  const allSelected = filtered.length > 0 && filtered.every(e => selected.has(e.id))
  function toggleSelectAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(filtered.map(e => e.id)))
  }

  return (
    <div>
      <div className="hidden sm:flex items-center justify-between gap-3 mb-5">
        <p className="text-sm text-gray-500">Расходы по машинам и чеки</p>
        {/* На телефоне добавляют круглой кнопкой «+» */}
        <button onClick={openNew} className="hidden sm:flex btn-primary items-center gap-2 px-4 h-10">
          <Plus size={16} /> Добавить расход
        </button>
      </div>

      {/* Быстрый расход: частые статьи — форма уже заполнена, сразу камера */}
      {quickTitles.length > 0 && (
        <div className="flex items-center gap-2 mb-4 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0" style={{ scrollbarWidth: 'none' }}>
          <span className="text-xs font-medium text-gray-400 flex-shrink-0">Быстро:</span>
          {quickTitles.map(t => (
            <button key={t} type="button" onClick={() => openQuick(t)} className="flex-shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-sm font-medium text-[#4F46E5] dark:text-indigo-300 bg-indigo-50 hover:bg-indigo-100 transition-colors whitespace-nowrap">
              <Camera size={14} /> {t}
            </button>
          ))}
        </div>
      )}

      {/* Фильтры — одна строка: месяц, статьи, машина, без чека, поиск */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <MonthPicker value={filterMonth} onChange={setFilterMonth} min={months[0].value} max={months[months.length - 1].value} allLabel="За 12 месяцев" className="w-full sm:w-auto" />

        <div className="grid grid-cols-3 gap-2 w-full sm:flex sm:w-auto">

        <Popover
          panelClass="sm:w-80"
          trigger={(open, toggle) => (
            <button onClick={toggle} className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 h-10 px-3 sm:px-3.5 rounded-xl border text-sm font-medium transition-colors ${filterCats.size ? 'bg-indigo-50 border-indigo-200 text-[#4F46E5] dark:text-indigo-300' : 'bg-white border-gray-200 text-gray-700'} ${open ? 'ring-2 ring-indigo-400/20' : ''}`}>
              <ListFilter size={15} className="flex-shrink-0" />
              <span className="truncate">{filterCats.size === 0 ? 'Статьи' : filterCats.size === 1 ? [...filterCats][0] : `Статьи: ${filterCats.size}`}</span>
              <ChevronDown size={14} className="text-gray-400 flex-shrink-0 hidden sm:block" />
            </button>
          )}
        >
          {close => (
            <div>
              <div className="flex items-center justify-between px-4 pt-3 pb-2">
                <span className="text-sm font-semibold text-gray-900">Статьи расходов</span>
                {filterCats.size > 0 && <button onClick={() => setFilterCats(new Set())} className="text-sm text-[#4F46E5] dark:text-indigo-300">Показать все</button>}
              </div>
              <div className="max-h-[50vh] sm:max-h-80 overflow-y-auto px-2 pb-2">
                {catStats.length === 0 && <p className="px-2 py-4 text-sm text-gray-400">В этом месяце расходов нет</p>}
                {catStats.map(cat => {
                  const on = filterCats.has(cat.name)
                  return (
                    <button key={cat.name}
                      onClick={() => setFilterCats(prev => { const n = new Set(prev); if (n.has(cat.name)) n.delete(cat.name); else n.add(cat.name); return n })}
                      className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-gray-50 text-left">
                      <span className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 ${on ? 'bg-[#4F46E5] border-[#4F46E5] text-white' : 'border-gray-300'}`}>{on && <Check size={13} strokeWidth={3} />}</span>
                      <span className="flex-1 min-w-0 truncate text-sm text-gray-800">{cat.name}</span>
                      <span className="text-xs tabular-nums text-gray-400">{cat.count} · ${cat.sum.toFixed(0)}</span>
                    </button>
                  )
                })}
              </div>
              <div className="px-4 pb-4 pt-1 sm:hidden"><button onClick={close} className="btn-primary w-full h-11">Готово</button></div>
            </div>
          )}
        </Popover>

        <Select
          value={filterCar}
          onChange={setFilterCar}
          options={[{ value: '', label: 'Машины' }, ...cars.map(c => ({ value: c.id, label: `${c.make} ${c.model} ${c.plate}` }))]}
          block
        />

        <button
          onClick={() => setNoReceipt(v => !v)}
          className={`inline-flex items-center justify-center gap-1.5 h-10 px-3 sm:px-3.5 rounded-xl text-sm font-medium border transition-colors whitespace-nowrap ${noReceipt ? 'bg-indigo-50 border-indigo-200 text-[#4F46E5] dark:text-indigo-300' : 'bg-white text-gray-700 border-gray-200'}`}
        >
          Без чека <span className={`text-xs tabular-nums ${noReceipt ? '' : 'text-gray-400'}`}>{noReceiptCount}</span>
        </button>
        </div>

        <div className="relative w-full lg:w-auto lg:flex-1 lg:min-w-[220px] lg:max-w-sm lg:ml-auto">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Поиск: статья, машина, сумма…"
            className="w-full h-10 pl-9 pr-8 text-base sm:text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400/30 focus:border-indigo-400"
          />
          {query && <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" aria-label="Очистить"><X size={15} /></button>}
        </div>
      </div>

      {/* Итоги по выбранному + сколько переведено сотруднику (из «Доходов») */}
      {!loading && (
        <div className={`grid grid-cols-2 ${transferred ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-2 mb-3`}>
          <div className="rounded-2xl bg-white border border-gray-100/80 card-shadow px-3.5 py-2.5">
            <p className="text-[11px] text-gray-400">Расходы · {filtered.length}</p>
            <p className="text-lg font-bold text-gray-900 tabular-nums">{usd(totalFiltered)}</p>
          </div>
          <div className="rounded-2xl bg-white border border-gray-100/80 card-shadow px-3.5 py-2.5">
            <p className="text-[11px] text-gray-400">Оплачено</p>
            <p className="text-lg font-bold text-emerald-600 tabular-nums">{usd(paidTotal)}</p>
          </div>
          <div className="rounded-2xl bg-white border border-gray-100/80 card-shadow px-3.5 py-2.5">
            <p className="text-[11px] text-gray-400">Не оплачено</p>
            <p className={`text-lg font-bold tabular-nums ${unpaidTotal > 0 ? 'text-rose-500' : 'text-gray-300'}`}>{usd(unpaidTotal)}</p>
          </div>
          {transferred && (
            <a href={`/income?view=expenses${filterMonth === 'all' ? '' : `&month=${filterMonth}`}`} className="rounded-2xl bg-indigo-50/70 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 px-3.5 py-2.5 hover:bg-indigo-50" title="Меняется в «Доходы → Расходы → Затраты на сотрудника → Расходы»">
              <p className="text-[11px] text-indigo-500 dark:text-indigo-300">Переведено сотруднику</p>
              <p className="text-lg font-bold text-indigo-700 dark:text-indigo-200 tabular-nums">{usd(transferredSum)}</p>
              {(transferredSum > 0 || spentAll > 0) && (
                <p className={`text-[11px] tabular-nums ${transferLeft >= 0 ? 'text-gray-500' : 'text-rose-500'}`}>{transferLeft >= 0 ? `остаток ${usd(transferLeft)}` : `потрачено больше на ${usd(-transferLeft)}`}</p>
              )}
            </a>
          )}
        </div>
      )}

      {loading ? <div className="space-y-3">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-16" />)}</div> : (
        <div className="bg-white rounded-[18px] overflow-hidden card-shadow border border-gray-100/80">
          {/* Телефон — карточки */}
          <div className="sm:hidden divide-y divide-gray-100">
            {[...filtered.filter(e => e.paid), ...filtered.filter(e => !e.paid)].map((exp, idx, arr) => (
              <React.Fragment key={exp.id}>
                {!exp.paid && idx > 0 && arr[idx - 1].paid && (
                  <div className="px-4 py-2 text-xs font-semibold text-rose-400 uppercase tracking-wider bg-rose-50/40">Не оплачено</div>
                )}
                <div className={`flex gap-3 px-4 py-3 ${selected.has(exp.id) ? 'bg-indigo-50/40' : ''}`}>
                  <input type="checkbox" checked={selected.has(exp.id)} onChange={() => toggleSelect(exp.id)} className="mt-1 w-5 h-5 flex-shrink-0 rounded border-gray-300 accent-[#4F46E5]" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium text-gray-900 min-w-0">
                        {exp.title}
                        {exp.notes && <span className="text-gray-400 font-normal text-xs"> · {exp.notes}</span>}
                      </p>
                      <span className="font-semibold text-gray-900 tabular-nums flex-shrink-0">${Number(exp.amount).toFixed(2)}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">
                      {format(parseISO(exp.date), 'dd.MM.yyyy')}
                      {exp.car && <> · {exp.car.make} {exp.car.model} <span className="font-mono font-semibold text-gray-600">{exp.car.plate}</span></>}
                    </p>
                    <div className="flex items-center gap-1.5 mt-2">
                      {exp.paid
                        ? <span className="px-2 py-0.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-600">Оплачено</span>
                        : <span className="px-2 py-0.5 rounded-lg text-xs font-medium bg-rose-50 text-rose-400">Не оплачено</span>}
                      {exp.files?.length > 0 && (
                        <button onClick={() => handlePreview(exp.files[0])} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-500">
                          <ImageIcon size={12} /> Чеки {exp.files.length}
                        </button>
                      )}
                      <span className="flex-1" />
                      <button onClick={() => openEdit(exp)} className="w-8 h-8 rounded-lg bg-gray-50 text-gray-500 flex items-center justify-center"><Edit2 size={14} /></button>
                      <button onClick={() => handleDelete(exp)} className="w-8 h-8 rounded-lg bg-gray-50 text-gray-400 flex items-center justify-center"><Trash2 size={14} /></button>
                    </div>
                  </div>
                </div>
              </React.Fragment>
            ))}
            {filtered.length === 0 && <p className="px-4 py-8 text-center text-gray-400 text-sm">Расходов нет</p>}
          </div>

          {/* Компьютер — таблица */}
          <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr className="text-left text-gray-500">
                <th className="pl-6 pr-2 py-4 w-10">
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="w-4 h-4 rounded border-gray-300 accent-[#4F46E5] cursor-pointer" />
                </th>
                <th className="px-6 py-4 font-medium">Дата</th>
                <th className="px-6 py-4 font-medium">Авто</th>
                <th className="px-6 py-4 font-medium">Статья</th>
                <th className="px-6 py-4 font-medium text-right">Сумма</th>
                <th className="px-6 py-4 font-medium text-center">Оплата</th>
                <th className="px-6 py-4 font-medium text-center">Чеки</th>
                <th className="px-6 py-4 font-medium text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {[...filtered.filter(e => e.paid), ...filtered.filter(e => !e.paid)].map((exp, idx, arr) => (
                <React.Fragment key={exp.id}>
                  {!exp.paid && idx > 0 && arr[idx - 1].paid && (
                    <tr className="bg-rose-50/40">
                      <td colSpan={8} className="px-6 py-2 text-xs font-semibold text-rose-400 uppercase tracking-wider border-y border-rose-100">
                        Не оплачено
                      </td>
                    </tr>
                  )}
                  <tr className={`border-b last:border-0 hover:bg-gray-50 ${selected.has(exp.id) ? 'bg-indigo-50/40' : exp.paid ? 'bg-emerald-50/20' : ''}`}>
                    <td className="pl-6 pr-2 py-4">
                      <input type="checkbox" checked={selected.has(exp.id)} onChange={() => toggleSelect(exp.id)} className="w-4 h-4 rounded border-gray-300 accent-[#4F46E5] cursor-pointer" />
                    </td>
                    <td className="px-6 py-4 text-gray-500">{format(parseISO(exp.date), 'dd.MM.yyyy')}</td>
                    <td className="px-6 py-4">
                      {exp.car ? (
                        <span>
                          {exp.car.make} {exp.car.model}
                          {exp.car.plate && <span className="ml-1.5 font-mono text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{exp.car.plate}</span>}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-6 py-4 font-medium">
                      {exp.title}
                      {exp.notes && <span className="text-gray-400 font-normal ml-1.5 text-xs">· {exp.notes}</span>}
                    </td>
                    <td className="px-6 py-4 text-right font-semibold">${Number(exp.amount).toFixed(2)}</td>
                    <td className="px-6 py-4 text-center">
                      {exp.paid ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-600">Оплачено</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium bg-rose-50 text-rose-400">Не оплачено</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {exp.files?.length > 0 ? (
                        <div className="flex items-center justify-center gap-1">
                          {exp.files.map((f, i) => (
                            <div key={i} className="flex gap-0.5">
                              <button onClick={() => handlePreview(f)} onMouseDown={e => e.preventDefault()} className="p-1 rounded hover:bg-blue-50 text-blue-500 transition-colors" title="Открыть"><ImageIcon size={14} /></button>
                              <button onClick={() => handleDownload(f)} className="p-1 rounded hover:bg-blue-50 text-blue-500 transition-colors" title="Скачать"><Download size={14} /></button>
                            </div>
                          ))}
                          <span className="text-gray-400 text-xs ml-1">({exp.files.length})</span>
                        </div>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openEdit(exp)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"><Edit2 size={15} /></button>
                        <button onClick={() => handleDelete(exp)} className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                </React.Fragment>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-6 py-8 text-center text-gray-400">Расходов нет</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}


      {/* Floating add button (FAB) */}
      <button
        onClick={openNew}
        title="Добавить расход"
        className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] sm:bottom-6 right-4 sm:right-6 z-30 w-14 h-14 rounded-full bg-[#4F46E5] text-white flex items-center justify-center transition-all duration-300 hover:scale-105"
        style={{
          boxShadow: '0 6px 18px rgba(79,70,229,0.35)',
          transform: selected.size > 0 ? 'scale(0.6)' : 'scale(1)',
          opacity: selected.size > 0 ? 0 : 1,
          pointerEvents: selected.size > 0 ? 'none' : 'auto',
        }}
      >
        <Plus size={26} strokeWidth={2.4} />
      </button>

      {/* Floating selection panel */}
      {selected.size > 0 && (
        <div className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] sm:bottom-6 left-4 right-4 sm:left-auto sm:right-6 sm:w-[300px] z-40 bg-white rounded-2xl border border-gray-200 shadow-2xl px-5 py-4 animate-in">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-gray-500">Выбрано: {selected.size}</span>
            <button onClick={() => setSelected(new Set())} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
          </div>
          <p className="text-2xl font-bold text-gray-900 mb-3">${selectedTotal.toFixed(2)}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => markPaid(true)} className="flex-1 px-3 py-2 rounded-xl text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors">
              Отметить оплаченным
            </button>
            <button onClick={() => markPaid(false)} className="px-3 py-2 rounded-xl text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors whitespace-nowrap">
              Снять
            </button>
          </div>
        </div>
      )}


      {/* Выбор файлов — вне окна: быстрые кнопки открывают камеру в том же нажатии, до появления окна.
          capture="environment" — сразу открывает заднюю камеру телефона */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleFileChange} className="hidden" />
      <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple onChange={handleFileChange} className="hidden" />

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-[2px] flex items-end sm:items-center justify-center z-50 sm:p-4">
          <div className="bg-white rounded-t-[22px] sm:rounded-[20px] shadow-2xl p-5 sm:p-6 w-full max-w-md max-h-[92vh] overflow-y-auto" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
            <h2 className="text-lg font-bold text-gray-900 mb-5">{editExpense ? 'Редактировать расход' : 'Добавить расход'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Статья расходов</label>
                <select required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={inputCls}>
                  <option value="">Выберите статью...</option>
                  {/* Статья не из списка (например, «Установка GPS» из бота) тоже видна в выборе */}
                  {[...EXPENSE_CATEGORIES, ...(form.title && !EXPENSE_CATEGORIES.includes(form.title) ? [form.title] : [])].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Комментарий (необязательно)</label>
                <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Доп. информация..." className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Авто</label>
                <Select
                  value={form.car_id}
                  onChange={val => setForm(f => ({ ...f, car_id: val }))}
                  options={[
                    { value: '', label: 'Выберите авто' },
                    ...cars.map(c => ({ value: c.id, label: `${c.make} ${c.model} ${c.plate}` })),
                  ]}
                />
                {!editExpense && recentCars.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {recentCars.map(c => (
                      <button key={c.id} type="button" onClick={() => setForm(f => ({ ...f, car_id: c.id }))}
                        className={`h-8 px-2.5 rounded-lg text-xs font-medium transition-colors ${form.car_id === c.id ? 'bg-indigo-50 text-[#4F46E5] dark:text-indigo-300 ring-1 ring-indigo-200' : 'bg-gray-100 text-gray-600'}`}>
                        {c.model} {c.plate}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Дата</label>
                  <DatePicker value={form.date} onChange={val => setForm(f => ({ ...f, date: val }))} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Сумма ($)</label>
                  <input type="number" step="0.01" min="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required placeholder="0.00" className={inputCls} />
                </div>
              </div>

              {/* File upload */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Фото чеков (до 5 штук)</label>
                {/* Existing files */}
                {existingFiles.map((f, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 px-3 bg-gray-50 rounded-lg mb-2 text-sm">
                    <span className="text-gray-600 truncate">{f.split('/').pop()}</span>
                    <button type="button" onClick={() => removeExistingFile(f)} className="text-red-400 hover:text-red-600 ml-2"><X size={14} /></button>
                  </div>
                ))}
                {/* New files */}
                {files.map((f, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 px-3 bg-blue-50 rounded-lg mb-2 text-sm">
                    <span className="text-blue-600 truncate">{f.name}</span>
                    <button type="button" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 ml-2"><X size={14} /></button>
                  </div>
                ))}
                {(files.length + existingFiles.length) < 5 && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => cameraRef.current?.click()}
                      className="flex items-center justify-center gap-2 h-12 rounded-xl text-sm font-medium text-[#4F46E5] dark:text-indigo-300 bg-indigo-50 hover:bg-indigo-100 transition-colors"
                    >
                      <Camera size={17} /> Сфотографировать
                    </button>
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="flex items-center justify-center gap-2 h-12 rounded-xl text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
                    >
                      <Paperclip size={16} /> Из галереи / файл
                    </button>
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowModal(false); setEditExpense(null) }} className="btn-secondary flex-1 h-11">
                  Отмена
                </button>
                <button type="submit" disabled={uploading} className="btn-primary flex-1 h-11">
                  {uploading ? 'Сохраняем...' : 'Сохранить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Image preview */}
      {previewUrl && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => { setPreviewUrl(null); setPreviewLoading(false) }}>
          {previewLoading && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-7 h-7 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            </div>
          )}
          <div className="relative flex items-start gap-3 max-w-3xl max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="Чек"
                className="max-w-full max-h-[85vh] rounded-lg object-contain transition-opacity duration-300"
                style={{ opacity: previewLoading ? 0 : 1 }}
                onLoad={() => setPreviewLoading(false)}
              />
            </div>
            <button
              onClick={() => { setPreviewUrl(null); setPreviewLoading(false) }}
              className="flex-shrink-0 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-opacity duration-300 mt-1"
              style={{ opacity: previewLoading ? 0 : 1, pointerEvents: previewLoading ? 'none' : 'auto' }}
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

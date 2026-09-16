'use client'

import React, { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { log } from '@/lib/logger'
import { Car, Expense } from '@/types'
import { Plus, Trash2, Edit2, Paperclip, Download, X, Image as ImageIcon } from 'lucide-react'
import Select from '@/components/ui/Select'
import { format, parseISO, startOfMonth, subMonths } from 'date-fns'
import { ru } from 'date-fns/locale'
import DatePicker from '@/components/ui/DatePicker'

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [cars, setCars] = useState<Car[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editExpense, setEditExpense] = useState<Expense | null>(null)
  const EXPENSE_CATEGORIES = ['ÐÐµÑÐ¾Ð½Ñ Ð´Ð»Ñ Ð¼Ð¾Ð¹ÐºÐ¸', 'Ð¢Ð°ÐºÑÐ¸', 'ÐÐ°ÐºÐ°Ð·Ñ/ÐÐ¾ÐºÑÐ¿ÐºÐ¸', 'Ð ÐµÐ¼Ð¾Ð½Ñ', 'Ð¡Ð¼Ð¾Ð³ ÑÐµÐº', 'ÐÑÐµÐ·Ð´ Ð¸Ð· Ð¿Ð°ÑÐºÐ¾Ð²ÐºÐ¸ LAX', 'ÐÐ°Ð¿ÑÐ°Ð²ÐºÐ°']
  const [form, setForm] = useState({ car_id: '', title: '', notes: '', amount: '', date: '' })
  const [files, setFiles] = useState<File[]>([])
  const [existingFiles, setExistingFiles] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [filterCar, setFilterCar] = useState('')
  const [filterMonth, setFilterMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleteExpense, setDeleteExpense] = useState<Expense | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const [carsRes, expRes] = await Promise.all([
      supabase.from('cars').select('*').order('make'),
      supabase.from('expenses').select('*, car:cars(make,model,plate)').order('date', { ascending: true }).order('created_at', { ascending: true }),
    ])
    setCars(carsRes.data || [])
    const exps = expRes.data as Expense[] || []
    setExpenses(exps)

    // Pre-generate signed URLs for all files
    const allPaths = exps.flatMap(e => e.files || [])
    if (allPaths.length > 0) {
      const { data } = await supabase.storage.from('receipts').createSignedUrls(allPaths, 3600)
      const map: Record<string, string> = {}
      data?.forEach(({ path, signedUrl }) => { if (path && signedUrl) map[path] = signedUrl })
      setSignedUrls(map)
      // Prefetch images in background
      data?.forEach(({ path, signedUrl }) => {
        if (signedUrl && path && !path.toLowerCase().endsWith('.pdf')) {
          const img = new Image()
          img.src = signedUrl
        }
      })
    }

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function getSignedUrl(path: string): Promise<string> {
    if (signedUrls[path]) return signedUrls[path]
    const supabase = createClient()
    const { data } = await supabase.storage.from('receipts').createSignedUrl(path, 3600)
    return data?.signedUrl || ''
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setUploading(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Upload new files
    const uploadedPaths: string[] = [...existingFiles]
    for (const file of files) {
      const path = `${user.id}/${Date.now()}_${file.name}`
      await supabase.storage.from('receipts').upload(path, file)
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
      await supabase.from('expenses').update(payload).eq('id', editExpense.id)
      await log('update', 'expense', editExpense.id, {
        old: { title: editExpense.title, amount: editExpense.amount },
        new: { title: form.title, amount: form.amount },
      })
    } else {
      const { data } = await supabase.from('expenses').insert(payload).select().single()
      if (data) await log('create', 'expense', data.id, { title: form.title, amount: form.amount })
    }

    setShowModal(false)
    setEditExpense(null)
    setFiles([])
    setExistingFiles([])
    setForm({ car_id: '', title: '', notes: '', amount: '', date: '' })
    setUploading(false)
    load()
  }

  async function handleDelete() {
    if (!deleteExpense) return
    const supabase = createClient()
    if (deleteExpense.files?.length) {
      await supabase.storage.from('receipts').remove(deleteExpense.files)
    }
    await supabase.from('expenses').delete().eq('id', deleteExpense.id)
    await log('delete', 'expense', deleteExpense.id, { title: deleteExpense.title, amount: deleteExpense.amount })
    setDeleteExpense(null)
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
    const total = files.length + existingFiles.length + selected.length
    if (total > 5) { alert('ÐÐ°ÐºÑÐ¸Ð¼ÑÐ¼ 5 ÑÐ°Ð¹Ð»Ð¾Ð²'); return }
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
    if (error) { alert('Ошибка: ' + error.message); load() }
  }

  async function removeExistingFile(path: string) {
    const supabase = createClient()
    await supabase.storage.from('receipts').remove([path])
    setExistingFiles(prev => prev.filter(f => f !== path))
  }

  // Generate last 12 months for tabs
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = subMonths(new Date(), i)
    return { value: format(d, 'yyyy-MM'), label: format(d, 'LLL yyyy', { locale: ru }) }
  }).reverse()


  const filtered = expenses.filter(e => {
    const matchMonth = filterMonth === 'all' || e.date.startsWith(filterMonth)
    const matchCar = !filterCar || e.car_id === filterCar
    return matchMonth && matchCar
  })
  const totalFiltered = filtered.reduce((s, e) => s + Number(e.amount), 0)
  const paidTotal = filtered.filter(e => e.paid).reduce((s, e) => s + Number(e.amount), 0)
  const unpaidTotal = totalFiltered - paidTotal
  const selectedTotal = filtered.filter(e => selected.has(e.id)).reduce((s, e) => s + Number(e.amount), 0)
  const allSelected = filtered.length > 0 && filtered.every(e => selected.has(e.id))
  function toggleSelectAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(filtered.map(e => e.id)))
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Расходы</h1>
        <button
          onClick={() => { setShowModal(true); setEditExpense(null); setForm({ car_id: '', title: '', notes: '', amount: '', date: format(new Date(), 'yyyy-MM-dd') }); setFiles([]); setExistingFiles([]) }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} /> ÐÐ¾Ð±Ð°Ð²Ð¸ÑÑ ÑÐ°ÑÑÐ¾Ð´
        </button>
      </div>

      {/* Month tabs */}
      <div className="flex gap-1.5 mb-5 overflow-x-auto pb-1">
        <button
          onClick={() => setFilterMonth('all')}
          className={`px-3 py-1.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${filterMonth === 'all' ? 'bg-[#4F46E5] text-white' : 'bg-white text-gray-500 hover:bg-gray-100 border border-gray-200'}`}
        >
          ÐÑÐµ
        </button>
        {months.map(m => (
          <button
            key={m.value}
            onClick={() => setFilterMonth(m.value)}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all capitalize ${filterMonth === m.value ? 'bg-[#4F46E5] text-white' : 'bg-white text-gray-500 hover:bg-gray-100 border border-gray-200'}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-4 mb-6">
        <Select
          value={filterCar}
          onChange={setFilterCar}
          options={[{ value: '', label: 'ÐÑÐµ Ð°Ð²ÑÐ¾' }, ...cars.map(c => ({ value: c.id, label: `${c.make} ${c.model} ${c.plate}` }))]}
        />
        {filtered.length > 0 && (
          <span className="text-sm text-gray-500">ÐÑÐ¾Ð³Ð¾: <strong className="text-gray-900">${totalFiltered.toFixed(2)}</strong></span>
        )}
      </div>

      {loading ? <div className="text-gray-400">ÐÐ°Ð³ÑÑÐ·ÐºÐ°...</div> : (
        <div className="bg-white rounded-[18px] overflow-hidden card-shadow border border-gray-100/80">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr className="text-left text-gray-500">
                <th className="pl-6 pr-2 py-4 w-10">
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="w-4 h-4 rounded border-gray-300 accent-[#4F46E5] cursor-pointer" />
                </th>
                <th className="px-6 py-4 font-medium">ÐÐ°ÑÐ°</th>
                <th className="px-6 py-4 font-medium">ÐÐ²ÑÐ¾</th>
                <th className="px-6 py-4 font-medium">Ð¡ÑÐ°ÑÑÑ</th>
                <th className="px-6 py-4 font-medium text-right">Ð¡ÑÐ¼Ð¼Ð°</th>
                <th className="px-6 py-4 font-medium text-center">ÐÐ¿Ð»Ð°ÑÐ°</th>
                <th className="px-6 py-4 font-medium text-center">Ð§ÐµÐºÐ¸</th>
                <th className="px-6 py-4 font-medium text-right">ÐÐµÐ¹ÑÑÐ²Ð¸Ñ</th>
              </tr>
            </thead>
            <tbody>
              {[...filtered.filter(e => e.paid), ...filtered.filter(e => !e.paid)].map((exp, idx, arr) => (
                <React.Fragment key={exp.id}>
                  {!exp.paid && idx > 0 && arr[idx - 1].paid && (
                    <tr className="bg-rose-50/40">
                      <td colSpan={8} className="px-6 py-2 text-xs font-semibold text-rose-400 uppercase tracking-wider border-y border-rose-100">
                        ÐÐµ Ð¾Ð¿Ð»Ð°ÑÐµÐ½Ð¾
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
                      ) : 'â'}
                    </td>
                    <td className="px-6 py-4 font-medium">
                      {exp.title}
                      {exp.notes && <span className="text-gray-400 font-normal ml-1.5 text-xs">Â· {exp.notes}</span>}
                    </td>
                    <td className="px-6 py-4 text-right font-semibold">${Number(exp.amount).toFixed(2)}</td>
                    <td className="px-6 py-4 text-center">
                      {exp.paid ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-600">ÐÐ¿Ð»Ð°ÑÐµÐ½Ð¾</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium bg-rose-50 text-rose-400">ÐÐµ Ð¾Ð¿Ð»Ð°ÑÐµÐ½Ð¾</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {exp.files?.length > 0 ? (
                        <div className="flex items-center justify-center gap-1">
                          {exp.files.map((f, i) => (
                            <div key={i} className="flex gap-0.5">
                              <button onClick={() => handlePreview(f)} onMouseDown={e => e.preventDefault()} className="p-1 rounded hover:bg-blue-50 text-blue-500 transition-colors" title="ÐÑÐºÑÑÑÑ"><ImageIcon size={14} /></button>
                              <button onClick={() => handleDownload(f)} className="p-1 rounded hover:bg-blue-50 text-blue-500 transition-colors" title="Ð¡ÐºÐ°ÑÐ°ÑÑ"><Download size={14} /></button>
                            </div>
                          ))}
                          <span className="text-gray-400 text-xs ml-1">({exp.files.length})</span>
                        </div>
                      ) : <span className="text-gray-300">â</span>}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openEdit(exp)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"><Edit2 size={15} /></button>
                        <button onClick={() => setDeleteExpense(exp)} className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                </React.Fragment>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-6 py-8 text-center text-gray-400">Ð Ð°ÑÑÐ¾Ð´Ð¾Ð² Ð½ÐµÑ</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="flex items-center gap-8 mt-4 px-1">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">ÐÑÐµÐ³Ð¾:</span>
            <span className="text-lg font-bold text-gray-900">${totalFiltered.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">ÐÐ¿Ð»Ð°ÑÐµÐ½Ð¾:</span>
            <span className="text-lg font-bold text-emerald-600">${paidTotal.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">ÐÑÑÐ°Ð»Ð¾ÑÑ Ð²ÑÐ¿Ð»Ð°ÑÐ¸ÑÑ:</span>
            <span className="text-lg font-bold text-rose-400">${unpaidTotal.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Floating add button (FAB) */}
      <button
        onClick={() => { setShowModal(true); setEditExpense(null); setForm({ car_id: '', title: '', notes: '', amount: '', date: format(new Date(), 'yyyy-MM-dd') }); setFiles([]); setExistingFiles([]) }}
        title="ÐÐ¾Ð±Ð°Ð²Ð¸ÑÑ ÑÐ°ÑÑÐ¾Ð´"
        className="fixed bottom-6 right-6 z-30 w-14 h-14 rounded-full bg-gradient-to-br from-[#4F46E5] to-[#7C3AED] text-white flex items-center justify-center transition-all duration-300 hover:scale-105"
        style={{
          boxShadow: '0 8px 24px rgba(79,70,229,0.45)',
          transform: selected.size > 0 ? 'translateX(120px)' : 'translateX(0)',
          opacity: selected.size > 0 ? 0 : 1,
          pointerEvents: selected.size > 0 ? 'none' : 'auto',
        }}
      >
        <Plus size={26} strokeWidth={2.4} />
      </button>

      {/* Floating selection panel */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 right-6 z-40 bg-white rounded-2xl border border-gray-200 shadow-2xl px-5 py-4 w-[300px] animate-in">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-gray-500">ÐÑÐ±ÑÐ°Ð½Ð¾: {selected.size}</span>
            <button onClick={() => setSelected(new Set())} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
          </div>
          <p className="text-2xl font-bold text-gray-900 mb-3">${selectedTotal.toFixed(2)}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => markPaid(true)} className="flex-1 px-3 py-2 rounded-xl text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors">
              ÐÑÐ¼ÐµÑÐ¸ÑÑ Ð¾Ð¿Ð»Ð°ÑÐµÐ½Ð½ÑÐ¼
            </button>
            <button onClick={() => markPaid(false)} className="px-3 py-2 rounded-xl text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors whitespace-nowrap">
              Ð¡Ð½ÑÑÑ
            </button>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteExpense && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setDeleteExpense(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Ð£Ð´Ð°Ð»Ð¸ÑÑ ÑÐ°ÑÑÐ¾Ð´?</h2>
            <p className="text-sm text-gray-500 mb-6">
              <span className="font-medium text-gray-800">{deleteExpense.title}</span> Â· ${Number(deleteExpense.amount).toFixed(2)} Ð±ÑÐ´ÐµÑ ÑÐ´Ð°Ð»ÑÐ½ Ð±ÐµÐ·Ð²Ð¾Ð·Ð²ÑÐ°ÑÐ½Ð¾.
            </p>
            <div className="flex gap-3">
              <button onClick={handleDelete} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition-all">
                Ð£Ð´Ð°Ð»Ð¸ÑÑ
              </button>
              <button onClick={() => setDeleteExpense(null)} className="flex-1 py-2.5 rounded-xl text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-all">
                ÐÑÐ¼ÐµÐ½Ð°
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-5">{editExpense ? 'Ð ÐµÐ´Ð°ÐºÑÐ¸ÑÐ¾Ð²Ð°ÑÑ ÑÐ°ÑÑÐ¾Ð´' : 'ÐÐ¾Ð±Ð°Ð²Ð¸ÑÑ ÑÐ°ÑÑÐ¾Ð´'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ð¡ÑÐ°ÑÑÑ ÑÐ°ÑÑÐ¾Ð´Ð¾Ð²</label>
                <select required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                  <option value="">ÐÑÐ±ÐµÑÐ¸ÑÐµ ÑÑÐ°ÑÑÑ...</option>
                  {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ÐÐ¾Ð¼Ð¼ÐµÐ½ÑÐ°ÑÐ¸Ð¹ (Ð½ÐµÐ¾Ð±ÑÐ·Ð°ÑÐµÐ»ÑÐ½Ð¾)</label>
                <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="ÐÐ¾Ð¿. Ð¸Ð½ÑÐ¾ÑÐ¼Ð°ÑÐ¸Ñ..." className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ÐÐ²ÑÐ¾</label>
                <Select
                  value={form.car_id}
                  onChange={val => setForm(f => ({ ...f, car_id: val }))}
                  options={[
                    { value: '', label: 'ÐÑÐ±ÐµÑÐ¸ÑÐµ Ð°Ð²ÑÐ¾' },
                    ...cars.map(c => ({ value: c.id, label: `${c.make} ${c.model} ${c.plate}` })),
                  ]}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">ÐÐ°ÑÐ°</label>
                  <DatePicker value={form.date} onChange={val => setForm(f => ({ ...f, date: val }))} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ð¡ÑÐ¼Ð¼Ð° ($)</label>
                  <input type="number" step="0.01" min="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required placeholder="0.00" className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              {/* File upload */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Ð¤Ð¾ÑÐ¾ ÑÐµÐºÐ¾Ð² (Ð´Ð¾ 5 ÑÑÑÐº)</label>
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
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 border-2 border-dashed border-blue-200 hover:border-blue-400 rounded-lg px-4 py-3 w-full justify-center transition-colors"
                  >
                    <Paperclip size={15} /> ÐÑÐ¸ÐºÑÐµÐ¿Ð¸ÑÑ ÑÐ¾ÑÐ¾
                  </button>
                )}
                <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple onChange={handleFileChange} className="hidden" />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={uploading} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                  {uploading ? 'Ð¡Ð¾ÑÑÐ°Ð½ÑÐµÐ¼...' : 'Ð¡Ð¾ÑÑÐ°Ð½Ð¸ÑÑ'}
                </button>
                <button type="button" onClick={() => { setShowModal(false); setEditExpense(null) }} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 rounded-lg text-sm font-medium transition-colors">
                  ÐÑÐ¼ÐµÐ½Ð°
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Image preview */}
      {previewUrl && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => { setPreviewUrl(null); setPreviewLoading(false) }}>
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
                alt="Ð§ÐµÐº"
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

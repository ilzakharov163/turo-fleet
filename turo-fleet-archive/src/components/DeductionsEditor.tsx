'use client'

import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { createClient } from '@/lib/supabase'
import { log } from '@/lib/logger'
import { ask, notify } from '@/lib/ui'
import DatePicker from '@/components/ui/DatePicker'
import { inputCls } from '@/components/ui/PageShell'

// Штрафы и вычеты из зарплаты работника (таблица salary_deductions).
// Используется в «Доходы → Расходы» и в «Авто → Простои и зарплата». month — 'yyyy-MM'.
export interface Deduction { id: string; date: string; reason: string; amount: number }

const usd = (v: number) => `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`

export default function DeductionsEditor({ month, items, onChanged, compact = false }: {
  month: string
  items: Deduction[]          // вычеты этого месяца
  onChanged: () => void       // перезагрузить данные у родителя
  compact?: boolean           // форма в одну колонку (узкая карточка)
}) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [date, setDate] = useState(today.startsWith(month) ? today : `${month}-01`)
  const [reason, setReason] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const total = items.reduce((s, d) => s + Number(d.amount), 0)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const value = parseFloat(amount.replace(',', '.'))
    if (!reason.trim() || !(value > 0) || busy) return
    setBusy(true)
    const { data, error } = await createClient().from('salary_deductions').insert({ date, reason: reason.trim(), amount: value }).select('id').single()
    setBusy(false)
    if (error) return
    await log('create', 'salary_deduction', data?.id || '', { date, reason: reason.trim(), amount: value })
    notify('Вычет записан', 'success')
    setReason(''); setAmount('')
    onChanged()
  }

  async function remove(d: Deduction) {
    if (!await ask('Удалить вычет?', { detail: `${d.reason} · ${usd(d.amount)}`, ok: 'Удалить', danger: true })) return
    const { error } = await createClient().from('salary_deductions').delete().eq('id', d.id)
    if (error) return
    await log('delete', 'salary_deduction', d.id, { reason: d.reason, amount: d.amount })
    onChanged()
  }

  return (
    <div>
      {items.length > 0 ? (
        <ul className="divide-y divide-gray-100 mb-3">
          {items.map((d, i) => (
            <li key={d.id} className="flex items-center gap-2.5 py-2 text-sm">
              <span className="w-5 text-xs text-gray-400 tabular-nums">{i + 1}.</span>
              <span className="w-14 flex-shrink-0 text-xs text-gray-500 tabular-nums">{format(parseISO(d.date), 'd MMM', { locale: ru })}</span>
              <span className="flex-1 min-w-0 text-gray-800 break-words">{d.reason}</span>
              <span className="font-semibold text-rose-500 tabular-nums whitespace-nowrap">−{usd(d.amount)}</span>
              <button type="button" onClick={() => remove(d)} className="w-8 h-8 flex-shrink-0 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 flex items-center justify-center" aria-label="Удалить вычет"><X size={15} /></button>
            </li>
          ))}
          <li className="flex items-center justify-between py-2 text-sm font-semibold">
            <span className="text-gray-600">Итого вычетов</span>
            <span className="text-rose-500 tabular-nums">−{usd(total)}</span>
          </li>
        </ul>
      ) : <p className="text-sm text-gray-400 mb-3">Штрафов и вычетов в этом месяце нет</p>}

      <form onSubmit={add} className={compact ? 'space-y-2' : 'grid grid-cols-2 sm:grid-cols-[150px_1fr_120px_auto] gap-2 items-end'}>
        <div className={compact ? '' : 'col-span-2 sm:col-span-1 order-first sm:order-none'}>
          {!compact && <label className="block text-xs text-gray-500 mb-1">За что</label>}
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder={compact ? "За что" : "За что (например, не помыл машину)"} className={inputCls} />
        </div>
        <div className={compact ? 'grid grid-cols-[1fr_110px] gap-2' : 'contents'}>
          <div className={compact ? '' : 'sm:order-first'}>
            {!compact && <label className="block text-xs text-gray-500 mb-1">Дата</label>}
            <DatePicker value={date} onChange={setDate} />
          </div>
          <div>
            {!compact && <label className="block text-xs text-gray-500 mb-1">Сумма, $</label>}
            <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="$ 0" className={inputCls} />
          </div>
        </div>
        <button type="submit" disabled={!reason.trim() || !amount || busy} className={`btn-primary h-11 px-4 inline-flex items-center justify-center gap-1.5 ${compact ? 'w-full' : 'col-span-2 sm:col-span-1'}`}>
          <Plus size={15} /> {busy ? 'Записываю…' : 'Добавить вычет'}
        </button>
      </form>
    </div>
  )
}

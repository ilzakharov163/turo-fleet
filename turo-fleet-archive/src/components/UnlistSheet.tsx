'use client'

import { useState } from 'react'
import { ShieldAlert, PauseCircle } from 'lucide-react'
import { format } from 'date-fns'
import { createClient } from '@/lib/supabase'
import { log } from '@/lib/logger'
import { notify } from '@/lib/ui'
import { unlistByClaim } from '@/lib/unlist'
import { Modal, FormField, inputCls, ModalActions, CancelButton } from '@/components/ui/PageShell'
import DatePicker from '@/components/ui/DatePicker'
import { Car } from '@/types'

// «В простой / снять с листинга» (кнопка статуса «В работе» и «Снять с листинга»): машина уходит в простой с выбранной даты.
// Причина «Клейм» — сразу создаётся клейм (номер обязателен, описание по желанию), машина в простое «Клейм №…».
// «Другая причина» — просто простой с этой причиной.
export default function UnlistSheet({ car, alreadyIdle, onClose, onDone }: {
  car: Car
  alreadyIdle: boolean        // машина уже в простое — новый простой не создаём
  onClose: () => void
  onDone: () => void
}) {
  const [reason, setReason] = useState<'claim' | 'other'>('claim')
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState('')   // необязательно: до какого числа
  const [claimNumber, setClaimNumber] = useState('')
  const [description, setDescription] = useState('')
  const [otherReason, setOtherReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const canSave = reason === 'claim' ? claimNumber.trim().length > 0 : otherReason.trim().length > 0

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!canSave || busy) return
    setBusy(true); setError('')
    const supabase = createClient()
    const num = claimNumber.trim()
    const desc = description.trim()

    if (reason === 'claim') {
      // Такой номер уже есть? Открытый клейм этой же машины (она каталась с клеймом) — снимаем по нему
      const { data: dup } = await supabase.from('claims').select('id, car_id, status, description, claim_number').ilike('claim_number', num.replace(/[%_\\]/g, m => `\\${m}`)).limit(1)
      const ex = dup?.[0]
      if (ex && (ex.car_id !== car.id || ex.status === 'done')) {
        setBusy(false)
        setError(ex.car_id !== car.id ? `Клейм № ${num} уже есть у другой машины` : `Клейм № ${num} уже завершён`)
        return
      }
      if (ex) {
        const ok = await unlistByClaim({ carId: car.id, claimId: ex.id, claimNumber: ex.claim_number || num, description: desc || ex.description, date, endDate: endDate || null })
        if (desc && !ex.description) await supabase.from('claims').update({ description: desc }).eq('id', ex.id)
        setBusy(false)
        if (!ok) return
        notify(`Машина в простое по клейму № ${ex.claim_number || num}`, 'success')
        onDone()
        return
      }
      const { data, error } = await supabase.from('claims').insert({
        car_id: car.id, status: 'waiting', opened_date: date, claim_number: num, description: desc || null, still_listed: false,
      }).select('id').single()
      if (error) { setBusy(false); return }
      await log('create', 'claim', data?.id || '', { car_id: car.id, claim_number: num, opened_date: date, from: 'unlist' })
    }

    if (!alreadyIdle) {
      const blockReason = reason === 'claim' ? `Клейм № ${num}${desc ? ` — ${desc}` : ''}` : otherReason.trim()
      const { data, error } = await supabase.from('car_blocks').insert({ car_id: car.id, start_date: date, end_date: endDate || null, reason: blockReason }).select('id').single()
      if (error) { setBusy(false); return }
      await log('create', 'car_block', data?.id || '', { car_id: car.id, start_date: date, end_date: endDate || null, reason: blockReason })
    }

    setBusy(false)
    notify(reason === 'claim' ? `В простое, клейм № ${num} создан` : 'Машина в простое', 'success')
    onDone()
  }

  const choice = (on: boolean) => `flex-1 flex items-center justify-center gap-2 h-12 rounded-xl border text-sm font-semibold transition-colors ${on ? 'border-[#4F46E5] bg-indigo-50 text-[#4F46E5] dark:text-indigo-300' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`

  return (
    <Modal title="В простой (снять с листинга)" onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <p className="text-sm text-gray-500 -mt-1">{car.make} {car.model} <span className="font-mono font-semibold text-gray-700">{car.plate}</span></p>

        <div className="flex gap-2">
          <button type="button" onClick={() => setReason('claim')} className={choice(reason === 'claim')}><ShieldAlert size={17} /> Клейм</button>
          <button type="button" onClick={() => setReason('other')} className={choice(reason === 'other')}><PauseCircle size={17} /> Другая причина</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="С какого числа">
            <DatePicker value={date} onChange={setDate} />
          </FormField>
          <FormField label="По (необязательно)">
            <DatePicker value={endDate} onChange={setEndDate} />
          </FormField>
        </div>

        {reason === 'claim' ? (
          <>
            <FormField label="Номер клейма *">
              <input autoFocus value={claimNumber} onChange={e => { setClaimNumber(e.target.value); setError('') }} placeholder="Например, 12345678" className={inputCls} />
            </FormField>
            <FormField label="Что случилось (коротко)">
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Например, бампер и фара после ДТП" className={inputCls} />
            </FormField>
            <p className="text-xs text-gray-500">Клейм сразу появится в «Авто → Клеймы» со статусом «Ожидает ремонта», а машина будет в простое с этой даты. Если клейм уже открыт (машина каталась с ним) — введите его номер, машина снимется по нему. «По» обычно оставьте пустым — вернёте в работу, когда починят.</p>
          </>
        ) : (
          <FormField label="Причина *">
            <input autoFocus value={otherReason} onChange={e => setOtherReason(e.target.value)} placeholder="Например, ТО, личное пользование…" className={inputCls} />
          </FormField>
        )}

        {alreadyIdle && <p className="text-xs text-orange-600">Машина уже в простое — новый простой не создаётся{reason === 'claim' ? ', будет создан только клейм' : ''}.</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <ModalActions>
          <CancelButton onClick={onClose} />
          <button type="submit" disabled={!canSave || busy || (alreadyIdle && reason === 'other')} className="btn-primary flex-1 h-11">{busy ? 'Сохраняю…' : 'В простой'}</button>
        </ModalActions>
      </form>
    </Modal>
  )
}

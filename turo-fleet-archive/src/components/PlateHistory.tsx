'use client'

import { useEffect, useState } from 'react'
import { History, Search, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Modal } from '@/components/ui/PageShell'
import { loadPlateHistory, normPlate, type PlateChange } from '@/lib/plates'

interface CarLite { id: string; make: string; model: string; plate: string }

// Кнопка «Старые номера» + окно: какие номера были у машин раньше (из «Наклейки → Замена номеров»).
// onPick — в форме клейма: нажатие на машину выбирает её.
export default function PlateHistory({ cars, onPick, label = 'Старые номера', className = '' }: {
  cars: CarLite[]
  onPick?: (carId: string) => void
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<PlateChange[] | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!open || list) return
    loadPlateHistory().then(setList)
  }, [open, list])

  const byCar = new Map<string, PlateChange[]>()
  for (const x of list || []) byCar.set(x.car_id, [...(byCar.get(x.car_id) || []), x])
  const nq = normPlate(q)
  const rows = [...byCar.entries()]
    .map(([carId, changes]) => ({ car: cars.find(c => c.id === carId), changes }))
    .filter(r => r.car && (!nq || [r.car.plate, ...r.changes.map(c => c.old_plate)].some(p => normPlate(p).includes(nq))
      || `${r.car.make} ${r.car.model}`.toUpperCase().includes(q.trim().toUpperCase())))

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`inline-flex items-center gap-1.5 text-sm font-medium text-[#4F46E5] dark:text-indigo-300 hover:underline ${className}`}>
        <History size={14} /> {label}
      </button>
      {open && (
        <Modal title="Старые номера машин" onClose={() => setOpen(false)}>
          <div className="space-y-3">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Старый или новый номер, машина…"
                className="w-full h-11 pl-9 pr-9 text-base sm:text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400/30 focus:border-indigo-400" />
              {q && <button type="button" onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" aria-label="Очистить"><X size={15} /></button>}
            </div>
            {list === null ? <div className="skeleton h-16" /> : rows.length === 0 ? (
              <p className="text-sm text-gray-400 py-2">{q ? 'Ничего не найдено' : 'Замен номеров пока нет'}</p>
            ) : (
              <ul className="divide-y divide-gray-100 -mx-1">
                {rows.map(({ car, changes }) => (
                  <li key={car!.id}>
                    <button type="button" disabled={!onPick} onClick={() => { onPick?.(car!.id); setOpen(false) }}
                      className={`w-full text-left px-1 py-2.5 rounded-lg ${onPick ? 'hover:bg-indigo-50/60' : 'cursor-default'}`}>
                      <p className="text-sm text-gray-700">{car!.make} {car!.model} <span className="font-mono font-semibold text-gray-900">{car!.plate}</span> <span className="text-xs text-gray-400">сейчас</span></p>
                      {changes.map((c, i) => (
                        <p key={i} className="text-xs text-gray-500 mt-0.5">
                          был <span className="font-mono font-semibold text-gray-700 line-through decoration-gray-300">{c.old_plate}</span> · заменён {format(parseISO(c.changed_date), 'd MMMM yyyy', { locale: ru })}
                        </p>
                      ))}
                      {onPick && <p className="text-[11px] text-[#4F46E5] dark:text-indigo-300 mt-1">Нажмите, чтобы выбрать эту машину</p>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-gray-400">Номера берутся из «Наклейки → Замена номеров». Замены до 27 октября записаны без номеров.</p>
          </div>
        </Modal>
      )}
    </>
  )
}

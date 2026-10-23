'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import { format, addMonths, subMonths, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import Popover from './Popover'

// Переключатель месяца: ‹ Октябрь 2026 › — по нажатию на название открывается сетка месяцев.
// value — 'yyyy-MM' или 'all' (весь доступный период).
const MONTHS = Array.from({ length: 12 }, (_, i) => format(new Date(2026, i, 1), 'LLL', { locale: ru }).replace('.', ''))
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export default function MonthPicker({ value, onChange, min, max, allLabel, className = '' }: {
  value: string
  onChange: (v: string) => void
  min: string        // 'yyyy-MM'
  max: string        // 'yyyy-MM'
  allLabel?: string  // если задан — есть пункт «весь период»
  className?: string
}) {
  const cur = value === 'all' ? max : value
  const [year, setYear] = useState(Number(cur.slice(0, 4)))
  const step = (d: number) => {
    const next = format((d > 0 ? addMonths : subMonths)(parseISO(`${cur}-01`), 1), 'yyyy-MM')
    if (next >= min && next <= max) onChange(next)
  }
  const label = value === 'all' ? allLabel : cap(format(parseISO(`${value}-01`), 'LLLL yyyy', { locale: ru }))

  return (
    <div className={`flex items-center justify-between h-10 rounded-xl bg-white border border-gray-200 ${className}`}>
      <button onClick={() => step(-1)} disabled={value === 'all' || cur <= min} className="w-9 h-full flex items-center justify-center text-gray-500 disabled:text-gray-300" aria-label="Предыдущий месяц"><ChevronLeft size={17} /></button>
      <Popover
        panelClass="sm:w-72"
        trigger={(open, toggle) => (
          <button onClick={() => { setYear(Number(cur.slice(0, 4))); toggle() }} className={`h-10 px-1.5 inline-flex items-center gap-1.5 text-sm font-semibold whitespace-nowrap ${open ? 'text-[#4F46E5]' : 'text-gray-900'}`}>
            {label} <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      >
        {close => (
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <button onClick={() => setYear(y => y - 1)} disabled={`${year - 1}-12` < min} className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 disabled:text-gray-300" aria-label="Предыдущий год"><ChevronLeft size={17} /></button>
              <span className="text-base font-bold text-gray-900">{year}</span>
              <button onClick={() => setYear(y => y + 1)} disabled={`${year + 1}-01` > max} className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 disabled:text-gray-300" aria-label="Следующий год"><ChevronRight size={17} /></button>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-3 gap-1.5">
              {MONTHS.map((m, i) => {
                const v = `${year}-${String(i + 1).padStart(2, '0')}`
                const off = v < min || v > max
                const active = v === value
                return (
                  <button key={v} disabled={off} onClick={() => { onChange(v); close() }}
                    className={`h-11 rounded-xl text-sm font-medium capitalize transition-colors ${active ? 'bg-[#4F46E5] text-white' : off ? 'text-gray-300' : 'text-gray-700 hover:bg-gray-100'}`}>
                    {m}
                  </button>
                )
              })}
            </div>
            {allLabel && (
              <button onClick={() => { onChange('all'); close() }}
                className={`mt-3 w-full h-11 rounded-xl text-sm font-medium ${value === 'all' ? 'bg-[#4F46E5] text-white' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'}`}>
                {allLabel}
              </button>
            )}
          </div>
        )}
      </Popover>
      <button onClick={() => step(1)} disabled={value === 'all' || cur >= max} className="w-9 h-full flex items-center justify-center text-gray-500 disabled:text-gray-300" aria-label="Следующий месяц"><ChevronRight size={17} /></button>
    </div>
  )
}

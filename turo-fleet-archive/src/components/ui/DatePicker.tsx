'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameDay, addMonths, subMonths, parseISO,
  startOfWeek, endOfWeek, isToday, isSameMonth
} from 'date-fns'
import { ru } from 'date-fns/locale'

interface DatePickerProps {
  value: string
  onChange: (val: string) => void
  placeholder?: string
  required?: boolean
}

export default function DatePicker({ value, onChange, placeholder = 'Выберите дату', required }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState(() => value ? parseISO(value) : new Date())
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const updatePos = useCallback(() => {
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const DROP_H = 360
    // если снизу не помещается, а сверху места больше — открываем вверх
    const spaceBelow = window.innerHeight - r.bottom
    const top = spaceBelow < DROP_H && r.top > spaceBelow
      ? r.top - DROP_H - 6
      : r.bottom + 6
    setDropPos({ top, left: r.left, width: r.width })
  }, [])

  function toggleOpen() {
    if (open) {
      setOpen(false)
      setDropPos(null)
    } else {
      updatePos()
      setOpen(true)
    }
  }

  useEffect(() => {
    if (!open) return
    function onScroll() { updatePos() }
    function onMouseDown(e: MouseEvent) {
      if (
        btnRef.current?.contains(e.target as Node) ||
        dropRef.current?.contains(e.target as Node)
      ) return
      setOpen(false)
      setDropPos(null)
    }
    window.addEventListener('scroll', onScroll, true)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [open, updatePos])

  useEffect(() => {
    if (value) setViewMonth(parseISO(value))
  }, [value])

  const selected = value ? parseISO(value) : null

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 }),
  })

  const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

  function close() {
    setOpen(false)
    setDropPos(null)
  }

  function selectDay(day: Date) {
    onChange(format(day, 'yyyy-MM-dd'))
    close()
  }

  const dropdown = open && dropPos ? createPortal(
    <div
      ref={dropRef}
      style={{
        position: 'fixed',
        top: dropPos.top,
        left: dropPos.left,
        width: Math.max(dropPos.width, 288),
        zIndex: 9999,
      }}
    >
      <div
        className="bg-white rounded-[16px] border border-gray-100 p-4"
        style={{ boxShadow: '0 8px 32px rgba(17,17,26,0.14), 0 2px 8px rgba(17,17,26,0.06)' }}
      >
        {/* Month nav */}
        <div className="flex items-center justify-between mb-4">
          <button type="button" onClick={() => setViewMonth(m => subMonths(m, 1))}
            className="w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-500 transition-colors">
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-bold text-gray-900 capitalize">
            {format(viewMonth, 'LLLL yyyy', { locale: ru })}
          </span>
          <button type="button" onClick={() => setViewMonth(m => addMonths(m, 1))}
            className="w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-500 transition-colors">
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Week days */}
        <div className="grid grid-cols-7 mb-1">
          {weekDays.map(d => (
            <div key={d} className="text-center text-xs font-semibold text-gray-400 py-1">{d}</div>
          ))}
        </div>

        {/* Days */}
        <div className="grid grid-cols-7 gap-y-0.5">
          {days.map(day => {
            const inMonth = isSameMonth(day, viewMonth)
            const sel = selected && isSameDay(day, selected)
            const today = isToday(day)
            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => selectDay(day)}
                className={`h-8 w-full rounded-[8px] text-sm font-medium transition-all ${
                  sel
                    ? 'bg-[#4F46E5] text-white shadow-sm'
                    : today && !sel
                    ? 'bg-indigo-50 text-[#4F46E5] font-bold'
                    : inMonth
                    ? 'text-gray-700 hover:bg-gray-100'
                    : 'text-gray-300 hover:bg-gray-50'
                }`}
              >
                {format(day, 'd')}
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
          <button type="button" onClick={() => { onChange(''); close() }}
            className="text-xs text-gray-400 hover:text-red-500 font-medium transition-colors">
            Очистить
          </button>
          <button type="button" onClick={() => selectDay(new Date())}
            className="text-xs text-[#4F46E5] hover:text-indigo-800 font-semibold transition-colors">
            Сегодня
          </button>
        </div>
      </div>
    </div>,
    document.body
  ) : null

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={toggleOpen}
        className={`w-full flex items-center gap-2.5 border rounded-[10px] px-3.5 py-2.5 text-sm text-left transition-all ${
          open
            ? 'border-indigo-400 bg-white ring-2 ring-indigo-400/20'
            : 'border-gray-200 bg-gray-50 hover:bg-white'
        }`}
      >
        <Calendar size={15} className="text-gray-400 flex-shrink-0" />
        <span className={selected ? 'text-gray-900 font-medium' : 'text-gray-400'}>
          {selected ? format(selected, 'd MMMM yyyy', { locale: ru }) : placeholder}
        </span>
      </button>

      {dropdown}

      {required && <input type="text" value={value} required readOnly className="sr-only" tabIndex={-1} />}
    </div>
  )
}

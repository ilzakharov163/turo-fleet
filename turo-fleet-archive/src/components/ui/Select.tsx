'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { createPortal } from 'react-dom'

interface Option {
  value: string
  label: string
  disabled?: boolean
}

interface SelectProps {
  value: string
  onChange: (val: string) => void
  options: Option[]
  placeholder?: string
  className?: string
}

export default function Select({ value, onChange, options, placeholder = 'Выберите...', className = '' }: SelectProps) {
  const [open, setOpen] = useState(false)
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const selected = options.find(o => o.value === value && !o.disabled)

  function updatePos() {
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const dropWidth = Math.max(r.width, 260)
    const left = r.right - dropWidth < 8 ? 8 : r.right - dropWidth
    setDropPos({ top: r.bottom + 4, left, width: r.width })
  }

  useEffect(() => {
    if (open) updatePos()
  }, [open])

  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (btnRef.current?.contains(e.target as Node) || dropRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  const dropdown = open ? createPortal(
    <div
      ref={dropRef}
      style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, width: Math.max(dropPos.width, 260), zIndex: 9999 }}
    >
      <div className="bg-white rounded-[14px] border border-gray-100 py-1.5 overflow-y-auto"
        style={{ boxShadow: '0 8px 28px rgba(17,17,26,0.12), 0 2px 8px rgba(17,17,26,0.06)', maxHeight: 280 }}>
        {options.map(opt => opt.disabled ? (
          <div key={opt.value} className="px-4 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50/80 border-t border-b border-gray-100 first:border-t-0">
            {opt.label}
          </div>
        ) : (
          <button
            key={opt.value}
            type="button"
            onClick={() => { onChange(opt.value); setOpen(false) }}
            className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors text-left ${
              opt.value === value
                ? 'bg-indigo-50 text-[#4F46E5] font-semibold'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <span className="whitespace-nowrap">{opt.label}</span>
            {opt.value === value && <Check size={13} className="text-[#4F46E5]" />}
          </button>
        ))}
      </div>
    </div>,
    document.body
  ) : null

  return (
    <div className={`relative ${className}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-2 border rounded-[10px] px-3.5 py-2 text-sm font-medium transition-all bg-white ${
          open ? 'border-indigo-400 ring-2 ring-indigo-400/20 text-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-300'
        }`}
      >
        <span>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {dropdown}
    </div>
  )
}

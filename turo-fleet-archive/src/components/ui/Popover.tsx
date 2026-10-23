'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

// Выезжающая панель: на компьютере — под кнопкой, на телефоне — снизу экрана.
export default function Popover({ trigger, children, align = 'left', panelClass = 'sm:w-80' }: {
  trigger: (open: boolean, toggle: () => void) => ReactNode
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
  panelClass?: string  // ширина на компьютере, например 'sm:w-72'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (window.innerWidth >= 640 && !ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const close = () => setOpen(false)

  return (
    <div ref={ref} className="relative">
      {trigger(open, () => setOpen(o => !o))}
      {open && (
        <>
          {/* Телефон: затемнение + панель снизу */}
          <div className="sm:hidden fixed inset-0 z-[70] bg-black/30" onClick={close} />
          <div
            className={`fixed sm:absolute z-[71] left-0 right-0 bottom-0 sm:bottom-auto sm:top-[calc(100%+6px)] ${align === 'right' ? 'sm:left-auto sm:right-0' : 'sm:right-auto sm:left-0'}
              bg-white rounded-t-[22px] sm:rounded-2xl border border-gray-100 shadow-2xl animate-in`}
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            <div className="sm:hidden flex justify-center pt-2.5"><span className="w-10 h-1.5 rounded-full bg-gray-200" /></div>
            <div className={panelClass}>{children(close)}</div>
          </div>
        </>
      )}
    </div>
  )
}

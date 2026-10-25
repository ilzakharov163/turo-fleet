'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// Выезжающая панель: на компьютере — под кнопкой, на телефоне — снизу экрана.
// Рисуется поверх страницы (portal в body), поэтому её не обрезают контейнеры с прокруткой (например, полоса вкладок).
export default function Popover({ trigger, children, align = 'left', panelClass = 'sm:w-80', className = '' }: {
  trigger: (open: boolean, toggle: () => void) => ReactNode
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
  panelClass?: string  // ширина на компьютере, например 'sm:w-72'
  className?: string   // классы обёртки (например, flex-1)
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const close = () => setOpen(false)

  // Положение под кнопкой (для компьютера)
  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos(align === 'right' ? { top: r.bottom + 6, right: window.innerWidth - r.right } : { top: r.bottom + 6, left: r.left })
  }, [open, align])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (window.innerWidth < 640) return
      const t = e.target as Node
      if (ref.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    // Страница прокрутилась — закрываем (прокрутка внутри самой панели не считается)
    const onMove = (e: Event) => {
      if (window.innerWidth < 640) return
      if (e.target instanceof Node && panelRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open])

  return (
    <div ref={ref} className={`relative min-w-0 ${className}`}>
      {trigger(open, () => setOpen(o => !o))}
      {open && pos && createPortal(
        <>
          {/* Телефон: затемнение + панель снизу */}
          <div className="sm:hidden fixed inset-0 z-[70] bg-black/30" onClick={close} />
          <div
            ref={panelRef}
            className="popover-panel fixed z-[71] left-0 right-0 bottom-0 bg-white rounded-t-[22px] sm:rounded-2xl border border-gray-100 shadow-2xl animate-in"
            style={{
              paddingBottom: 'env(safe-area-inset-bottom)',
              ['--pt' as string]: `${pos.top}px`,
              ['--pl' as string]: pos.left !== undefined ? `${pos.left}px` : 'auto',
              ['--pr' as string]: pos.right !== undefined ? `${pos.right}px` : 'auto',
            }}
          >
            <div className="sm:hidden flex justify-center pt-2.5"><span className="w-10 h-1.5 rounded-full bg-gray-200" /></div>
            <div className={panelClass}>{children(close)}</div>
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}

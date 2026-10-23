'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { uiStore, dismissToast, answer } from '@/lib/ui'

const TONE = {
  error: { cls: 'bg-red-600 text-white', Icon: AlertCircle },
  success: { cls: 'bg-gray-900 text-white', Icon: CheckCircle2 },
  info: { cls: 'bg-gray-900 text-white', Icon: Info },
}

export default function Feedback() {
  const { toasts, ask } = useSyncExternalStore(uiStore.subscribe, uiStore.get, uiStore.get)

  useEffect(() => {
    if (!ask) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') answer(false); if (e.key === 'Enter') answer(true) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ask])

  return (
    <>
      {/* Сообщения: сверху на телефоне, снизу справа на компьютере */}
      <div className="fixed z-[80] left-3 right-3 top-[calc(0.75rem+env(safe-area-inset-top))] sm:top-auto sm:left-auto sm:right-6 sm:bottom-6 sm:w-[360px] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => {
          const { cls, Icon } = TONE[t.tone]
          return (
            <div key={t.id} role="status" className={`pointer-events-auto flex items-start gap-2.5 rounded-2xl px-4 py-3 shadow-xl animate-in ${cls}`}>
              <Icon size={18} className="flex-shrink-0 mt-0.5" />
              <p className="flex-1 text-sm font-medium leading-snug">{t.text}</p>
              <button onClick={() => dismissToast(t.id)} className="flex-shrink-0 opacity-70" aria-label="Закрыть"><X size={16} /></button>
            </div>
          )
        })}
      </div>

      {ask && (
        <div className="fixed inset-0 z-[90] bg-black/35 flex items-end sm:items-center justify-center p-3 sm:p-4" onClick={() => answer(false)}>
          <div
            role="alertdialog"
            className="w-full sm:max-w-sm bg-white rounded-[22px] p-5 shadow-2xl animate-in"
            style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
            onClick={e => e.stopPropagation()}
          >
            <p className="text-base font-semibold text-gray-900">{ask.text}</p>
            {ask.detail && <p className="text-sm text-gray-500 mt-1.5">{ask.detail}</p>}
            <div className="flex gap-2 mt-5">
              <button onClick={() => answer(false)} className="btn-secondary flex-1 h-11">Отмена</button>
              <button onClick={() => answer(true)} className={`flex-1 h-11 ${ask.danger ? 'btn-danger' : 'btn-primary'}`} autoFocus>{ask.ok}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

'use client'

import { Suspense, type ComponentType } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { canAny, useAccess } from '@/lib/access'

// Раздел из нескольких вкладок (?tab=key). Вкладка видна, если у пользователя есть хоть одна из её галочек.
export interface SectionTab {
  key: string
  label: string
  short?: string        // подпись на телефоне
  access: string[]      // галочки из «Команды»; [] — всем
  view: ComponentType
}

function Section({ base, tabs }: { base: string; tabs: SectionTab[] }) {
  const router = useRouter()
  const params = useSearchParams()
  const access = useAccess()

  if (!access) return <div className="space-y-3"><div className="skeleton h-11 w-full sm:w-80" />{[0, 1, 2].map(i => <div key={i} className="skeleton h-20" />)}</div>

  const visible = tabs.filter(t => canAny(access, t.access))
  if (visible.length === 0) return <div className="py-10 text-center text-sm text-gray-400">Нет доступа к этому разделу</div>
  const active = visible.find(t => t.key === params.get('tab')) || visible[0]
  const View = active.view

  return (
    <div className="space-y-4 sm:space-y-5">
      {visible.length > 1 && (
        <div className="flex sm:inline-flex w-full sm:w-auto p-1 bg-gray-100 rounded-xl overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {visible.map(t => (
            <button
              key={t.key}
              onClick={() => router.replace(t.key === tabs[0].key ? base : `${base}?tab=${t.key}`, { scroll: false })}
              className={`flex-1 sm:flex-none px-3 sm:px-4 h-9 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                active.key === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
              }`}
            >
              {t.short ? <><span className="sm:hidden">{t.short}</span><span className="hidden sm:inline">{t.label}</span></> : t.label}
            </button>
          ))}
        </div>
      )}
      <View />
    </div>
  )
}

export default function SectionPage({ base, tabs }: { base: string; tabs: SectionTab[] }) {
  return (
    <Suspense>
      <Section base={base} tabs={tabs} />
    </Suspense>
  )
}

'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import CarsView from '@/components/views/CarsView'
import DowntimeView from '@/components/views/DowntimeView'

// «Авто» = машины + простои и зарплата (бывший «Календарь», /cars?tab=downtime)
const TABS = [
  { key: 'list', label: 'Машины', short: 'Машины', href: '/cars' },
  { key: 'downtime', label: 'Простои и зарплата', short: 'Простои', href: '/cars?tab=downtime' },
]

function CarsSection() {
  const router = useRouter()
  const tab = useSearchParams().get('tab') === 'downtime' ? 'downtime' : 'list'

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex sm:inline-flex w-full sm:w-auto p-1 bg-gray-100 rounded-xl">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => router.replace(t.href, { scroll: false })}
            className={`flex-1 sm:flex-none px-4 h-9 rounded-lg text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            }`}
          >
            <span className="sm:hidden">{t.short}</span>
            <span className="hidden sm:inline whitespace-nowrap">{t.label}</span>
          </button>
        ))}
      </div>
      {tab === 'list' ? <CarsView /> : <DowntimeView />}
    </div>
  )
}

export default function CarsPage() {
  return (
    <Suspense>
      <CarsSection />
    </Suspense>
  )
}

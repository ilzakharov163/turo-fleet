'use client'

import SectionPage from '@/components/SectionPage'
import ReportsView from '@/components/views/ReportsView'
import AnalyticsView from '@/components/views/AnalyticsView'

// «Отчёты»: готовые отчёты для Telegram/Excel и аналитика расходов
export default function ReportsPage() {
  return (
    <SectionPage
      base="/reports"
      tabs={[
        { key: 'reports', label: 'Отчёты', access: ['/reports'], view: ReportsView },
        { key: 'analytics', label: 'Аналитика', access: ['/analytics'], view: AnalyticsView },
      ]}
    />
  )
}

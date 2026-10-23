'use client'

import SectionPage from '@/components/SectionPage'
import ReportsView from '@/components/views/ReportsView'
import AnalyticsView from '@/components/views/AnalyticsView'
import CarProfitView from '@/components/views/CarProfitView'

// «Отчёты»: готовые отчёты для Telegram/Excel, прибыль по машинам (месяц / всё время) и аналитика расходов
export default function ReportsPage() {
  return (
    <SectionPage
      base="/reports"
      tabs={[
        { key: 'reports', label: 'Отчёты', access: ['/reports'], view: ReportsView },
        { key: 'cars', label: 'Прибыль машин', short: 'Машины', access: ['/income'], view: CarProfitView },
        { key: 'analytics', label: 'Аналитика', access: ['/analytics'], view: AnalyticsView },
      ]}
    />
  )
}

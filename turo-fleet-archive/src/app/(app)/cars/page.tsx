'use client'

import SectionPage from '@/components/SectionPage'
import CarsView from '@/components/views/CarsView'
import DowntimeView from '@/components/views/DowntimeView'
import ClaimsView from '@/components/views/ClaimsView'
import StickersView from '@/components/views/StickersView'

// «Авто»: машины, простои и зарплата (бывший «Календарь»), клеймы, наклейки
export default function CarsPage() {
  return (
    <SectionPage
      base="/cars"
      tabs={[
        { key: 'list', label: 'Машины', access: ['/cars'], view: CarsView },
        { key: 'downtime', label: 'Простои и зарплата', short: 'Простои', access: ['/cars'], view: DowntimeView },
        { key: 'claims', label: 'Клеймы', access: ['/claims'], view: ClaimsView },
        { key: 'stickers', label: 'Наклейки', access: ['/stickers'], view: StickersView },
      ]}
    />
  )
}

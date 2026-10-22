'use client'

import SectionPage from '@/components/SectionPage'
import { ADMIN_ONLY } from '@/lib/access'
import ProfileView from '@/components/views/ProfileView'
import TeamView from '@/components/views/TeamView'
import LogView from '@/components/views/LogView'

// «Настройки»: личный кабинет (всем), команда (только админ), история действий
export default function SettingsPage() {
  return (
    <SectionPage
      base="/settings"
      tabs={[
        { key: 'profile', label: 'Профиль', access: [], view: ProfileView },
        { key: 'team', label: 'Команда', access: [ADMIN_ONLY], view: TeamView },
        { key: 'log', label: 'История', access: ['/log'], view: LogView },
      ]}
    />
  )
}

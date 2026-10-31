'use client'

import SectionPage from '@/components/SectionPage'
import { ADMIN_ONLY } from '@/lib/access'
import ProfileView from '@/components/views/ProfileView'
import TeamView from '@/components/views/TeamView'
import LogView from '@/components/views/LogView'
import BackupsView from '@/components/views/BackupsView'
import AgentsView from '@/components/views/AgentsView'

// «Настройки»: личный кабинет (всем), команда, агенты и резервные копии (только админ), история действий
export default function SettingsPage() {
  return (
    <SectionPage
      base="/settings"
      tabs={[
        { key: 'profile', label: 'Профиль', access: [], view: ProfileView },
        { key: 'team', label: 'Команда', access: [ADMIN_ONLY], view: TeamView },
        { key: 'agents', label: 'Агенты', access: [ADMIN_ONLY], view: AgentsView },
        { key: 'log', label: 'История', access: ['/log'], view: LogView },
        { key: 'backups', label: 'Резервные копии', short: 'Копии', access: [ADMIN_ONLY], view: BackupsView },
      ]}
    />
  )
}

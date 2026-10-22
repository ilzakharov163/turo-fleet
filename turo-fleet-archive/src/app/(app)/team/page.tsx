import { redirect } from 'next/navigation'

// Раздел «Команда» теперь вкладка: Настройки → Команда
export default function Page() {
  redirect('/settings?tab=team')
}

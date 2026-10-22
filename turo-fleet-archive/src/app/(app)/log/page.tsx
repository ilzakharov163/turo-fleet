import { redirect } from 'next/navigation'

// Раздел «История» теперь вкладка: Настройки → История
export default function Page() {
  redirect('/settings?tab=log')
}

import { redirect } from 'next/navigation'

// Раздел «Аналитика» теперь вкладка: Отчёты → Аналитика
export default function Page() {
  redirect('/reports?tab=analytics')
}

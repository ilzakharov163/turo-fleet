import { redirect } from 'next/navigation'

// Календарь переехал во вкладку «Простои и зарплата» раздела «Авто»
export default function CalendarPage() {
  redirect('/cars?tab=downtime')
}

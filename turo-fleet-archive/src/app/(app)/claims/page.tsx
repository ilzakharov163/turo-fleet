import { redirect } from 'next/navigation'

// Раздел «Клеймы» теперь вкладка: Авто → Клеймы
export default function Page() {
  redirect('/cars?tab=claims')
}

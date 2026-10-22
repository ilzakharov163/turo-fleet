import { redirect } from 'next/navigation'

// Раздел «Наклейки» теперь вкладка: Авто → Наклейки
export default function Page() {
  redirect('/cars?tab=stickers')
}

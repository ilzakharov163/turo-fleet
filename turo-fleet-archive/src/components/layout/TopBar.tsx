'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'

const pageTitles: Record<string, string> = {
  '/dashboard': 'Дашборд',
  '/cars': 'Авто',
  '/expenses': 'Расходы',
  '/income': 'Доходы',
  '/reports': 'Отчёты',
  '/settings': 'Настройки',
}

const roleLabels: Record<string, string> = {
  owner: 'Овнер',
  operator: 'Оператор',
  admin: 'Администратор',
  partner: 'Партнёр',
  employee: 'Сотрудник',
}

export default function TopBar({ pathname }: { pathname: string }) {
  const [displayName, setDisplayName] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [role, setRole] = useState('')
  const [initials, setInitials] = useState('OP')

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    if (!url.startsWith('http')) return
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      const fullName = data.user.user_metadata?.full_name
      const email = data.user.email || ''
      setUserEmail(email)

      if (fullName) {
        setDisplayName(fullName)
        const parts = fullName.trim().split(' ')
        setInitials(parts.map((p: string) => p[0]).join('').slice(0, 2).toUpperCase())
      } else {
        setDisplayName(email)
        setInitials(email.slice(0, 2).toUpperCase())
      }

      const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', data.user.id).single()
      if (profile?.role) setRole(profile.role)
      if (profile?.full_name) {
        setDisplayName(profile.full_name)
        setInitials(profile.full_name.trim().split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase())
      }
    }).catch(() => {})
  }, [])

  const title = pageTitles[pathname] || 'Fleet Manager'

  return (
    <header className="h-16 bg-white border-b border-gray-100 flex items-center justify-between px-4 sm:px-6 sticky top-0 z-30">
      <h1 className="text-xl font-bold text-gray-900 tracking-tight">{title}</h1>

      <div className="flex items-center gap-3">
        <Link href="/settings" className="flex items-center gap-2.5 rounded-lg py-1 pr-2 hover:bg-gray-50 transition-colors" title="Личный кабинет">
          <div className="w-9 h-9 rounded-[12px] bg-[#4F46E5] flex items-center justify-center text-white text-xs font-bold" >
            {initials}
          </div>
          <div className="hidden sm:block whitespace-nowrap">
            <p className="text-sm font-semibold text-gray-900 leading-tight">
              {displayName || 'Оператор'}
            </p>
            <p className="text-xs text-gray-400 leading-tight">
              {userEmail}
            </p>
            <p className="text-xs text-gray-400 leading-tight">
              {role ? roleLabels[role] || role : 'Оператор'}
            </p>
          </div>
        </Link>
      </div>
    </header>
  )
}

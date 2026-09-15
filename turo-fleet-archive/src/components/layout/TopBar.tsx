'use client'

import { Bell } from 'lucide-react'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'

const pageTitles: Record<string, string> = {
  '/dashboard': 'Дашборд',
  '/cars': 'Автомобили',
  '/calendar': 'Календарь',
  '/expenses': 'Расходы',
  '/analytics': 'Аналитика',
  '/maintenance': 'Техобслуживание',
  '/team': 'Команда',
  '/log': 'История действий',
  '/settings': 'Личный кабинет',
}

const roleLabels: Record<string, string> = {
  owner: 'Овнер',
  operator: 'Оператор',
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

      const { data: member } = await supabase.from('team_members').select('role').eq('email', email).single()
      if (member?.role) setRole(member.role)
    }).catch(() => {})
  }, [])

  const title = pageTitles[pathname] || 'Fleet Manager'

  return (
    <header className="h-16 bg-white border-b border-gray-100 flex items-center justify-between px-6 sticky top-0 z-30">
      <h1 className="text-xl font-bold text-gray-900 tracking-tight">{title}</h1>

      <div className="flex items-center gap-3">
        <button className="relative w-9 h-9 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors">
          <Bell size={17} />
        </button>

        <Link href="/settings" className="flex items-center gap-2.5 pl-3 border-l border-gray-200 rounded-lg py-1 pr-2 hover:bg-gray-50 transition-colors" title="Личный кабинет">
          <div className="w-9 h-9 rounded-[12px] bg-gradient-to-br from-[#4F46E5] to-[#7C3AED] flex items-center justify-center text-white text-xs font-bold" style={{boxShadow:'0 2px 8px rgba(79,70,229,0.30)'}}>
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

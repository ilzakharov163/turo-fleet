'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Car, Calendar, DollarSign, BarChart2, Wrench, Users, ClipboardList, LogOut, ShieldAlert } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Logo from '@/components/ui/Logo'
import { useTheme } from '@/components/ThemeContext'

const nav = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Дашборд', adminOnly: true },
  { href: '/cars', icon: Car, label: 'Авто', adminOnly: true },
  { href: '/calendar', icon: Calendar, label: 'Календарь', adminOnly: true },
  { href: '/expenses', icon: DollarSign, label: 'Расходы', adminOnly: false },
  { href: '/analytics', icon: BarChart2, label: 'Аналитика', adminOnly: true },
  { href: '/maintenance', icon: Wrench, label: 'Тех.обсл', adminOnly: true },
  { href: '/team', icon: Users, label: 'Команда', adminOnly: true },
  { href: '/claims', icon: ShieldAlert, label: 'Клеймы', adminOnly: true },
  { href: '/log', icon: ClipboardList, label: 'История', adminOnly: true },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { dark, toggle } = useTheme()
  const [role, setRole] = useState<'admin' | 'employee' | null>(null)

  useEffect(() => {
    async function loadRole() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      const r = (data?.role ?? 'admin') as 'admin' | 'employee'
      setRole(r)
      if (r === 'employee' && pathname !== '/expenses') {
        router.replace('/expenses')
      }
    }
    loadRole()
  }, [pathname, router])

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const visibleNav = role === 'employee' ? nav.filter(n => !n.adminOnly) : nav

  return (
    <>
      {/* Desktop sidebar — hidden on mobile */}
      <aside className="hidden sm:flex fixed left-0 top-0 h-screen w-[72px] bg-white border-r border-gray-100 flex-col items-center py-5 z-40 shadow-sm">
        {/* Logo */}
        <div className="mb-5 mt-1">
          <Logo size={48} />
        </div>

        {/* Nav */}
        <nav className="flex-1 flex flex-col items-center gap-1 w-full px-2">
          {visibleNav.map(({ href, icon: Icon, label }) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
                title={label}
                className={`relative group w-full flex items-center justify-center h-11 rounded-2xl transition-all duration-150 ${
                  active
                    ? 'bg-[#EEF2FF] text-[#4F46E5]'
                    : 'text-gray-400 hover:bg-gray-50 hover:text-gray-700'
                }`}
              >
                <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
                <span className="pointer-events-none absolute left-[calc(100%+12px)] top-1/2 -translate-y-1/2 bg-gray-900 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50">
                  {label}
                </span>
                {active && (
                  <span className="absolute right-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-[#4F46E5] rounded-l-full" />
                )}
              </Link>
            )
          })}
        </nav>

        {/* Logout */}
        <div className="w-full px-2">
          <button
            onClick={handleLogout}
            title="Выйти"
            className="group relative w-full flex items-center justify-center h-11 rounded-2xl text-gray-400 hover:bg-red-50 hover:text-red-500 transition-all duration-150"
          >
            <LogOut size={20} strokeWidth={1.8} />
            <span className="pointer-events-none absolute left-[calc(100%+12px)] top-1/2 -translate-y-1/2 bg-gray-900 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50">
              Выйти
            </span>
          </button>
        </div>
      </aside>

      {/* Mobile bottom nav — visible only on mobile */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-100 flex items-center justify-around px-1 py-1" style={{ paddingBottom: 'calc(0.25rem + env(safe-area-inset-bottom, 0px))' }}>
        {visibleNav.map(({ href, icon: Icon, label }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-xl min-w-0 flex-1 ${
                active ? 'text-[#4F46E5]' : 'text-gray-400'
              }`}
            >
              <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
              <span className="text-[9px] font-medium leading-none truncate w-full text-center">{label}</span>
            </Link>
          )
        })}
        <button
          onClick={handleLogout}
          className="flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-xl flex-1 text-gray-400 active:text-red-500"
        >
          <LogOut size={20} strokeWidth={1.8} />
          <span className="text-[9px] font-medium leading-none">Выйти</span>
        </button>
      </nav>
    </>
  )
}

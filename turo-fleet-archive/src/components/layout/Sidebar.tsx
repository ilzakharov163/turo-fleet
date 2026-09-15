'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Car, Calendar, DollarSign, BarChart2, Wrench, Users, ClipboardList, LogOut, Sun, Moon, ShieldAlert } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Logo from '@/components/ui/Logo'
import { useTheme } from '@/components/ThemeContext'

const nav = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Дашборд' },
  { href: '/cars', icon: Car, label: 'Автомобили' },
  { href: '/calendar', icon: Calendar, label: 'Календарь' },
  { href: '/expenses', icon: DollarSign, label: 'Расходы' },
  { href: '/analytics', icon: BarChart2, label: 'Аналитика' },
  { href: '/maintenance', icon: Wrench, label: 'Техобслуживание' },
  { href: '/team', icon: Users, label: 'Команда' },
  { href: '/claims', icon: ShieldAlert, label: 'Клеймы' },
  { href: '/log', icon: ClipboardList, label: 'История' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { dark, toggle } = useTheme()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <aside className="fixed left-0 top-0 h-screen w-[72px] bg-white border-r border-gray-100 flex flex-col items-center py-5 z-40 shadow-sm">
      {/* Logo */}
      <div className="mb-5 mt-1">
        <Logo size={48} />
      </div>

      {/* Nav */}
      <nav className="flex-1 flex flex-col items-center gap-1 w-full px-2">
        {nav.map(({ href, icon: Icon, label }) => {
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
              {/* Tooltip */}
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

      {/* Theme toggle — hidden, TODO: restore when dark mode is fully styled */}

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
  )
}

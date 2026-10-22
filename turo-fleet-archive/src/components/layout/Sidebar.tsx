'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Car, DollarSign, BarChart2, Users, ClipboardList, LogOut, ShieldAlert, Tag, FileText, Wallet, LayoutGrid, X } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Logo from '@/components/ui/Logo'

const nav = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Дашборд', adminOnly: true },
  { href: '/cars', icon: Car, label: 'Авто', adminOnly: true },
  { href: '/expenses', icon: DollarSign, label: 'Расходы', adminOnly: false },
  { href: '/income', icon: Wallet, label: 'Доходы', adminOnly: true },
  { href: '/claims', icon: ShieldAlert, label: 'Клеймы', adminOnly: true },
  { href: '/stickers', icon: Tag, label: 'Наклейки', adminOnly: true },
  { href: '/analytics', icon: BarChart2, label: 'Аналитика', adminOnly: true },
  { href: '/team', icon: Users, label: 'Команда', adminOnly: true },
  { href: '/log', icon: ClipboardList, label: 'История', adminOnly: true },
  { href: '/reports', icon: FileText, label: 'Отчёты', adminOnly: true },
]

// Нижнее меню на телефоне: 4 главных раздела, остальные — в «Ещё»
const MOBILE_MAIN = ['/dashboard', '/cars', '/expenses', '/income']

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [access, setAccess] = useState<{ role: string; perms: string[] } | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => {
    async function loadRole() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.from('profiles').select('role, permissions').eq('id', user.id).single()
      const role = (data?.role ?? 'admin') as string
      let perms: string[] = (data?.permissions as string[] | null) ?? []
      if (role !== 'admin' && perms.length === 0) perms = ['/expenses']
      if (perms.includes('/calendar') && !perms.includes('/cars')) perms = [...perms, '/cars']
      setAccess({ role, perms })
      // Сотрудник/партнёр видит только разрешённые разделы
      if (role !== 'admin') {
        const allowed = pathname === '/settings' || perms.some(p => pathname === p || pathname.startsWith(p + '/'))
        if (!allowed) router.replace(perms[0] || '/settings')
      }
    }
    loadRole()
  }, [pathname, router])

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const visibleNav = !access || access.role === 'admin' ? nav : nav.filter(n => access.perms.includes(n.href))
  const preferred = visibleNav.filter(n => MOBILE_MAIN.includes(n.href))
  const mobileMain = [...preferred, ...visibleNav.filter(n => !MOBILE_MAIN.includes(n.href))].slice(0, 4)
  const mobileMore = visibleNav.filter(n => !mobileMain.includes(n))
  const moreActive = mobileMore.some(n => pathname === n.href)

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
                    ? 'bg-indigo-50 text-[#4F46E5]'
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

      {/* Mobile bottom nav: 4 главных раздела + «Ещё» */}
      <nav
        className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur border-t border-gray-200/70 grid grid-cols-5 px-3 pt-1.5"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      >
        {mobileMain.map(({ href, icon: Icon, label }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center justify-center gap-1 h-14 rounded-2xl min-w-0 ${active ? 'text-[#4F46E5]' : 'text-gray-500 active:bg-gray-100'}`}
            >
              <span className={`flex items-center justify-center w-12 h-8 rounded-full transition-colors ${active ? 'bg-indigo-50' : ''}`}>
                <Icon size={23} strokeWidth={active ? 2.2 : 1.8} />
              </span>
              <span className={`text-[11px] leading-none truncate max-w-full ${active ? 'font-semibold' : 'font-medium'}`}>{label}</span>
            </Link>
          )
        })}
        <button
          onClick={() => setMoreOpen(true)}
          className={`flex flex-col items-center justify-center gap-1 h-14 rounded-2xl min-w-0 ${moreActive ? 'text-[#4F46E5]' : 'text-gray-500 active:bg-gray-100'}`}
        >
          <span className={`flex items-center justify-center w-12 h-8 rounded-full ${moreActive ? 'bg-indigo-50' : ''}`}>
            <LayoutGrid size={23} strokeWidth={moreActive ? 2.2 : 1.8} />
          </span>
          <span className={`text-[11px] leading-none ${moreActive ? 'font-semibold' : 'font-medium'}`}>Ещё</span>
        </button>
      </nav>

      {/* «Ещё» — панель снизу */}
      {moreOpen && (
        <div className="sm:hidden fixed inset-0 z-[60] bg-black/30" onClick={() => setMoreOpen(false)}>
          <div
            className="absolute bottom-0 left-0 right-0 bg-white rounded-t-[24px] px-4 pt-3 animate-in"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3 px-1">
              <span className="w-8" />
              <span className="w-10 h-1.5 rounded-full bg-gray-200" />
              <button onClick={() => setMoreOpen(false)} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500"><X size={16} /></button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {mobileMore.map(({ href, icon: Icon, label }) => {
                const active = pathname === href
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMoreOpen(false)}
                    className={`flex flex-col items-center justify-center gap-2 h-[84px] rounded-2xl ${active ? 'bg-indigo-50 text-[#4F46E5]' : 'bg-gray-50 text-gray-700 active:bg-gray-100'}`}
                  >
                    <Icon size={24} strokeWidth={1.9} />
                    <span className="text-[13px] font-medium">{label}</span>
                  </Link>
                )
              })}
              <button
                onClick={handleLogout}
                className="flex flex-col items-center justify-center gap-2 h-[84px] rounded-2xl bg-red-50 text-red-500 active:bg-red-100"
              >
                <LogOut size={24} strokeWidth={1.9} />
                <span className="text-[13px] font-medium">Выйти</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

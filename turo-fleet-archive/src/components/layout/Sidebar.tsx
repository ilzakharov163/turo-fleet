'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Car, DollarSign, LogOut, FileText, Wallet, LayoutGrid, X, Settings } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { canAny, useAccess } from '@/lib/access'
import { useRouter } from 'next/navigation'

// access — галочки из «Команды», дающие доступ к разделу (хотя бы одна); [] — всем
const nav = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Дашборд', access: ['/dashboard'] },
  { href: '/cars', icon: Car, label: 'Авто', access: ['/cars', '/claims', '/stickers'] },
  { href: '/expenses', icon: DollarSign, label: 'Расходы', access: ['/expenses'] },
  { href: '/income', icon: Wallet, label: 'Доходы', access: ['/income'] },
  { href: '/reports', icon: FileText, label: 'Отчёты', access: ['/reports', '/analytics', '/income'] },
  { href: '/settings', icon: Settings, label: 'Настройки', access: [] as string[] },
]

// Нижнее меню на телефоне: 4 главных раздела, остальные — в «Ещё»
const MOBILE_MAIN = ['/dashboard', '/cars', '/expenses', '/income']

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const access = useAccess()
  const [moreOpen, setMoreOpen] = useState(false)

  // Сотрудник/партнёр видит только разрешённые разделы
  useEffect(() => {
    if (!access || access.role === 'admin') return
    const item = nav.find(n => pathname === n.href || pathname.startsWith(n.href + '/'))
    if (!item || !canAny(access, item.access)) {
      const first = nav.find(n => n.access.length > 0 && canAny(access, n.access))
      router.replace(first?.href || '/settings')
    }
  }, [access, pathname, router])

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Пока права грузятся — меню пустое, чтобы не мелькали чужие разделы
  const visibleNav = !access ? [] : nav.filter(n => canAny(access, n.access))
  const preferred = visibleNav.filter(n => MOBILE_MAIN.includes(n.href))
  const mobileMain = [...preferred, ...visibleNav.filter(n => !MOBILE_MAIN.includes(n.href))].slice(0, 4)
  const mobileMore = visibleNav.filter(n => !mobileMain.includes(n))
  const moreActive = mobileMore.some(n => pathname === n.href)

  return (
    <>
      {/* Боковое меню: планшет — только значки, компьютер — значки с подписями */}
      <aside className="hidden sm:flex fixed left-0 top-0 h-screen w-[72px] lg:w-[232px] bg-white border-r border-gray-100 flex-col py-5 z-40">
        <Link href="/dashboard" className="flex items-center gap-3 px-3 lg:px-5 mb-7">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" width={44} height={44} className="w-11 h-11 rounded-[14px] border border-gray-100 flex-shrink-0 mx-auto lg:mx-0" />
          <span className="hidden lg:block min-w-0">
            <span className="block text-[15px] font-bold text-gray-900 leading-tight">Fleet Manager</span>
            <span className="block text-xs text-gray-400">Turo</span>
          </span>
        </Link>

        <nav className="flex-1 flex flex-col gap-1 px-3">
          {visibleNav.map(({ href, icon: Icon, label }) => {
            const active = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                title={label}
                className={`relative group flex items-center justify-center lg:justify-start gap-3 h-11 lg:px-3 rounded-xl text-sm transition-colors ${
                  active ? 'bg-indigo-50 text-[#4F46E5] dark:text-indigo-300 font-semibold' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900 font-medium'
                }`}
              >
                <Icon size={20} strokeWidth={active ? 2.2 : 1.8} className="flex-shrink-0" />
                <span className="hidden lg:inline">{label}</span>
                <span className="lg:hidden pointer-events-none absolute left-[calc(100%+12px)] top-1/2 -translate-y-1/2 bg-gray-900 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50">
                  {label}
                </span>
              </Link>
            )
          })}
        </nav>

        <div className="px-3">
          <button
            onClick={handleLogout}
            title="Выйти"
            className="w-full flex items-center justify-center lg:justify-start gap-3 h-11 lg:px-3 rounded-xl text-sm font-medium text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
          >
            <LogOut size={20} strokeWidth={1.8} className="flex-shrink-0" />
            <span className="hidden lg:inline">Выйти</span>
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

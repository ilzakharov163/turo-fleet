'use client'

import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'
import { usePathname } from 'next/navigation'
import { ThemeProvider } from '@/components/ThemeContext'
import Feedback from '@/components/ui/Feedback'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <ThemeProvider>
      <div className="flex min-h-screen" style={{ background: 'var(--background)' }}>
        <Sidebar />
        <div className="flex-1 min-w-0 flex flex-col sm:ml-[72px] lg:ml-[232px]">
          <TopBar pathname={pathname} />
          {/* overflow-x-clip: на телефоне страница не уезжает вбок; широкие таблицы скроллятся внутри своих блоков */}
          <main className="flex-1 min-w-0 w-full max-w-[1400px] mx-auto p-4 sm:p-6 lg:p-8 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:pb-6 overflow-x-clip">{children}</main>
        </div>
      </div>
      <Feedback />
    </ThemeProvider>
  )
}

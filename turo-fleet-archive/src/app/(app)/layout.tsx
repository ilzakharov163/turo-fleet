'use client'

import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'
import { usePathname } from 'next/navigation'
import { ThemeProvider } from '@/components/ThemeContext'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <ThemeProvider>
      <div className="flex min-h-screen" style={{ background: 'var(--background)' }}>
        <Sidebar />
        <div className="flex-1 flex flex-col sm:ml-[72px]">
          <TopBar pathname={pathname} />
          <main className="flex-1 p-4 sm:p-6 pb-24 sm:pb-6 overflow-auto">{children}</main>
        </div>
      </div>
    </ThemeProvider>
  )
}

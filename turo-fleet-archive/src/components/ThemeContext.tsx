'use client'

import { createContext, useContext, useEffect, useState } from 'react'

// Тема всегда как в системе (iPhone/Mac): светлая днём, тёмная — если так настроено.
// Класс ставится ещё до отрисовки скриптом в app/layout.tsx, здесь — следим за переключением.
const ThemeContext = createContext<{ dark: boolean }>({ dark: false })

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(() => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'))

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      document.documentElement.classList.toggle('dark', mq.matches)
      setDark(mq.matches)
    }
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  return <ThemeContext.Provider value={{ dark }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)

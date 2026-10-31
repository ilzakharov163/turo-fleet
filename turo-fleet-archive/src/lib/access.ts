'use client'

import { useEffect, useState } from 'react'
import { createClient } from './supabase'
import { accessFrom, canAny, type Access } from './core'

// Роль и галочки разделов текущего пользователя (profiles.permissions).
// Те же правила, что в базе (can_any): admin — всё; не-админ без галочек — только /expenses. Сами правила — lib/core.ts.
export { canAny }
export type { Access }

// Ключ, которого нет ни у кого в permissions: такая вкладка видна только админу
export const ADMIN_ONLY = '__admin'

export function useAccess() {
  const [access, setAccess] = useState<Access | null>(null)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.from('profiles').select('role, permissions').eq('id', user.id).single()
      // Профиль не загрузился — права как у сотрудника без галочек, не админа
      setAccess(accessFrom(data?.role as string | undefined, data?.permissions as string[] | null))
    }
    load()
  }, [])

  return access
}

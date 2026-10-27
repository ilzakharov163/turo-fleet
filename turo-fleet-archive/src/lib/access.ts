'use client'

import { useEffect, useState } from 'react'
import { createClient } from './supabase'

// Роль и галочки разделов текущего пользователя (profiles.permissions).
// Те же правила, что в базе (can_any): admin — всё; не-админ без галочек — только /expenses.
export interface Access { role: string; perms: string[] }

// Ключ, которого нет ни у кого в permissions: такая вкладка видна только админу
export const ADMIN_ONLY = '__admin'

export function canAny(access: Access | null, keys: string[]) {
  if (!access) return false
  if (access.role === 'admin' || keys.length === 0) return true
  return keys.some(k => access.perms.includes(k))
}

export function useAccess() {
  const [access, setAccess] = useState<Access | null>(null)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.from('profiles').select('role, permissions').eq('id', user.id).single()
      // Профиль не загрузился — права как у сотрудника без галочек, не админа
      const role = (data?.role ?? 'employee') as string
      let perms: string[] = (data?.permissions as string[] | null) ?? []
      if (role !== 'admin' && perms.length === 0) perms = ['/expenses']
      // Старая галочка «Календарь» = простои во вкладке «Авто»
      if (perms.includes('/calendar') && !perms.includes('/cars')) perms = [...perms, '/cars']
      setAccess({ role, perms })
    }
    load()
  }, [])

  return access
}

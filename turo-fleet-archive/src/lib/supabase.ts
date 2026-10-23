import { createBrowserClient } from '@supabase/ssr'
import { notify } from './ui'

// Любая неудачная запись в базу или хранилище чеков показывает сообщение,
// чтобы изменения не пропадали молча (нет интернета, нет прав и т.п.).
async function watchedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const method = (init?.method || 'GET').toUpperCase()
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const isWrite = method !== 'GET' && method !== 'HEAD' && !url.includes('/auth/v1/')
  try {
    const res = await fetch(input, init)
    if (isWrite && !res.ok) {
      let msg = ''
      try { const body = await res.clone().json(); msg = body?.message || body?.error || '' } catch {}
      if (res.status === 401 || res.status === 403 || /row-level security|permission denied/i.test(msg)) notify('Нет прав на это действие — изменения не сохранены', 'error')
      else notify(`Не сохранилось${msg ? `: ${msg}` : ''}`, 'error')
    }
    return res
  } catch (e) {
    if (isWrite) notify('Нет связи с интернетом — изменения не сохранены', 'error')
    throw e
  }
}

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: watchedFetch } }
  )
}

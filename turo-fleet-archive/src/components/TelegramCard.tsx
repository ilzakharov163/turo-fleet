'use client'

import { useCallback, useEffect, useState } from 'react'
import { Send, Unlink, RefreshCw } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { createClient } from '@/lib/supabase'
import { useAccess } from '@/lib/access'
import { ask, notify } from '@/lib/ui'

// Профиль → Telegram: привязать свой Telegram к боту-учётчику (ссылка с одноразовым кодом),
// отключить; владельцу — галочка «сообщать о расходах сотрудников».
interface Link { user_id: string; username: string | null; notify_expenses: boolean; linked_at: string }

export default function TelegramCard() {
  const access = useAccess()
  const [link, setLink] = useState<Link | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [waiting, setWaiting] = useState(false)   // открыли Telegram — ждём, пока нажмут Start

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase.from('telegram_links').select('user_id, username, notify_expenses, linked_at').eq('user_id', user.id).maybeSingle()
    setLink((data as Link | null) || null)
    if (data) setWaiting(false)
  }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- загрузка данных при открытии
  useEffect(() => { load() }, [load])

  async function connect() {
    setBusy(true)
    const res = await fetch('/api/telegram/link', { method: 'POST' })
    const json = await res.json().catch(() => ({})) as { url?: string; error?: string }
    setBusy(false)
    if (!json.url) { notify(json.error || 'Не получилось', 'error'); return }
    setWaiting(true)
    window.location.href = json.url
  }

  async function disconnect() {
    if (!link || !await ask('Отключить Telegram?', { detail: 'Бот перестанет вас узнавать. Подключить снова можно в любой момент.', ok: 'Отключить', danger: true })) return
    const { error } = await createClient().from('telegram_links').delete().eq('user_id', link.user_id)
    if (error) return
    notify('Telegram отключён', 'success')
    load()
  }

  async function toggleNotify() {
    if (!link) return
    const { error } = await createClient().from('telegram_links').update({ notify_expenses: !link.notify_expenses }).eq('user_id', link.user_id)
    if (!error) setLink({ ...link, notify_expenses: !link.notify_expenses })
  }

  if (link === undefined) return <div className="skeleton h-28 mt-5" />

  return (
    <div className="bg-white rounded-[18px] p-6 card-shadow border border-gray-100/80 mt-5">
      <h2 className="flex items-center gap-2 text-base font-bold text-gray-900 mb-1"><Send size={17} className="text-gray-400" /> Telegram-бот</h2>
      {link ? (
        <>
          <p className="text-sm text-gray-500 mb-4">
            Подключён{link.username ? <> как <span className="font-semibold text-gray-700">@{link.username}</span></> : ''} с {format(parseISO(link.linked_at), 'd MMMM yyyy', { locale: ru })}.
            Пишите или говорите боту, что произошло, — он внесёт в приложение.
          </p>
          {access?.role === 'admin' && (
            <label className="flex items-center gap-2 text-sm text-gray-700 mb-4 cursor-pointer select-none">
              <input type="checkbox" checked={link.notify_expenses} onChange={toggleNotify} className="w-4 h-4 accent-[#4F46E5]" />
              Сообщать мне о расходах, которые добавили сотрудники
            </label>
          )}
          <button type="button" onClick={disconnect} className="btn-secondary inline-flex items-center gap-2"><Unlink size={15} /> Отключить</button>
        </>
      ) : (
        <>
          <p className="text-sm text-gray-500 mb-4">
            Бот вносит расходы (с фото чека), клеймы, простои, выплаты и отвечает на вопросы — текстом или голосом.
            Нажмите кнопку, в Telegram нажмите «Start».
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={busy} onClick={connect} className="btn-primary inline-flex items-center gap-2"><Send size={15} /> {busy ? 'Готовим ссылку…' : 'Подключить Telegram'}</button>
            {waiting && <button type="button" onClick={load} className="btn-secondary inline-flex items-center gap-2"><RefreshCw size={15} /> Я нажал Start — проверить</button>}
          </div>
        </>
      )}
    </div>
  )
}

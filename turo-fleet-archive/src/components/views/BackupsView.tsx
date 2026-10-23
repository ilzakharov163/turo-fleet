'use client'

import { useEffect, useState } from 'react'
import { DatabaseBackup, Download, Plus } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { createClient } from '@/lib/supabase'
import { log } from '@/lib/logger'
import { notify } from '@/lib/ui'

// Резервные копии базы: база сама делает копию каждую ночь (pg_cron, supabase-backups.sql).
interface Backup { id: string; created_at: string; kind: 'auto' | 'manual'; rows: number }

export default function BackupsView() {
  const [list, setList] = useState<Backup[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [tick, setTick] = useState(0)
  const load = () => setTick(t => t + 1)

  useEffect(() => {
    let alive = true
    createClient().from('backups').select('id, created_at, kind, rows').order('created_at', { ascending: false })
      .then(({ data }) => { if (alive) setList((data || []) as Backup[]) })
    return () => { alive = false }
  }, [tick])

  async function makeNow() {
    setBusy('new')
    const { data, error } = await createClient().rpc('make_backup', { p_kind: 'manual' })
    setBusy(null)
    if (error) return
    await log('create', 'backup', String(data), {})
    notify('Резервная копия сделана', 'success')
    load()
  }

  async function download(b: Backup) {
    setBusy(b.id)
    const { data } = await createClient().from('backups').select('data').eq('id', b.id).single()
    setBusy(null)
    if (!data) return
    const blob = new Blob([JSON.stringify(data.data, null, 1)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fleet-backup-${format(parseISO(b.created_at), 'yyyy-MM-dd-HHmm')}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-[18px] p-4 sm:p-5 border border-gray-100/80 card-shadow flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="w-10 h-10 rounded-xl bg-indigo-50 text-[#4F46E5] dark:text-indigo-300 flex items-center justify-center flex-shrink-0"><DatabaseBackup size={19} /></span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">Копия делается сама каждую ночь</p>
            <p className="text-xs text-gray-500 mt-0.5">Хранятся 30 последних автокопий и 10 ручных. В копию входят все данные, кроме самих фото чеков.</p>
          </div>
        </div>
        <button onClick={makeNow} disabled={busy === 'new'} className="btn-primary inline-flex items-center gap-2 px-4 h-10">
          <Plus size={16} /> {busy === 'new' ? 'Делаю…' : 'Сделать сейчас'}
        </button>
      </div>

      <div className="bg-white rounded-[18px] border border-gray-100/80 card-shadow overflow-hidden">
        {list === null ? (
          <div className="p-4 space-y-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-12" />)}</div>
        ) : list.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400">Копий пока нет</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {list.map(b => (
              <li key={b.id} className="flex items-center gap-3 px-4 sm:px-5 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{format(parseISO(b.created_at), 'd MMMM yyyy, HH:mm', { locale: ru })}</p>
                  <p className="text-xs text-gray-500">{b.kind === 'auto' ? 'Автоматическая' : 'Ручная'} · {b.rows.toLocaleString('ru')} записей</p>
                </div>
                <button onClick={() => download(b)} disabled={busy === b.id} className="btn-secondary inline-flex items-center gap-1.5 px-3 h-9 text-sm">
                  <Download size={15} /> {busy === b.id ? '…' : 'Скачать'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

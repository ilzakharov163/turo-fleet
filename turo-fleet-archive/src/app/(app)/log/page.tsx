'use client'

import React, { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { ActivityLog } from '@/types'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import Select from '@/components/ui/Select'

const actionLabels: Record<string, { label: string; color: string }> = {
  create: { label: 'Создание', color: 'bg-green-100 text-green-700' },
  update: { label: 'Изменение', color: 'bg-blue-100 text-blue-700' },
  delete: { label: 'Удаление', color: 'bg-red-100 text-red-700' },
  status_change: { label: 'Смена статуса', color: 'bg-yellow-100 text-yellow-700' },
  invite: { label: 'Приглашение', color: 'bg-purple-100 text-purple-700' },
}

const entityLabels: Record<string, string> = {
  car: 'Авто',
  expense: 'Расход',
  car_block: 'Блокировка',
  maintenance: 'Техобслуживание',
  team_member: 'Участник',
  salary: 'Зарплата',
}

function Arrow() {
  return <span className="mx-1.5 text-gray-300 font-normal">→</span>
}

function formatDetails(action: string, entityType: string, details: Record<string, unknown>): React.ReactNode {
  if (entityType === 'car') {
    const d = details as { make?: string; model?: string; plate?: string; status?: string; reason?: string; old?: Record<string, string>; new?: Record<string, string> }
    if (action === 'create') return `${d.make} ${d.model} ${d.plate}`
    if (action === 'delete') return `${d.make} ${d.model} ${d.plate}`
    if (action === 'status_change') return (
      <span className="flex items-center">
        {d.status === 'inactive' ? 'Активен' : 'Неактивен'}<Arrow />{d.status === 'inactive' ? 'Неактивен' : 'Активен'}
        {d.reason ? <span className="ml-2 text-gray-400">— {d.reason}</span> : null}
      </span>
    )
    if (action === 'update' && d.old && d.new) return (
      <span className="flex items-center">
        {d.old.make} {d.old.model}<Arrow />{d.new.make} {d.new.model} {d.new.plate}
      </span>
    )
  }
  if (entityType === 'expense') {
    const d = details as { title?: string; amount?: string | number; old?: { title?: string; amount?: string | number }; new?: { title?: string; amount?: string | number } }
    if (action === 'update' && d.old && d.new) {
      const titleChanged = d.old.title !== d.new.title
      const amountChanged = String(d.old.amount) !== String(d.new.amount)
      return (
        <span className="flex items-center gap-3 flex-wrap">
          {titleChanged && <span className="flex items-center">{d.old.title}<Arrow />{d.new.title}</span>}
          {amountChanged && <span className="flex items-center">${d.old.amount}<Arrow />${d.new.amount}</span>}
          {!titleChanged && !amountChanged && <span>{d.new.title} — ${d.new.amount}</span>}
        </span>
      )
    }
    // старый формат без old/new
    return <span>{d.title || ''}{d.amount != null ? <span className="text-gray-400"> — ${d.amount}</span> : ''}</span>
  }
  if (entityType === 'car_block') {
    const d = details as { start_date?: string; end_date?: string; reason?: string }
    return `${d.start_date || ''} — ${d.end_date || ''}${d.reason ? ` (${d.reason})` : ''}`
  }
  if (entityType === 'team_member') {
    const d = details as { email?: string; role?: string }
    return `${d.email || ''}${d.role ? ` (${d.role})` : ''}`
  }
  if (entityType === 'salary') {
    const d = details as { amount?: number; period?: string }
    return <span>{d.period || 'Выплата'}{d.amount != null ? <span className="text-gray-400"> — ${d.amount}</span> : ''}</span>
  }
  return null
}

export default function LogPage() {
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(true)
  const [filterAction, setFilterAction] = useState('')
  const [filterEntity, setFilterEntity] = useState('')

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data } = await supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(500)
      setLogs(data || [])
      setLoading(false)
    }
    load()
  }, [])

  const filtered = logs.filter(l => {
    if (filterAction && l.action !== filterAction) return false
    if (filterEntity && l.entity_type !== filterEntity) return false
    return true
  })

  return (
    <div className="p-8">

      <div className="flex items-center gap-3 mb-6">
        <Select
          value={filterAction}
          onChange={setFilterAction}
          options={[
            { value: '', label: 'Все действия' },
            ...Object.entries(actionLabels).map(([k, v]) => ({ value: k, label: v.label }))
          ]}
        />
        <Select
          value={filterEntity}
          onChange={setFilterEntity}
          options={[
            { value: '', label: 'Все разделы' },
            ...Object.entries(entityLabels).map(([k, v]) => ({ value: k, label: v }))
          ]}
        />
      </div>

      {loading ? <div className="text-gray-400">Загрузка...</div> : (
        <div className="bg-white rounded-[18px] overflow-hidden card-shadow border border-gray-100/80">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr className="text-left text-gray-500">
                <th className="px-6 py-4 font-medium">Дата и время</th>
                <th className="px-6 py-4 font-medium">Пользователь</th>
                <th className="px-6 py-4 font-medium">Действие</th>
                <th className="px-6 py-4 font-medium">Раздел</th>
                <th className="px-6 py-4 font-medium">Детали</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(l => {
                const ac = actionLabels[l.action] || { label: l.action, color: 'bg-gray-100 text-gray-600' }
                return (
                  <tr key={l.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-6 py-3 text-gray-500 whitespace-nowrap">
                      {format(parseISO(l.created_at), 'dd.MM.yyyy HH:mm', { locale: ru })}
                    </td>
                    <td className="px-6 py-3 text-gray-700">{l.user_email}</td>
                    <td className="px-6 py-3">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${ac.color}`}>
                        {ac.label}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-600">{entityLabels[l.entity_type] || l.entity_type}</td>
                    <td className="px-6 py-3 text-gray-500 text-xs">{formatDetails(l.action, l.entity_type, l.details)}</td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-400">История пуста</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

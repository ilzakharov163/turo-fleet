'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { log } from '@/lib/logger'
import { TeamMember } from '@/types'
import { Plus, Trash2, Mail, UserCheck, Clock, Shield, Wrench } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Card, Modal, FormField, inputCls, SaveButton, CancelButton, ModalActions } from '@/components/ui/PageShell'

const roles = [
  {
    value: 'owner',
    label: 'Овнер',
    description: 'Полный доступ ко всем разделам',
    icon: Shield,
    color: 'bg-purple-50 text-purple-600 border-purple-200',
    badge: 'bg-purple-100 text-purple-700',
  },
  {
    value: 'operator',
    label: 'Оператор',
    description: 'Полный доступ ко всем разделам',
    icon: Wrench,
    color: 'bg-blue-50 text-blue-600 border-blue-200',
    badge: 'bg-blue-100 text-blue-700',
  },
]

export default function TeamPage() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'owner' | 'operator'>('operator')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [deleteModal, setDeleteModal] = useState<TeamMember | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})

  async function load() {
    const supabase = createClient()
    const [{ data }, namesRes] = await Promise.all([
      supabase.from('team_members').select('*').order('invited_at', { ascending: false }),
      fetch('/api/team/names').then(r => r.json()).catch(() => ({ names: {} })),
    ])
    setMembers(data || [])
    setNames(namesRes.names || {})
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setSending(true)
    setError('')

    const res = await fetch('/api/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error || 'Ошибка при отправке')
      setSending(false)
      return
    }

    await log('invite', 'team_member', inviteEmail, { email: inviteEmail, role: inviteRole })
    setSuccess(`Приглашение отправлено на ${inviteEmail}`)
    setInviteEmail('')
    setInviteRole('operator')
    setSending(false)
    setTimeout(() => { setShowModal(false); setSuccess('') }, 2000)
    load()
  }

  async function handleRemove() {
    if (!deleteModal) return
    const supabase = createClient()
    await supabase.from('team_members').delete().eq('id', deleteModal.id)
    await log('delete', 'team_member', deleteModal.id, { email: deleteModal.email })
    setDeleteModal(null)
    load()
  }

  const getRoleCfg = (role: string) => roles.find(r => r.value === role) || roles[1]

  return (
    <div className="space-y-5">
      {/* Header stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-[18px] p-4 border border-gray-100/80 card-shadow">
          <p className="text-xs text-gray-400 font-medium mb-1">Всего участников</p>
          <p className="text-3xl font-bold text-gray-900">{loading ? '—' : members.length}</p>
        </div>
        <div className="bg-white rounded-[18px] p-4 border border-gray-100/80 card-shadow">
          <p className="text-xs text-gray-400 font-medium mb-1">Ожидают входа</p>
          <p className="text-3xl font-bold text-amber-500">{loading ? '—' : members.filter(m => m.status === 'pending').length}</p>
        </div>
      </div>

      <Card>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">Команда</h2>
            <p className="text-xs text-gray-400 mt-0.5">Все участники имеют полный доступ</p>
          </div>
          <button
            onClick={() => { setShowModal(true); setError(''); setSuccess('') }}
            className="btn-primary flex items-center gap-2 px-4 py-2"
          >
            <Plus size={15} /> Пригласить
          </button>
        </div>

        {loading ? (
          <div className="px-6 py-10 text-center text-gray-400 text-sm">Загрузка...</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 uppercase tracking-wider bg-gray-50/60">
                <th className="px-6 py-3 font-medium">Email</th>
                <th className="px-6 py-3 font-medium">Роль</th>
                <th className="px-6 py-3 font-medium">Статус</th>
                <th className="px-6 py-3 font-medium">Приглашён</th>
                <th className="px-6 py-3 font-medium text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {members.map(m => {
                const roleCfg = getRoleCfg(m.role)
                return (
                  <tr key={m.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#4F46E5] to-[#7C3AED] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                          {(names[m.email] || m.email).slice(0, 2).toUpperCase()}
                        </div>
                        <div className="leading-tight">
                          {names[m.email] && <p className="font-semibold text-gray-900">{names[m.email]}</p>}
                          <p className={names[m.email] ? 'text-xs text-gray-400' : 'font-medium text-gray-800'}>{m.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold border ${roleCfg.color}`}>
                        <roleCfg.icon size={11} />
                        {roleCfg.label}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold ${
                        m.status === 'active'
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-amber-50 text-amber-600'
                      }`}>
                        {m.status === 'active' ? <UserCheck size={11} /> : <Clock size={11} />}
                        {m.status === 'active' ? 'Активен' : 'Ожидает'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-400 text-sm">
                      {format(parseISO(m.invited_at), 'dd MMM yyyy', { locale: ru })}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button onClick={() => setDeleteModal(m)} className="w-8 h-8 rounded-xl hover:bg-red-50 text-gray-400 hover:text-red-500 flex items-center justify-center transition-colors ml-auto">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })}
              {members.length === 0 && (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-gray-400">Участников пока нет</td></tr>
              )}
            </tbody>
          </table>
        )}
      </Card>

      {/* Delete Modal */}
      {deleteModal && (
        <Modal title="Удалить участника?" onClose={() => setDeleteModal(null)}>
          <p className="text-sm text-gray-500 mb-6 -mt-1">
            <span className="font-medium text-gray-800">{deleteModal.email}</span> будет удалён из команды.
          </p>
          <div className="flex gap-3">
            <button onClick={handleRemove} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition-all">
              Удалить
            </button>
            <CancelButton onClick={() => setDeleteModal(null)} />
          </div>
        </Modal>
      )}

      {/* Invite Modal */}
      {showModal && (
        <Modal title="Пригласить участника" onClose={() => { setShowModal(false); setError(''); setSuccess('') }}>
          {success ? (
            <div className="text-center py-6">
              <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <UserCheck size={24} className="text-emerald-600" />
              </div>
              <p className="font-semibold text-gray-900">Приглашение отправлено!</p>
              <p className="text-sm text-gray-400 mt-1">{inviteEmail || success}</p>
            </div>
          ) : (
            <form onSubmit={handleInvite} className="space-y-5">
              <FormField label="Email участника">
                <div className="relative">
                  <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    required
                    placeholder="colleague@example.com"
                    className={`${inputCls} pl-9`}
                  />
                </div>
              </FormField>

              <FormField label="Роль">
                <div className="grid grid-cols-2 gap-3">
                  {roles.map(role => (
                    <button
                      key={role.value}
                      type="button"
                      onClick={() => setInviteRole(role.value as 'owner' | 'operator')}
                      className={`flex flex-col items-center gap-2 p-4 rounded-[14px] border-2 transition-all ${
                        inviteRole === role.value
                          ? 'border-[#4F46E5] bg-indigo-50'
                          : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                      }`}
                    >
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${inviteRole === role.value ? 'bg-[#4F46E5]' : 'bg-gray-200'}`}>
                        <role.icon size={16} className={inviteRole === role.value ? 'text-white' : 'text-gray-500'} />
                      </div>
                      <div className="text-center">
                        <p className={`text-sm font-bold ${inviteRole === role.value ? 'text-[#4F46E5]' : 'text-gray-700'}`}>{role.label}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{role.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </FormField>

              <div className="bg-indigo-50 rounded-[12px] px-4 py-3 text-sm text-indigo-700">
                Участник получит письмо со ссылкой для входа
              </div>

              {error && <p className="text-red-500 text-sm">{error}</p>}

              <ModalActions>
                <SaveButton loading={sending} label="Отправить приглашение" />
                <CancelButton onClick={() => { setShowModal(false); setError('') }} />
              </ModalActions>
            </form>
          )}
        </Modal>
      )}
    </div>
  )
}

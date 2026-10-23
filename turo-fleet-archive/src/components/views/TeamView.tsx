'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { log } from '@/lib/logger'
import { Shield, Users, UserCog, Pencil, X, Check, Info } from 'lucide-react'
import { format, parseISO, formatDistanceToNow } from 'date-fns'
import { ru } from 'date-fns/locale'
import { notify } from '@/lib/ui'

type Role = 'admin' | 'partner' | 'employee'

interface Member {
  id: string
  email: string
  full_name: string | null
  role: Role
  permissions: string[]
  last_sign_in_at: string | null
  created_at: string
}

// Разделы и вкладки, к которым можно выдать доступ (ключи — те же, что в правилах базы)
const SECTIONS: { href: string; label: string }[] = [
  { href: '/dashboard', label: 'Дашборд' },
  { href: '/cars', label: 'Авто: машины и простои' },
  { href: '/claims', label: 'Авто: клеймы' },
  { href: '/stickers', label: 'Авто: наклейки' },
  { href: '/expenses', label: 'Расходы' },
  { href: '/income', label: 'Доходы' },
  { href: '/reports', label: 'Отчёты' },
  { href: '/analytics', label: 'Отчёты: аналитика' },
  { href: '/log', label: 'Настройки: история' },
]

const ROLES: { value: Role; label: string; hint: string; icon: typeof Shield; badge: string }[] = [
  { value: 'admin', label: 'Администратор', hint: 'Всё, включая управление командой', icon: Shield, badge: 'bg-purple-100 text-purple-700' },
  { value: 'partner', label: 'Партнёр', hint: 'Только отмеченные разделы', icon: Users, badge: 'bg-blue-100 text-blue-700' },
  { value: 'employee', label: 'Сотрудник', hint: 'Только отмеченные разделы', icon: UserCog, badge: 'bg-emerald-100 text-emerald-700' },
]

const PRESETS: Record<Exclude<Role, 'admin'>, string[]> = {
  partner: ['/dashboard', '/cars', '/expenses', '/claims', '/stickers', '/analytics', '/reports'],
  employee: ['/expenses'],
}

const roleCfg = (r: Role) => ROLES.find(x => x.value === r) || ROLES[2]

export default function TeamView() {
  const [members, setMembers] = useState<Member[]>([])
  const [me, setMe] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [edit, setEdit] = useState<Member | null>(null)
  const [form, setForm] = useState<{ full_name: string; role: Role; permissions: string[] }>({ full_name: '', role: 'employee', permissions: [] })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const supabase = createClient()
    const [{ data: { user } }, { data, error }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.rpc('list_team'),
    ])
    setMe(user?.id ?? null)
    if (error) setError(error.message)
    else setMembers((data as Member[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openEdit(m: Member) {
    setEdit(m)
    setForm({ full_name: m.full_name || '', role: m.role, permissions: m.permissions || [] })
  }

  function setRole(role: Role) {
    setForm(f => ({
      ...f,
      role,
      // при смене роли подставляем типовой набор, если разделы ещё не выбраны
      permissions: role === 'admin' ? f.permissions : (f.permissions.length ? f.permissions : PRESETS[role]),
    }))
  }

  function togglePerm(href: string) {
    setForm(f => ({ ...f, permissions: f.permissions.includes(href) ? f.permissions.filter(p => p !== href) : [...f.permissions, href] }))
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!edit) return
    if (form.role !== 'admin' && form.permissions.length === 0) { notify('Отметь хотя бы один раздел', 'error'); return }
    setSaving(true)
    const supabase = createClient()
    const perms = SECTIONS.map(s => s.href).filter(h => form.permissions.includes(h))
    const { error } = await supabase.rpc('update_team_member', {
      p_id: edit.id, p_role: form.role, p_permissions: form.role === 'admin' ? [] : perms, p_full_name: form.full_name,
    })
    setSaving(false)
    if (error) { return }
    await log('update', 'team_member', edit.id, { email: edit.email, role: form.role, permissions: perms })
    setEdit(null)
    load()
  }

  const name = (m: Member) => m.full_name || m.email.split('@')[0]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Команда</h1>
        <p className="text-sm text-gray-400 mt-0.5">Кто заходит в приложение и какие разделы видит</p>
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      ) : (
        <div className="bg-white rounded-[18px] border border-gray-100/80 card-shadow overflow-hidden divide-y divide-gray-100">
          {loading ? (
            <div className="p-5 space-y-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-14" />)}</div>
          ) : members.map(m => {
            const rc = roleCfg(m.role)
            const isMe = m.id === me
            return (
              <div key={m.id} className="flex items-start gap-3 px-5 py-4">
                <div className="w-10 h-10 rounded-xl bg-[#4F46E5] flex items-center justify-center text-white text-sm font-bold flex-shrink-0 uppercase">
                  {name(m).slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900">{name(m)}</span>
                    {isMe && <span className="text-[11px] text-gray-400">(это ты)</span>}
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold ${rc.badge}`}>
                      <rc.icon size={11} /> {rc.label}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 truncate">{m.email}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {m.role === 'admin' ? (
                      <span className="text-xs text-gray-500">Все разделы</span>
                    ) : (m.permissions.length ? SECTIONS.filter(s => m.permissions.includes(s.href)).map(s => (
                      <span key={s.href} className="text-[11px] px-2 py-0.5 rounded-md bg-gray-100 text-gray-600">{s.label}</span>
                    )) : <span className="text-xs text-red-500">Нет доступа ни к одному разделу</span>)}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2">
                    {m.last_sign_in_at
                      ? `Последний вход ${formatDistanceToNow(parseISO(m.last_sign_in_at), { locale: ru, addSuffix: true })}`
                      : 'Ещё не входил'}
                    {' · '}добавлен {format(parseISO(m.created_at), 'd MMM yyyy', { locale: ru })}
                  </p>
                </div>
                <button
                  onClick={() => openEdit(m)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 flex-shrink-0"
                >
                  <Pencil size={13} /> Доступ
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex gap-3 bg-indigo-50/60 border border-indigo-100 rounded-xl px-4 py-3 text-sm text-indigo-900">
        <Info size={16} className="flex-shrink-0 mt-0.5 text-indigo-500" />
        <div className="space-y-1">
          <p>Новый человек появится здесь после того, как ты создашь ему вход в Supabase (Authentication → Users → Add user). По умолчанию у него будет только доступ к «Расходам» — дальше настрой здесь.</p>
        </div>
      </div>

      {/* Edit modal */}
      {edit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) setEdit(null) }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-gray-900">Доступ</h2>
                <p className="text-xs text-gray-400 truncate">{edit.email}</p>
              </div>
              <button onClick={() => setEdit(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <form onSubmit={save} className="px-6 pb-6 space-y-5">
              <div>
                <label htmlFor="member-name" className="block text-sm font-medium text-gray-700 mb-1">Имя</label>
                <input
                  id="member-name"
                  value={form.full_name}
                  onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                  placeholder="Например: Саша (партнёр)"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Роль</p>
                <div className="grid grid-cols-3 gap-2">
                  {ROLES.map(r => {
                    const active = form.role === r.value
                    const locked = edit.id === me && r.value !== 'admin'
                    return (
                      <button
                        key={r.value}
                        type="button"
                        disabled={locked}
                        onClick={() => setRole(r.value)}
                        className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 text-center transition-colors disabled:opacity-40 ${active ? 'border-[#4F46E5] bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}`}
                      >
                        <r.icon size={18} className={active ? 'text-[#4F46E5]' : 'text-gray-400'} />
                        <span className={`text-xs font-semibold ${active ? 'text-[#4F46E5]' : 'text-gray-700'}`}>{r.label}</span>
                      </button>
                    )
                  })}
                </div>
                <p className="text-xs text-gray-400 mt-1.5">{roleCfg(form.role).hint}</p>
                {edit.id === me && <p className="text-xs text-gray-400">Себе роль администратора снять нельзя.</p>}
              </div>

              {form.role !== 'admin' && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-gray-700">Какие разделы видит</p>
                    <div className="flex gap-2 text-xs">
                      <button type="button" onClick={() => setForm(f => ({ ...f, permissions: SECTIONS.map(s => s.href) }))} className="text-[#4F46E5] hover:underline">Все</button>
                      <button type="button" onClick={() => setForm(f => ({ ...f, permissions: [] }))} className="text-gray-400 hover:underline">Снять</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {SECTIONS.map(s => {
                      const on = form.permissions.includes(s.href)
                      return (
                        <button
                          key={s.href}
                          type="button"
                          onClick={() => togglePerm(s.href)}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm text-left transition-colors ${on ? 'border-[#4F46E5] bg-indigo-50 text-gray-900' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                        >
                          <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 ${on ? 'bg-[#4F46E5]' : 'border border-gray-300'}`}>
                            {on && <Check size={12} className="text-white" />}
                          </span>
                          {s.label}
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-xs text-gray-400 mt-2">Раздел «Команда» доступен только администраторам.</p>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button type="submit" disabled={saving} className="flex-1 bg-[#4F46E5] hover:bg-[#4338CA] disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors">
                  {saving ? 'Сохраняю…' : 'Сохранить'}
                </button>
                <button type="button" onClick={() => setEdit(null)} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded-xl text-sm font-medium transition-colors">
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

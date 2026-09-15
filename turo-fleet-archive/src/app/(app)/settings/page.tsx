'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { User, Mail, Lock, Shield, Wrench, LogOut } from 'lucide-react'

const roleLabels: Record<string, { label: string; icon: typeof Shield; color: string }> = {
  owner: { label: 'Овнер', icon: Shield, color: 'bg-purple-50 text-purple-600' },
  operator: { label: 'Оператор', icon: Wrench, color: 'bg-blue-50 text-blue-600' },
}

const inputCls = 'w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/30 focus:border-indigo-400 transition-all'

export default function SettingsPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [initials, setInitials] = useState('')
  const [loading, setLoading] = useState(true)

  const [name, setName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [oldPw, setOldPw] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')

  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { router.push('/login'); return }
      const e = data.user.email || ''
      const fn = data.user.user_metadata?.full_name || ''
      setEmail(e)
      setName(fn)
      setInitials((fn || e).slice(0, 2).toUpperCase())
      const { data: m } = await supabase.from('team_members').select('role').eq('email', e).single()
      if (m?.role) setRole(m.role)
      setLoading(false)
    })
  }, [router])

  async function saveAll(ev: React.FormEvent) {
    ev.preventDefault()
    setMsg(null)

    // Валидация пароля если введён
    const changingPw = !!(oldPw || pw || pw2)
    if (changingPw) {
      if (!oldPw) { setMsg({ t: 'err', m: 'Введите текущий пароль' }); return }
      if (pw !== pw2) { setMsg({ t: 'err', m: 'Новые пароли не совпадают' }); return }
      if (pw.length < 6) { setMsg({ t: 'err', m: 'Новый пароль: минимум 6 символов' }); return }
    }

    setSaving(true)
    const supabase = createClient()
    const done: string[] = []

    try {
      // Если меняем пароль — сначала проверяем текущий
      if (changingPw) {
        const { error: authErr } = await supabase.auth.signInWithPassword({ email, password: oldPw })
        if (authErr) throw new Error('Текущий пароль неверный')
      }
      // Имя
      const { data } = await supabase.auth.getUser()
      const currentName = data.user?.user_metadata?.full_name || ''
      if (name !== currentName) {
        const { error } = await supabase.auth.updateUser({ data: { full_name: name } })
        if (error) throw new Error('Имя: ' + error.message)
        done.push('имя')
      }

      // Пароль
      if (pw) {
        const { error } = await supabase.auth.updateUser({ password: pw })
        if (error) throw new Error('Пароль: ' + error.message)
        done.push('пароль')
        setOldPw(''); setPw(''); setPw2('')
      }

      // Email
      if (newEmail) {
        const { error } = await supabase.auth.updateUser({ email: newEmail })
        if (error) throw new Error('Email: ' + error.message)
        done.push('email (нужно подтвердить по письму)')
        setNewEmail('')
      }

      setInitials((name || email).slice(0, 2).toUpperCase())
      setMsg(done.length ? { t: 'ok', m: 'Сохранено: ' + done.join(', ') } : { t: 'ok', m: 'Нет изменений' })
    } catch (e) {
      setMsg({ t: 'err', m: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  async function logout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading) return <div className="p-8 text-gray-400">Загрузка...</div>

  const roleCfg = roleLabels[role]

  return (
    <div className="p-8 max-w-5xl">
      {/* Profile header */}
      <div className="bg-white rounded-[18px] p-6 card-shadow border border-gray-100/80 flex items-center gap-4 mb-6">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#4F46E5] to-[#7C3AED] flex items-center justify-center text-white text-xl font-bold" style={{ boxShadow: '0 4px 14px rgba(79,70,229,0.35)' }}>
          {initials}
        </div>
        <div className="flex-1">
          <p className="text-lg font-bold text-gray-900">{name || 'Без имени'}</p>
          <p className="text-sm text-gray-400">{email}</p>
        </div>
        {roleCfg && (
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold ${roleCfg.color}`}>
            <roleCfg.icon size={13} /> {roleCfg.label}
          </span>
        )}
      </div>

      <form onSubmit={saveAll}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Имя */}
          <div className="bg-white rounded-[18px] p-6 card-shadow border border-gray-100/80">
            <h2 className="flex items-center gap-2 text-base font-bold text-gray-900 mb-4"><User size={17} className="text-gray-400" /> Имя</h2>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Имя Фамилия" className={inputCls} />
          </div>

          {/* Email */}
          <div className="bg-white rounded-[18px] p-6 card-shadow border border-gray-100/80">
            <h2 className="flex items-center gap-2 text-base font-bold text-gray-900 mb-1"><Mail size={17} className="text-gray-400" /> Email</h2>
            <p className="text-xs text-gray-400 mb-3">Текущий: {email}</p>
            <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="новый@email.com" className={inputCls} />
          </div>

          {/* Пароль */}
          <div className="bg-white rounded-[18px] p-6 card-shadow border border-gray-100/80 md:col-span-2">
            <h2 className="flex items-center gap-2 text-base font-bold text-gray-900 mb-1"><Lock size={17} className="text-gray-400" /> Пароль</h2>
            <p className="text-xs text-gray-400 mb-4">Заполните только если хотите сменить пароль</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input type="password" autoComplete="off" value={oldPw} onChange={e => setOldPw(e.target.value)} placeholder="Текущий пароль" className={inputCls} />
              <input type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} placeholder="Новый пароль" className={inputCls} />
              <input type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder="Повторите новый" className={inputCls} />
            </div>
          </div>
        </div>

        {/* Bottom save bar */}
        <div className="flex items-center gap-4 mt-6">
          <button disabled={saving} className="inline-flex items-center gap-2 bg-[#4F46E5] hover:bg-[#4338CA] text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors disabled:opacity-50">
            {saving ? 'Сохраняем...' : 'Сохранить изменения'}
          </button>
          {msg && (
            <span className={`text-sm font-medium ${msg.t === 'ok' ? 'text-emerald-600' : 'text-rose-500'}`}>{msg.m}</span>
          )}
        </div>
      </form>

      {/* Logout */}
      <button onClick={logout} className="inline-flex items-center gap-2 text-sm font-semibold text-rose-500 hover:text-rose-600 transition-colors px-2 py-2 mt-8">
        <LogOut size={16} /> Выйти из аккаунта
      </button>
    </div>
  )
}

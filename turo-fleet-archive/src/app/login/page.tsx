'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { inputCls } from '@/components/ui/PageShell'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [isInvite, setIsInvite] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const hash = window.location.hash
    if (!hash.includes('type=invite') && !hash.includes('type=recovery')) return

    setIsInvite(true)
    const supabase = createClient()

    // Supabase автоматически обрабатывает hash и эмитит SIGNED_IN
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        subscription.unsubscribe()
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('Неверный email или пароль')
      setLoading(false)
    } else {
      router.push('/dashboard')
    }
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError('Пароли не совпадают')
      return
    }
    if (password.length < 6) {
      setError('Минимум 6 символов')
      return
    }
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({
      password,
      data: { full_name: name },
    })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--background)' }}>
      <div className="bg-white rounded-[24px] card-shadow border border-gray-100/80 p-6 sm:p-8 w-full max-w-sm">
        <div className="text-center mb-7">
          <div className="flex justify-center mb-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon-192.png" alt="" width={72} height={72} className="rounded-[20px] border border-gray-100" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Fleet Manager</h1>
          <p className="text-sm text-gray-500 mt-1">{isInvite ? 'Придумайте пароль для входа' : 'Управление автопарком Turo'}</p>
        </div>

        {isInvite ? (
          <form onSubmit={handleSetPassword} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Ваше имя</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                required
                className={inputCls}
                placeholder="Имя Фамилия"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Пароль</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className={inputCls}
                placeholder="Минимум 6 символов"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Повторите пароль</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                className={inputCls}
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full h-11"
            >
              {loading ? 'Сохраняем...' : 'Создать пароль и войти'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email</label>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className={inputCls}
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Пароль</label>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className={inputCls}
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full h-11"
            >
              {loading ? 'Входим...' : 'Войти'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

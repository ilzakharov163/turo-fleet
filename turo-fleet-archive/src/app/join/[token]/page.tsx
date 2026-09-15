'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import Logo from '@/components/ui/Logo'

export default function JoinPage() {
  const { token } = useParams<{ token: string }>()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [tokenValid, setTokenValid] = useState<boolean | null>(null)
  const [email, setEmail] = useState('')
  const router = useRouter()

  useEffect(() => {
    async function checkToken() {
      const res = await fetch(`/api/join/check?token=${token}`)
      const data = await res.json()
      if (data.valid) {
        setEmail(data.email)
        setTokenValid(true)
      } else {
        setTokenValid(false)
        setError(data.error || 'Ссылка недействительна или истекла')
      }
    }
    checkToken()
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError('Пароли не совпадают'); return }
    if (password.length < 6) { setError('Минимум 6 символов'); return }
    setLoading(true)
    setError('')

    const res = await fetch('/api/join/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, name, password }),
    })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error || 'Ошибка регистрации')
      setLoading(false)
      return
    }

    // Логиним пользователя
    const supabase = createClient()
    await supabase.auth.signInWithPassword({ email, password })
    router.push('/dashboard')
  }

  if (tokenValid === null) {
    return <div className="min-h-screen bg-[#F4F5F9]" />
  }

  if (tokenValid === false) {
    return (
      <div className="min-h-screen bg-[#F4F5F9] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm flex flex-col items-center text-center">
          <Logo size={90} />
          <p className="text-red-500 font-semibold mt-6">{error}</p>
          <a href="/login" className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors">
            Войти
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F4F5F9] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-2"><Logo size={100} /></div>
          <p className="text-sm text-gray-500 mt-2">Создайте аккаунт для входа</p>
          <p className="text-xs text-gray-400 mt-1">{email}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ваше имя</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Имя Фамилия"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Пароль</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Минимум 6 символов"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Повторите пароль</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            {loading ? 'Создаём аккаунт...' : 'Создать аккаунт и войти'}
          </button>
        </form>
      </div>
    </div>
  )
}

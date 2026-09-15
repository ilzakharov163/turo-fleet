import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { token, name, password } = await req.json()

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Проверяем токен
    const { data: tokenData, error: tokenError } = await supabase
      .from('invite_tokens')
      .select('email, role, used, expires_at')
      .eq('token', token)
      .single()

    if (tokenError || !tokenData) return NextResponse.json({ error: 'Ссылка недействительна' }, { status: 400 })
    if (tokenData.used) return NextResponse.json({ error: 'Ссылка уже использована' }, { status: 400 })
    if (new Date(tokenData.expires_at) < new Date()) return NextResponse.json({ error: 'Срок действия истёк' }, { status: 400 })

    const { email, role } = tokenData

    // Создаём пользователя
    const { error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { full_name: name },
      email_confirm: true,
    })

    if (createError) return NextResponse.json({ error: createError.message }, { status: 400 })

    // Помечаем токен как использованный
    await supabase.from('invite_tokens').update({ used: true }).eq('token', token)

    // Обновляем статус в team_members
    await supabase.from('team_members').upsert({
      email, role, status: 'active',
      invited_at: new Date().toISOString(),
    }, { onConflict: 'email' })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}

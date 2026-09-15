import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ valid: false, error: 'Токен не указан' })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabase
    .from('invite_tokens')
    .select('email, role, used, expires_at')
    .eq('token', token)
    .single()

  if (error || !data) return NextResponse.json({ valid: false, error: 'Ссылка недействительна' })
  if (data.used) return NextResponse.json({ valid: false, error: 'Ссылка уже была использована' })
  if (new Date(data.expires_at) < new Date()) return NextResponse.json({ valid: false, error: 'Срок действия ссылки истёк' })

  return NextResponse.json({ valid: true, email: data.email, role: data.role })
}

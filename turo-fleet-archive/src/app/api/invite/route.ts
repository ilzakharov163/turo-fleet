import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

export async function POST(req: NextRequest) {
  try {
    const { email, role } = await req.json()

    if (!email || !role) {
      return NextResponse.json({ error: 'Email и роль обязательны' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Создаём токен приглашения
    const { data: tokenData, error: tokenError } = await supabase
      .from('invite_tokens')
      .insert({ email, role })
      .select('token')
      .single()

    if (tokenError) {
      return NextResponse.json({ error: tokenError.message }, { status: 500 })
    }

    const joinUrl = `${process.env.NEXT_PUBLIC_APP_URL}/join/${tokenData.token}`

    // Отправляем письмо через Resend API
    const resend = new Resend(process.env.RESEND_API_KEY!)
    const { error: emailError } = await resend.emails.send({
      from: 'Turo Fleet <onboarding@resend.dev>',
      to: email,
      subject: 'Вас пригласили в Turo Fleet',
      headers: { 'X-Entity-Ref-ID': tokenData.token },
      html: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#F4F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F5F9;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
        <tr>
          <td style="background:#ffffff;border-radius:20px;padding:40px 40px 36px;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
            <p style="margin:0 0 8px;font-size:24px;font-weight:700;color:#111827;letter-spacing:-0.5px;text-align:center;">Вас пригласили 👋</p>
            <p style="margin:0 0 28px;font-size:15px;color:#6B7280;line-height:1.6;text-align:center;">Вы получили доступ к системе управления автопарком <strong style="color:#111827;">Turo Fleet</strong>. Нажмите кнопку ниже, чтобы создать пароль и войти.</p>
            <a href="${joinUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#4F46E5,#7C3AED);color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 24px;border-radius:12px;box-shadow:0 4px 14px rgba(79,70,229,0.35);">Принять приглашение</a>
            <div style="margin:28px 0;border-top:1px solid #F3F4F6;"></div>
            <p style="margin:0;font-size:12px;color:#9CA3AF;line-height:1.6;text-align:center;">Ссылка действительна 7 дней.<br/>Если вы не ожидали это письмо — просто проигнорируйте его.</p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding-top:24px;">
            <p style="margin:0;font-size:12px;color:#C4C9D4;">© 2026 Turo Fleet · Fleet Management System</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    })

    if (emailError) {
      return NextResponse.json({ error: emailError.message }, { status: 500 })
    }

    // Сохраняем в team_members
    await supabase.from('team_members').upsert({
      email, role, status: 'pending',
      invited_at: new Date().toISOString(),
    }, { onConflict: 'email' })

    return NextResponse.json({ success: true })
  } catch (e) {
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}

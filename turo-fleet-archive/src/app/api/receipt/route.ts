import { createClient } from '@/lib/supabase-server'
import { serviceDb } from '@/lib/agent/server'
import { readReceipt } from '@/lib/agent/receipt'
import { accessFrom, canAny } from '@/lib/core'

// «Расходы» → фото чека: прочитать итоговую сумму и дату (Claude). Только для вошедших с галочкой «Расходы».
export const maxDuration = 60

export async function POST(request: Request) {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return Response.json({ error: 'Нужно войти' }, { status: 401 })
  const db = serviceDb()
  const { data: profile } = await db.from('profiles').select('role, permissions').eq('id', user.id).maybeSingle()
  if (!profile || !canAny(accessFrom(profile.role, profile.permissions), ['/expenses'])) return Response.json({ error: 'Нет доступа' }, { status: 403 })

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return Response.json({ error: 'Нет файла' }, { status: 400 })
  if (file.size > 8 * 1024 * 1024) return Response.json({ error: 'Файл больше 8 МБ' }, { status: 413 })
  const mime = file.type === 'application/pdf' || file.type === 'image/png' ? file.type : 'image/jpeg'
  if (!file.type.startsWith('image/') && file.type !== 'application/pdf') return Response.json({ error: 'Нужна картинка или PDF' }, { status: 400 })

  const data = await readReceipt(db, user.id, { bytes: Buffer.from(await file.arrayBuffer()), mime })
  return data ? Response.json(data) : Response.json({ error: 'Не удалось прочитать' }, { status: 502 })
}

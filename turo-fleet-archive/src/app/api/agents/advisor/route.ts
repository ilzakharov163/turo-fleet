import { serviceDb } from '@/lib/agent/server'
import { isAdminRequest, isCronRequest } from '@/lib/agent/admin'
import { runAdvisor } from '@/lib/agent/advisor'

// Советник: GET — по расписанию Vercel Cron (vercel.json), POST — «Запустить сейчас» в Настройки → Агенты (только админ).
export const maxDuration = 120

export async function GET(request: Request) {
  if (!isCronRequest(request)) return new Response('forbidden', { status: 403 })
  return Response.json(await runAdvisor(serviceDb()))
}

export async function POST() {
  if (!await isAdminRequest()) return Response.json({ error: 'Только для админа' }, { status: 403 })
  return Response.json(await runAdvisor(serviceDb()))
}

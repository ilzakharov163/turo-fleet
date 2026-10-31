import type { SupabaseClient } from '@supabase/supabase-js'
import { num } from '../calc'
import { askClaude, finishRun, startRun, tellAdmins } from './scheduled'

// Советник: раз в неделю смотрит, как пользуются приложением и ботом, и предлагает 2–3 улучшения.
// Ничего не меняет — только пишет владельцу. Прошлые идеи помнит, чтобы не повторяться.

const APP = `Приложение Fleet Manager (сайт + PWA на iPhone + Telegram-бот «Учётчик») для автопарка на Turo, ~30 машин, владелец, партнёр и один работник.
Разделы: Дашборд; Авто (машины, простои и зарплата работника, клеймы, наклейки — замена каждые 45 дней); Расходы (по машинам, с фото чеков);
Доходы (Gross по машинам по аккаунтам, клеймы Initial/Supplement с вычетом Turo, ремонт, прочее, платёж за машину, расходы компании, затраты на сотрудника, общие платежи, прибыль);
Отчёты (тексты для Telegram, Excel, прибыль машин, аналитика); Настройки (профиль, команда, агенты, история, резервные копии).
Бот в Telegram: понимает текст, голос и фото чеков, расходы пишет сразу (кнопка «Отменить»), остальное — после кнопки «Записать». Работнику бот только записывает расходы.
Агенты: Учётчик (по сообщениям), Ревизор (ежедневная проверка данных), Советник (ты).`

const SYSTEM = `Ты — Советник владельца автопарка Turo. Раз в неделю ты смотришь на факты: что люди делали в приложении и что писали боту, — и предлагаешь 2–3 конкретных улучшения приложения или процесса, которые сэкономят время, уберут ошибки или дадут деньги.
${APP}

Правила:
- Каждая идея опирается на факт из данных недели (назови его цифрой: «GPS вносили 5 раз», «бот 3 раза не смог…»). Без факта — не предлагай.
- Конкретно: что именно сделать в приложении или боте и какая польза. Оценка сложности: «быстро» / «средне» / «долго».
- Не повторяй прошлые идеи (список ниже), если по ним нет нового факта.
- Если данных мало и предложить нечего — так и скажи одной фразой.
- По-русски, коротко, без markdown: обычный текст, идеи с номерами «1.», «2.». В конце: «Скажите Claude Code, какую идею делать.»`

export async function runAdvisor(db: SupabaseClient) {
  const runId = await startRun(db, 'advisor', 'Еженедельные идеи')
  const steps: { kind: string; text: string }[] = []
  try {
    const since = new Date(Date.now() - 7 * 86400_000).toISOString()
    const since30 = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
    const [logRes, runsRes, expRes, pastRes] = await Promise.all([
      db.from('activity_log').select('action, entity_type, user_email, details, created_at').gte('created_at', since).limit(2000),
      db.from('agent_runs').select('agent, input, output, status').eq('agent', 'bookkeeper').gte('created_at', since).limit(300),
      db.from('expenses').select('title, amount, files, car_id, date').gte('date', since30),
      db.from('agent_runs').select('output, created_at').eq('agent', 'advisor').eq('status', 'done').order('created_at', { ascending: false }).limit(3),
    ])

    const log = (logRes.data || []) as { action: string; entity_type: string; user_email: string; details: Record<string, unknown> | null }[]
    const count = <T,>(xs: T[], key: (x: T) => string) => Object.entries(xs.reduce<Record<string, number>>((m, x) => { const k = key(x); m[k] = (m[k] || 0) + 1; return m }, {})).sort((a, b) => b[1] - a[1])
    const viaTg = log.filter(l => l.details?.via === 'telegram').length
    const runs = (runsRes.data || []) as { input: string | null; output: string | null; status: string }[]
    const failed = runs.filter(r => r.status === 'error' || /не могу|не умею|нет доступа|ошибка/i.test(r.output || ''))
    const exps = (expRes.data || []) as { title: string; amount: number; files: string[] | null; car_id: string | null }[]

    const facts = [
      `Действия на сайте и в боте за 7 дней: ${log.length} (из них через Telegram: ${viaTg}).`,
      `По типам: ${count(log, l => `${l.entity_type}/${l.action}`).slice(0, 12).map(([k, v]) => `${k} ${v}`).join(', ') || 'нет'}.`,
      `По людям: ${count(log, l => l.user_email.split('@')[0]).map(([k, v]) => `${k} ${v}`).join(', ') || 'нет'}.`,
      `Сообщений боту: ${runs.length}, не получилось или «не умею»: ${failed.length}.`,
      ...failed.slice(0, 8).map(r => `  — «${(r.input || '').slice(0, 120)}» → «${(r.output || '').slice(0, 160)}»`),
      `Что писали боту (примеры): ${runs.slice(0, 15).map(r => `«${(r.input || '').slice(0, 80)}»`).join('; ') || 'ничего'}.`,
      `Расходы за 30 дней: ${exps.length} шт. на $${Math.round(exps.reduce((s, e) => s + num(e.amount), 0))}; без чека: ${exps.filter(e => !e.files?.length).length}; без машины: ${exps.filter(e => !e.car_id).length}.`,
      `Частые статьи: ${count(exps, e => e.title).slice(0, 8).map(([k, v]) => `${k} ×${v}`).join(', ') || 'нет'}.`,
    ]
    const past = ((pastRes.data || []) as { output: string | null }[]).map(p => p.output).filter(Boolean)
    steps.push({ kind: 'tool', text: `Собрал факты недели: ${log.length} действий, ${runs.length} сообщений боту, ${exps.length} расходов` })

    const ai = await askClaude(SYSTEM, `Факты за неделю:\n${facts.join('\n')}\n\nПрошлые идеи (не повторять):\n${past.length ? past.map((p, i) => `${i + 1}) ${p!.slice(0, 600)}`).join('\n') : 'нет'}`)
    if (!ai) throw new Error('Claude не ответил')
    const sent = await tellAdmins(db, '💡 Советник: идеи недели', ai.text)
    steps.push({ kind: 'reply', text: `Отправлено владельцам: ${sent}` })
    await finishRun(db, runId, { status: 'done', output: ai.text, steps, usage: ai.usage })
    return { ok: true }
  } catch (e) {
    console.error('advisor', e)
    await finishRun(db, runId, { status: 'error', output: String(e).slice(0, 500), steps })
    throw e
  }
}

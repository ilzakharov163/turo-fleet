import type { SupabaseClient } from '@supabase/supabase-js'
import { num } from '../calc'
import { todayLA } from './server'
import { askClaude, finishRun, startRun, tellAdmins } from './scheduled'

// Ревизор: каждый день проверяет, что данные сходятся. Проверки — обычным кодом (точно и бесплатно),
// Claude только пишет из найденного короткое сообщение владельцу. Ничего не меняет.
// Нет проблем — не пишет.

export interface Finding { level: 'важно' | 'проверить' | 'напоминание'; text: string }

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400_000)
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10)
const prevMonth = (period: string) => { const [y, m] = period.split('-').map(Number); return `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}-01` }
const ru = (d: string) => d.split('-').reverse().join('.')

type Car = { id: string; make: string; model: string; plate: string; delisted: boolean; removed_from: string | null }
type Claim = { id: string; car_id: string | null; claim_number: string | null; description: string | null; status: string; opened_date: string | null; completed_date: string | null; still_listed: boolean }
type Block = { id: string; car_id: string; start_date: string; end_date: string | null; reason: string | null }

export async function auditFindings(db: SupabaseClient, today = todayLA()): Promise<Finding[]> {
  const period = `${today.slice(0, 8)}01`
  const [carsRes, claimsRes, blocksRes, stickerCarsRes, stickerChRes, pendingRes, errorsRes] = await Promise.all([
    db.from('cars').select('id, make, model, plate, delisted, removed_from'),
    db.from('claims').select('id, car_id, claim_number, description, status, opened_date, completed_date, still_listed'),
    db.from('car_blocks').select('id, car_id, start_date, end_date, reason').or(`end_date.is.null,end_date.gte.${addDays(today, -1)}`),
    db.from('sticker_cars').select('car_id'),
    db.from('sticker_changes').select('car_id, changed_date'),
    db.from('agent_pending').select('id, created_at').eq('status', 'waiting').lt('created_at', new Date(Date.now() - 12 * 3600_000).toISOString()),
    db.from('agent_runs').select('id').eq('status', 'error').gte('created_at', new Date(Date.now() - 24 * 3600_000).toISOString()),
  ])
  const cars = (carsRes.data || []) as Car[]
  const inFleet = (c: Car) => !c.delisted && (!c.removed_from || c.removed_from > period)
  const name = (id: string | null) => { const c = cars.find(x => x.id === id); return c ? `${c.make} ${c.model} ${c.plate}` : 'машина не указана' }
  const claims = (claimsRes.data || []) as Claim[]
  const blocks = (blocksRes.data || []) as Block[]
  const idleOn = (carId: string, d: string) => blocks.filter(b => b.car_id === carId && b.start_date <= d && (!b.end_date || b.end_date >= d))
  const out: Finding[] = []

  for (const c of claims) {
    const num = c.claim_number || '—'
    if (c.status !== 'done' && c.opened_date && days(c.opened_date, today) > 30)
      out.push({ level: 'проверить', text: `Клейм № ${num} (${name(c.car_id)}) открыт ${days(c.opened_date, today)} дн. (с ${ru(c.opened_date)}), статус «${c.status === 'in_repair' ? 'в ремонте' : 'ожидает ремонта'}»` })
    if (c.status !== 'done' && !c.still_listed && c.car_id && !idleOn(c.car_id, today).length)
      out.push({ level: 'важно', text: `Клейм № ${num}: машина ${name(c.car_id)} снята с листинга, но простоя на сегодня нет — зарплата и статус считаются как «в работе»` })
    if (c.status === 'done' && c.car_id && c.claim_number && c.completed_date) {
      const open = idleOn(c.car_id, today).find(b => (b.reason || '').toLowerCase().includes(c.claim_number!.toLowerCase()))
      if (open) out.push({ level: 'важно', text: `Клейм № ${num} завершён ${ru(c.completed_date)}, а простой ${name(c.car_id)} по нему всё ещё открыт (с ${ru(open.start_date)})` })
    }
  }

  for (const b of blocks) {
    const car = cars.find(c => c.id === b.car_id)
    if (!car || !inFleet(car) || b.end_date || b.start_date > today) continue
    const long = days(b.start_date, today)
    if (long > 45 && !/клейм/i.test(b.reason || '')) out.push({ level: 'проверить', text: `${name(b.car_id)} в простое ${long} дн. (с ${ru(b.start_date)}, «${b.reason || 'без причины'}») — машина точно ещё не в работе?` })
  }

  const changes = (stickerChRes.data || []) as { car_id: string; changed_date: string }[]
  for (const { car_id } of (stickerCarsRes.data || []) as { car_id: string }[]) {
    const car = cars.find(c => c.id === car_id)
    if (!car || !inFleet(car)) continue
    const last = changes.filter(x => x.car_id === car_id).map(x => x.changed_date).sort().pop()
    if (!last) continue
    const due = addDays(last, 45)
    if (due <= addDays(today, 7)) out.push({ level: due < today ? 'важно' : 'напоминание', text: `Наклейка ${name(car_id)}: замена ${due < today ? `просрочена с ${ru(due)}` : `до ${ru(due)}`}` })
  }

  // Начало месяца: внесены ли Gross и зарплата за прошлый месяц
  if (Number(today.slice(8, 10)) <= 7) {
    const prev = prevMonth(period)
    const [rcRes, accRes, entRes, expRes] = await Promise.all([
      db.from('revenue_cars').select('id, account, name, car_id, added_from, sold_from'),
      db.from('revenue_accounts').select('key, active_from, active_until'),
      db.from('revenue_entries').select('revenue_car_id, gross').eq('period', prev),
      db.from('revenue_month_expenses').select('salary2').eq('period', prev).maybeSingle(),
    ])
    const accs = ((accRes.data || []) as { key: string; active_from: string; active_until: string | null }[]).filter(a => a.active_from <= prev && (!a.active_until || prev <= a.active_until))
    const visible = ((rcRes.data || []) as { id: string; account: string; name: string; car_id: string | null; added_from: string; sold_from: string | null }[])
      .filter(r => accs.some(a => a.key === r.account) && r.added_from <= prev && (!r.sold_from || prev < r.sold_from))
    const noGross = visible.filter(r => !((entRes.data || []) as { revenue_car_id: string; gross: number }[]).some(e => e.revenue_car_id === r.id && num(e.gross) > 0))
    if (noGross.length) out.push({ level: 'напоминание', text: `Gross за ${prev.slice(0, 7)} не внесён у ${noGross.length} машин: ${noGross.slice(0, 6).map(r => (r.car_id ? name(r.car_id) : r.name)).join(', ')}${noGross.length > 6 ? '…' : ''}` })
    if (!num(expRes.data?.salary2)) out.push({ level: 'напоминание', text: `Зарплата работника за ${prev.slice(0, 7)} в «Доходах» не внесена — вычеты и прибыль месяца пока неточные` })
  }

  if (pendingRes.data?.length) out.push({ level: 'напоминание', text: `В Telegram ${pendingRes.data.length} подготовленных действий ждут кнопку «Записать» больше 12 часов — они не записаны` })
  if (errorsRes.data?.length) out.push({ level: 'проверить', text: `У Учётчика за сутки ${errorsRes.data.length} ошибок — подробности в Настройки → Агенты` })

  const order = { 'важно': 0, 'проверить': 1, 'напоминание': 2 }
  return out.sort((a, b) => order[a.level] - order[b.level])
}

const SYSTEM = `Ты — Ревизор автопарка Turo в приложении Fleet Manager. Тебе дают список найденных проблем в данных (найдены программой, они точные).
Напиши владельцу короткое сообщение в Telegram по-русски: сначала самое важное, по пункту на проблему, к каждому — что сделать (одной фразой).
Используй только факты из списка, ничего не добавляй и не выдумывай. Без приветствий и заголовков, без markdown — обычный текст, пункты через «•».
В конце одной строкой: «Можно ответить мне здесь, например: “закрой простой …” — Учётчик подготовит исправление.»`

export async function runAuditor(db: SupabaseClient, opts: { quietIfOk: boolean }) {
  const runId = await startRun(db, 'auditor', 'Ежедневная проверка')
  const steps: { kind: string; text: string }[] = []
  try {
    const findings = await auditFindings(db)
    steps.push({ kind: 'tool', text: `Проверка данных: найдено ${findings.length}` })
    for (const f of findings) steps.push({ kind: f.level === 'важно' ? 'error' : 'tool', text: `${f.level}: ${f.text}` })
    if (!findings.length) {
      if (!opts.quietIfOk) await tellAdmins(db, '🛡 Ревизор', 'Проверил клеймы, простои, наклейки и «Доходы» — всё сходится.')
      await finishRun(db, runId, { status: 'done', output: 'Всё в порядке', steps })
      return { findings: 0 }
    }
    const ai = await askClaude(SYSTEM, findings.map(f => `[${f.level}] ${f.text}`).join('\n'))
    const text = ai?.text || findings.map(f => `• ${f.text}`).join('\n')
    const sent = await tellAdmins(db, `🛡 Ревизор: ${findings.length} ${findings.length === 1 ? 'вопрос' : 'вопроса(ов)'}`, text)
    steps.push({ kind: 'reply', text: `Отправлено владельцам: ${sent}` })
    await finishRun(db, runId, { status: 'done', output: text, steps, usage: ai?.usage })
    return { findings: findings.length }
  } catch (e) {
    console.error('auditor', e)
    await finishRun(db, runId, { status: 'error', output: String(e).slice(0, 500), steps })
    throw e
  }
}

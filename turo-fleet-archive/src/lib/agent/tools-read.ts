import { calcEntry, calcSalary, idleDaysInMonth, inFleet, monthExpensesTotal, appliedDeductions, num, type RevenueEntry, type MonthExpenses } from '../calc'
import { carLabel, monthOr, str, usd, type AgentTool } from './tools'

// Инструменты только для чтения: клеймы, расходы, простои, доходы, зарплата.

const STATUS: Record<string, string> = { waiting: 'ожидает ремонта', in_repair: 'в ремонте', done: 'завершён' }

const listClaims: AgentTool = {
  mode: 'read', perms: ['/claims', '/dashboard', '/reports'],
  def: {
    name: 'list_claims',
    description: 'Клеймы: открытые (ожидает ремонта / в ремонте), завершённые или все. Можно искать по номеру клейма, машине или описанию. Возвращает claim_id для других действий.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'done', 'all'], description: 'По умолчанию open' },
        query: { type: 'string', description: 'Номер клейма, номер машины или слово из описания' },
      },
    },
  },
  async run(ctx, input) {
    let q = ctx.db.from('claims').select('id, car_id, claim_number, description, status, opened_date, completed_date, still_listed, initial_payment_received, initial_amount, supplement_paid, supplement_amount, notes, car:cars(make, model, plate)')
      .order('opened_date', { ascending: false }).limit(60)
    const status = str(input.status) || 'open'
    if (status === 'open') q = q.neq('status', 'done')
    if (status === 'done') q = q.eq('status', 'done')
    const { data } = await q
    type Row = { id: string; claim_number: string | null; description: string | null; status: string; opened_date: string | null; completed_date: string | null; still_listed: boolean; initial_payment_received: boolean; initial_amount: number | null; supplement_paid: boolean; supplement_amount: number | null; notes: string | null; car: { make: string; model: string; plate: string } | null }
    let rows = (data || []) as unknown as Row[]
    const needle = str(input.query).toLowerCase()
    if (needle) rows = rows.filter(r => [r.claim_number, r.description, r.notes, r.car ? carLabel(r.car) : ''].some(v => (v || '').toLowerCase().includes(needle)))
    if (!rows.length) return 'Клеймов не найдено'
    return rows.map(r => [
      `claim_id ${r.id}`, `№ ${r.claim_number || '—'}`, r.car ? carLabel(r.car) : 'без машины', STATUS[r.status] || r.status,
      r.description || '', `открыт ${r.opened_date || '?'}`, r.completed_date ? `завершён ${r.completed_date}` : '',
      r.status !== 'done' ? (r.still_listed ? 'машина в листинге' : 'машина снята с листинга') : '',
      `Initial: ${r.initial_payment_received ? (r.initial_amount ? usd(num(r.initial_amount)) : 'получен') : 'нет'}`,
      `Supplement: ${r.supplement_paid ? (r.supplement_amount ? usd(num(r.supplement_amount)) : 'получен') : 'нет'}`,
    ].filter(Boolean).join(' · ')).join('\n')
  },
}

const listExpenses: AgentTool = {
  mode: 'read', perms: ['/expenses', '/dashboard', '/analytics'],
  def: {
    name: 'list_expenses',
    description: 'Расходы за месяц (по умолчанию текущий): по машине, статье или слову, только неоплаченные. Возвращает expense_id и итог.',
    input_schema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'YYYY-MM' },
        car_id: { type: 'string' },
        query: { type: 'string', description: 'Слово из статьи или заметки, например GPS' },
        unpaid_only: { type: 'boolean' },
      },
    },
  },
  async run(ctx, input) {
    const from = monthOr(input.month, ctx.today)
    const [y, m] = from.split('-').map(Number)
    const to = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`
    let q = ctx.db.from('expenses').select('id, car_id, title, amount, date, paid, notes, files').gte('date', from).lt('date', to).order('date')
    if (str(input.car_id)) q = q.eq('car_id', str(input.car_id))
    if (input.unpaid_only) q = q.eq('paid', false)
    const { data } = await q
    type Row = { id: string; car_id: string | null; title: string; amount: number; date: string; paid: boolean; notes: string | null; files: string[] | null }
    let rows = (data || []) as Row[]
    const needle = str(input.query).toLowerCase()
    if (needle) rows = rows.filter(r => `${r.title} ${r.notes || ''}`.toLowerCase().includes(needle))
    if (!rows.length) return 'Расходов не найдено'
    const name = (id: string | null) => { const c = ctx.cars.find(x => x.id === id); return c ? carLabel(c) : 'без машины' }
    const total = rows.reduce((s, r) => s + num(r.amount), 0)
    return rows.map(r => `expense_id ${r.id} · ${r.date} · ${name(r.car_id)} · ${r.title} · ${usd(num(r.amount))} · ${r.paid ? 'оплачен' : 'не оплачен'}${r.files?.length ? ' · чек есть' : ' · без чека'}${r.notes ? ` · ${r.notes}` : ''}`)
      .join('\n') + `\nИтого: ${rows.length} шт., ${usd(total)}`
  },
}

const listDowntime: AgentTool = {
  mode: 'read', perms: ['/calendar', '/cars', '/dashboard', '/income', '/reports'],
  def: {
    name: 'list_downtime',
    description: 'Простои за месяц (по умолчанию текущий): какая машина, с какого по какое число, причина, дней простоя в месяце.',
    input_schema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM' }, car_id: { type: 'string' } } },
  },
  async run(ctx, input) {
    const from = monthOr(input.month, ctx.today)
    const end = `${from.slice(0, 8)}${new Date(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 0).getDate()}`
    let q = ctx.db.from('car_blocks').select('car_id, start_date, end_date, reason').lte('start_date', end).or(`end_date.is.null,end_date.gte.${from}`).order('start_date')
    if (str(input.car_id)) q = q.eq('car_id', str(input.car_id))
    const { data } = await q
    const rows = (data || []) as { car_id: string; start_date: string; end_date: string | null; reason: string | null }[]
    if (!rows.length) return 'Простоев нет'
    const { data: cars } = await ctx.db.from('cars').select('id, make, model, plate')
    const name = (id: string) => { const c = (cars || []).find(x => x.id === id); return c ? carLabel(c) : id }
    return rows.map(b => `${name(b.car_id)} · с ${b.start_date} по ${b.end_date || '…'} · ${b.reason || 'без причины'} · дней в месяце: ${idleDaysInMonth(rows.filter(x => x.car_id === b.car_id), from)}`).join('\n')
  },
}

const incomeSummary: AgentTool = {
  mode: 'read', perms: ['/income'],
  def: {
    name: 'income_summary',
    description: 'Доходы за месяц: итог по аккаунтам, Gross, клеймы, расходы компании, затраты на сотрудника, платежи и чистая прибыль (как в разделе «Доходы»). Плюс лучшие и минусовые машины.',
    input_schema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM, по умолчанию текущий' } } },
  },
  async run(ctx, input) {
    const period = monthOr(input.month, ctx.today)
    const [entRes, rcRes, accRes, expRes, payRes, dedRes] = await Promise.all([
      ctx.db.from('revenue_entries').select('revenue_car_id, gross, repair, claim_items, other_items, payment').eq('period', period),
      ctx.db.from('revenue_cars').select('id, account, name, car_id'),
      ctx.db.from('revenue_accounts').select('key, label, sort').order('sort'),
      ctx.db.from('revenue_month_expenses').select('salary1, salary2, items').eq('period', period).maybeSingle(),
      ctx.db.from('revenue_payments').select('amount').eq('period', period),
      ctx.db.from('salary_deductions').select('amount, date').gte('date', period).lte('date', `${period.slice(0, 8)}31`),
    ])
    const entries = (entRes.data || []) as (RevenueEntry & { revenue_car_id: string })[]
    if (!entries.length) return `За ${period.slice(0, 7)} в «Доходах» ещё нет записей`
    const rcs = (rcRes.data || []) as { id: string; account: string; name: string; car_id: string | null }[]
    const carName = (rc?: { name: string; car_id: string | null }) => { const c = ctx.cars.find(x => x.id === rc?.car_id); return c ? carLabel(c) : rc?.name || '?' }
    const byAcc: Record<string, number> = {}
    let gross = 0
    const perCar = entries.map(e => {
      const rc = rcs.find(r => r.id === e.revenue_car_id)
      const t = calcEntry(e)
      gross += t.gross
      if (rc) byAcc[rc.account] = (byAcc[rc.account] || 0) + t.net
      return { name: carName(rc), net: t.net }
    })
    const exp = expRes.data as MonthExpenses | null
    const company = (exp?.items || []).reduce((s, i) => s + num(i.amount), 0)
    const dedAll = ((dedRes.data || []) as { amount: number }[]).reduce((s, d) => s + num(d.amount), 0)
    const staff = num(exp?.salary1) + num(exp?.salary2) - appliedDeductions(num(exp?.salary2), dedAll)
    const pays = ((payRes.data || []) as { amount: number }[]).reduce((s, p) => s + num(p.amount), 0)
    const accTotal = Object.values(byAcc).reduce((s, v) => s + v, 0)
    const profit = perCar.reduce((s, c) => s + c.net, 0) - monthExpensesTotal(exp) + appliedDeductions(num(exp?.salary2), dedAll) - pays
    const sorted = [...perCar].sort((a, b) => b.net - a.net)
    const accLines = ((accRes.data || []) as { key: string; label: string }[]).filter(a => byAcc[a.key] !== undefined).map(a => `  ${a.label}: ${usd(byAcc[a.key])}`)
    return [
      `Месяц ${period.slice(0, 7)}`, `Gross: ${usd(gross)}`, 'Итого по аккаунтам:', ...accLines, `  Всего: ${usd(accTotal)}`,
      `Расходы компании: ${usd(company)}`, `Затраты на сотрудника: ${usd(staff)}${num(exp?.salary2) ? '' : ' (зарплата ещё не внесена)'}`,
      `Платежи: ${usd(pays)}`, `Чистая прибыль: ${usd(profit)}`,
      `Лучшие: ${sorted.slice(0, 3).map(c => `${c.name} ${usd(c.net)}`).join('; ')}`,
      `В минусе: ${sorted.filter(c => c.net < 0).map(c => `${c.name} ${usd(c.net)}`).join('; ') || 'нет'}`,
    ].join('\n')
  },
}

const salarySummary: AgentTool = {
  mode: 'read', perms: ['/cars', '/calendar', '/dashboard', '/reports'],
  def: {
    name: 'salary_summary',
    description: 'Зарплата работника за месяц по правилу простоев (< 14 дней простоя → $150, ≥ 14 → $75, весь месяц → $0) минус штрафы и вычеты.',
    input_schema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM, по умолчанию текущий' } } },
  },
  async run(ctx, input) {
    const period = monthOr(input.month, ctx.today)
    const total = new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0).getDate()
    const [carsRes, blocksRes, dedRes] = await Promise.all([
      ctx.db.from('cars').select('id, make, model, plate, delisted, removed_from'),
      ctx.db.from('car_blocks').select('car_id, start_date, end_date'),
      ctx.db.from('salary_deductions').select('date, reason, amount').gte('date', period).lte('date', `${period.slice(0, 8)}31`),
    ])
    const cars = ((carsRes.data || []) as { id: string; make: string; model: string; plate: string; delisted: boolean; removed_from: string | null }[]).filter(c => inFleet(c, period))
    const blocks = (blocksRes.data || []) as { car_id: string; start_date: string; end_date: string | null }[]
    const lines = cars.map(c => { const d = idleDaysInMonth(blocks.filter(b => b.car_id === c.id), period); return { c, d, pay: calcSalary(d, total) } })
    const sum = lines.reduce((s, l) => s + l.pay, 0)
    const deds = (dedRes.data || []) as { date: string; reason: string; amount: number }[]
    const dedSum = deds.reduce((s, d) => s + num(d.amount), 0)
    return [
      ...lines.filter(l => l.pay < 150).map(l => `${carLabel(l.c)}: простой ${l.d} дн. → ${usd(l.pay)}`),
      `Остальные ${lines.filter(l => l.pay === 150).length} машин → $150`,
      `По машинам: ${usd(sum)}`,
      ...deds.map(d => `Вычет ${d.date}: ${d.reason} −${usd(num(d.amount))}`),
      `К выплате: ${usd(sum - dedSum)}`,
    ].join('\n')
  },
}

export const READ_TOOLS = [listClaims, listExpenses, listDowntime, incomeSummary, salarySummary]

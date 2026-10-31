import { calcEntry, monthProfit, num, type RevenueEntry, type MonthExpenses, type OtherItem } from '../calc'
import { carLabel, carOf, money, monthOr, str, usd, type AgentTool, type FleetCar, type Input, type ToolCtx } from './tools'

// «Доходы»: ремонт и прочее по машине, затраты на сотрудника, расходы компании, платежи, аккаунты, история.
// Чтение — сразу, запись — через кнопку «Записать». Всё только с галочкой «Доходы».

const P = ['/income']
const ym = (period: string) => period.slice(0, 7)

// Запись «Доходов» машины, что числится в месяце
async function revenueCar(ctx: ToolCtx, carId: string, period: string) {
  const { data } = await ctx.db.from('revenue_cars').select('id, account, added_from, sold_from').eq('car_id', carId)
  return ((data || []) as { id: string; account: string; added_from: string; sold_from: string | null }[])
    .find(r => r.added_from <= period && (!r.sold_from || period < r.sold_from)) || null
}

type Entry = RevenueEntry & { other_items: OtherItem[] }
async function entryOf(ctx: ToolCtx, rcId: string, period: string): Promise<Entry> {
  const { data } = await ctx.db.from('revenue_entries').select('gross, repair, claim_items, other_items, payment').eq('revenue_car_id', rcId).eq('period', period).maybeSingle()
  const e = (data || { gross: 0, repair: 0, claim_items: [], other_items: [], payment: null }) as Entry
  return { ...e, claim_items: e.claim_items || [], other_items: e.other_items || [] }
}

// Изменить запись машины за месяц (как ячейки таблицы аккаунта) — остальное в записи не трогаем
async function patchEntry(ctx: ToolCtx, carId: string, period: string, change: (e: Entry) => Partial<Entry>) {
  const rc = await revenueCar(ctx, carId, period)
  if (!rc) return 'Ошибка: машина не привязана к «Доходам» в этом месяце'
  const patch = change(await entryOf(ctx, rc.id, period))
  const { error } = await ctx.db.from('revenue_entries').upsert({ revenue_car_id: rc.id, period, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'revenue_car_id,period' })
  if (error) return 'Ошибка: не сохранилось'
  await ctx.core.log('update', 'revenue_entry', rc.id, { period, ...patch })
  return 'Записано'
}

async function monthExp(ctx: ToolCtx, period: string): Promise<MonthExpenses & { period: string }> {
  const { data } = await ctx.db.from('revenue_month_expenses').select('salary1, salary2, items').eq('period', period).maybeSingle()
  return { period, salary1: num(data?.salary1), salary2: num(data?.salary2), items: (data?.items as OtherItem[] | null) || [] }
}
async function saveMonthExp(ctx: ToolCtx, m: MonthExpenses & { period: string }) {
  const { error } = await ctx.db.from('revenue_month_expenses').upsert({ ...m, updated_at: new Date().toISOString() }, { onConflict: 'period' })
  if (error) return 'Ошибка: не сохранилось'
  await ctx.core.log('update', 'revenue_month_expenses', m.period, { salary1: m.salary1, salary2: m.salary2, items: m.items })
  return 'Записано'
}

const carMonth = { car_id: { type: 'string' }, month: { type: 'string', description: 'YYYY-MM, по умолчанию текущий' } }
async function needCar(ctx: ToolCtx, input: Input): Promise<{ error: string } | { car: FleetCar }> {
  const car = carOf(ctx, input.car_id)
  if (!car) return { error: 'Такой машины нет в парке' }
  if (!await revenueCar(ctx, car.id, monthOr(input.month, ctx.today))) return { error: `${carLabel(car)} не привязана к «Доходам» в ${ym(monthOr(input.month, ctx.today))}` }
  return { car }
}

// ── Чтение ──

const incomeCar: AgentTool = {
  mode: 'read', perms: P,
  def: { name: 'income_car', description: 'Запись «Доходов» одной машины за месяц: Gross, клеймы, ремонт, прочие расходы (по пунктам), платёж, итог.', input_schema: { type: 'object', properties: carMonth, required: ['car_id'] } },
  async run(ctx, input) {
    const car = carOf(ctx, input.car_id)
    const period = monthOr(input.month, ctx.today)
    const rc = car ? await revenueCar(ctx, car.id, period) : null
    if (!car || !rc) return 'Машина не привязана к «Доходам» в этом месяце'
    const e = await entryOf(ctx, rc.id, period)
    const t = calcEntry(e)
    return [`${carLabel(car)} · ${ym(period)}`, `Gross ${usd(t.gross)}`, `Клеймы ${usd(t.claim)} · Supplement ${usd(t.supp)} (вычет ${usd(t.ded)})`, `Ремонт ${usd(t.repair)}`,
      `Прочее: ${e.other_items.length ? e.other_items.map(o => `${o.desc || '—'} ${usd(num(o.amount))}`).join('; ') : 'нет'}`, `Платёж ${e.payment == null ? 'не задан' : usd(num(e.payment))}`, `Итог ${usd(t.net)}`].join('\n')
  },
}

const monthCosts: AgentTool = {
  mode: 'read', perms: P,
  def: { name: 'month_costs', description: 'Расходы месяца в «Доходах»: затраты на сотрудника (расходы и зарплата), расходы компании по пунктам и платежи (payment_id) по группам.', input_schema: { type: 'object', properties: { month: { type: 'string' } } } },
  async run(ctx, input) {
    const period = monthOr(input.month, ctx.today)
    const m = await monthExp(ctx, period)
    const { data } = await ctx.db.from('revenue_payments').select('id, grp, day, name, amount').eq('period', period).order('grp').order('sort')
    const pays = (data || []) as { id: string; grp: string; day: number | null; name: string; amount: number }[]
    return [
      `${ym(period)}`, `Затраты на сотрудника: расходы ${usd(m.salary1)}, зарплата ${usd(m.salary2)}`,
      `Расходы компании: ${m.items?.length ? m.items.map(i => `${i.desc || '—'} ${usd(num(i.amount))}`).join('; ') : 'нет'}`,
      `Платежи (${pays.length}, ${usd(pays.reduce((s, p) => s + num(p.amount), 0))}):`,
      ...pays.map(p => `  payment_id ${p.id} · ${p.grp} · ${p.name || '—'} · ${usd(num(p.amount))}${p.day ? ` · ${p.day} число` : ''}`),
    ].join('\n')
  },
}

const incomeHistory: AgentTool = {
  mode: 'read', perms: P,
  def: { name: 'income_history', description: 'Чистая прибыль и Gross по месяцам за последние N месяцев (по умолчанию 6) — для сравнений и трендов.', input_schema: { type: 'object', properties: { months: { type: 'number' } } } },
  async run(ctx, input) {
    const n = Math.min(24, Math.max(1, Math.round(num(input.months) || 6)))
    const periods: string[] = []
    let p = `${ctx.today.slice(0, 8)}01`
    for (let i = 0; i < n; i++) { periods.unshift(p); const [y, m] = p.split('-').map(Number); p = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}-01` }
    const [entRes, expRes, payRes, dedRes] = await Promise.all([
      ctx.db.from('revenue_entries').select('period, gross, repair, claim_items, other_items, payment').gte('period', periods[0]),
      ctx.db.from('revenue_month_expenses').select('period, salary1, salary2, items').gte('period', periods[0]),
      ctx.db.from('revenue_payments').select('period, amount').gte('period', periods[0]),
      ctx.db.from('salary_deductions').select('date, amount').gte('date', periods[0]),
    ])
    const ents = (entRes.data || []) as (RevenueEntry & { period: string })[]
    return periods.map(per => {
      const e = ents.filter(x => x.period === per)
      if (!e.length) return `${ym(per)}: нет данных`
      const exp = ((expRes.data || []) as (MonthExpenses & { period: string })[]).find(x => x.period === per)
      const pays = ((payRes.data || []) as { period: string; amount: number }[]).filter(x => x.period === per)
      const ded = ((dedRes.data || []) as { date: string; amount: number }[]).filter(x => x.date.startsWith(ym(per))).reduce((s, d) => s + num(d.amount), 0)
      return `${ym(per)}: прибыль ${usd(monthProfit(e, exp, pays, ded))} · Gross ${usd(e.reduce((s, x) => s + num(x.gross), 0))}`
    }).join('\n')
  },
}

// ── Запись по машине ──

const setRepair: AgentTool = {
  mode: 'confirm', perms: P,
  def: { name: 'set_repair', description: 'Ремонт машины за месяц в «Доходах» (сумма заменяет прежнюю).', input_schema: { type: 'object', properties: { ...carMonth, amount: { type: 'number' } }, required: ['car_id', 'amount'] } },
  async prepare(ctx, input) {
    const c = await needCar(ctx, input)
    if ('error' in c) return { error: c.error }
    if (!(money(input.amount) >= 0)) return { error: 'Неверная сумма' }
    return { summary: `Ремонт ${carLabel(c.car)} за ${ym(monthOr(input.month, ctx.today))} — ${usd(money(input.amount))}` }
  },
  run: (ctx, input) => patchEntry(ctx, str(input.car_id), monthOr(input.month, ctx.today), () => ({ repair: money(input.amount) })),
}

const addCarOther: AgentTool = {
  mode: 'confirm', perms: P,
  def: { name: 'add_car_other', description: 'Прочий расход по машине в «Доходах» (пункт «Прочее»: страховка, штраф, парковка…) за месяц.', input_schema: { type: 'object', properties: { ...carMonth, desc: { type: 'string' }, amount: { type: 'number' } }, required: ['car_id', 'desc', 'amount'] } },
  async prepare(ctx, input) {
    const c = await needCar(ctx, input)
    if ('error' in c) return { error: c.error }
    if (!str(input.desc) || !(money(input.amount) > 0)) return { error: 'Нужны описание и сумма' }
    return { summary: `Прочее ${carLabel(c.car)} за ${ym(monthOr(input.month, ctx.today))}: ${str(input.desc)} ${usd(money(input.amount))}` }
  },
  run: (ctx, input) => patchEntry(ctx, str(input.car_id), monthOr(input.month, ctx.today), e => ({ other_items: [...e.other_items, { desc: str(input.desc), amount: money(input.amount) }] })),
}

const removeCarOther: AgentTool = {
  mode: 'confirm', perms: P,
  def: { name: 'remove_car_other', description: 'Убрать пункт «Прочее» машины за месяц (по описанию, как в income_car).', input_schema: { type: 'object', properties: { ...carMonth, desc: { type: 'string' } }, required: ['car_id', 'desc'] } },
  async prepare(ctx, input) {
    const c = await needCar(ctx, input)
    if ('error' in c) return { error: c.error }
    const rc = await revenueCar(ctx, c.car.id, monthOr(input.month, ctx.today))
    const e = await entryOf(ctx, rc!.id, monthOr(input.month, ctx.today))
    const item = e.other_items.find(o => (o.desc || '').toLowerCase() === str(input.desc).toLowerCase())
    return item ? { summary: `Убрать из «Прочего» ${carLabel(c.car)}: ${item.desc} ${usd(num(item.amount))}` } : { error: 'Такого пункта нет' }
  },
  run: (ctx, input) => patchEntry(ctx, str(input.car_id), monthOr(input.month, ctx.today), e => {
    const i = e.other_items.findIndex(o => (o.desc || '').toLowerCase() === str(input.desc).toLowerCase())
    return { other_items: e.other_items.filter((_, k) => k !== i) }
  }),
}

// ── Расходы месяца ──

const setStaffCosts: AgentTool = {
  mode: 'confirm', perms: P,
  def: { name: 'set_staff_costs', description: 'Затраты на сотрудника за месяц: expenses — «Расходы» (переведено сотруднику на расходы), salary — «Зарплата». Заменяет прежнее значение.', input_schema: { type: 'object', properties: { month: { type: 'string' }, expenses: { type: 'number' }, salary: { type: 'number' } } } },
  async prepare(ctx, input) {
    if (input.expenses === undefined && input.salary === undefined) return { error: 'Нужна сумма расходов или зарплаты' }
    if ([input.expenses, input.salary].some(v => v !== undefined && !(money(v) >= 0))) return { error: 'Неверная сумма' }
    return { summary: `Затраты на сотрудника за ${ym(monthOr(input.month, ctx.today))}: ${[input.expenses !== undefined ? `расходы ${usd(money(input.expenses))}` : '', input.salary !== undefined ? `зарплата ${usd(money(input.salary))}` : ''].filter(Boolean).join(', ')}` }
  },
  async run(ctx, input) {
    const m = await monthExp(ctx, monthOr(input.month, ctx.today))
    if (input.expenses !== undefined) m.salary1 = money(input.expenses)
    if (input.salary !== undefined) m.salary2 = money(input.salary)
    return saveMonthExp(ctx, m)
  },
}

const companyExpense = (remove: boolean): AgentTool => ({
  mode: 'confirm', perms: P,
  def: {
    name: remove ? 'remove_company_expense' : 'add_company_expense',
    description: remove ? 'Убрать пункт из «Расходов компании» за месяц (по описанию).' : 'Расход компании за месяц в «Доходах» (не по машине: офис, подписки, реклама…).',
    input_schema: { type: 'object', properties: { month: { type: 'string' }, desc: { type: 'string' }, ...(remove ? {} : { amount: { type: 'number' } }) }, required: remove ? ['desc'] : ['desc', 'amount'] },
  },
  async prepare(ctx, input) {
    const period = monthOr(input.month, ctx.today)
    if (!remove) return str(input.desc) && money(input.amount) > 0 ? { summary: `Расход компании за ${ym(period)}: ${str(input.desc)} ${usd(money(input.amount))}` } : { error: 'Нужны описание и сумма' }
    const item = (await monthExp(ctx, period)).items?.find(i => (i.desc || '').toLowerCase() === str(input.desc).toLowerCase())
    return item ? { summary: `Убрать расход компании за ${ym(period)}: ${item.desc} ${usd(num(item.amount))}` } : { error: 'Такого пункта нет' }
  },
  async run(ctx, input) {
    const m = await monthExp(ctx, monthOr(input.month, ctx.today))
    const items = m.items || []
    const i = items.findIndex(x => (x.desc || '').toLowerCase() === str(input.desc).toLowerCase())
    m.items = remove ? items.filter((_, k) => k !== i) : [...items, { desc: str(input.desc), amount: money(input.amount) }]
    return saveMonthExp(ctx, m)
  },
})

// ── Платежи (вкладка «Платежи») ──

const addPayment: AgentTool = {
  mode: 'confirm', perms: P,
  def: { name: 'add_payment', description: 'Общий платёж месяца (вкладка «Платежи»), не по конкретной машине. group — группа как в month_costs («Наши», «Миша», «Карам»…).', input_schema: { type: 'object', properties: { month: { type: 'string' }, group: { type: 'string' }, name: { type: 'string' }, amount: { type: 'number' }, day: { type: 'number' } }, required: ['group', 'name', 'amount'] } },
  async prepare(ctx, input) {
    if (!str(input.group) || !str(input.name) || !(money(input.amount) > 0)) return { error: 'Нужны группа, название и сумма' }
    return { summary: `Платёж за ${ym(monthOr(input.month, ctx.today))}: ${str(input.group)} · ${str(input.name)} ${usd(money(input.amount))}${input.day ? ` · ${input.day} число` : ''}` }
  },
  async run(ctx, input) {
    const period = monthOr(input.month, ctx.today)
    const { data: rows } = await ctx.db.from('revenue_payments').select('sort').eq('period', period)
    const sort = Math.max(0, ...((rows || []) as { sort: number }[]).map(r => r.sort)) + 1
    const row = { period, grp: str(input.group), name: str(input.name), amount: money(input.amount), day: input.day ? Math.round(num(input.day)) : null, sort }
    const { data, error } = await ctx.db.from('revenue_payments').insert(row).select('id').single()
    if (error || !data) return 'Ошибка: не сохранилось'
    await ctx.core.log('create', 'revenue_payment', data.id, row)
    return 'Платёж добавлен'
  },
}

async function paymentOf(ctx: ToolCtx, id: unknown) {
  const { data } = await ctx.db.from('revenue_payments').select('id, period, grp, name, amount').eq('id', str(id)).maybeSingle()
  return data as { id: string; period: string; grp: string; name: string; amount: number } | null
}

const updatePayment: AgentTool = {
  mode: 'confirm', perms: P,
  def: { name: 'update_payment', description: 'Изменить общий платёж: сумму, название, группу или число. payment_id — из month_costs.', input_schema: { type: 'object', properties: { payment_id: { type: 'string' }, amount: { type: 'number' }, name: { type: 'string' }, group: { type: 'string' }, day: { type: 'number' } }, required: ['payment_id'] } },
  async prepare(ctx, input) {
    const p = await paymentOf(ctx, input.payment_id)
    if (!p) return { error: 'Платёж не найден' }
    if (input.amount !== undefined && !(money(input.amount) >= 0)) return { error: 'Неверная сумма' }
    return { summary: `Платёж ${p.grp} · ${p.name || '—'} ${usd(num(p.amount))} (${ym(p.period)}) → ${[input.amount !== undefined ? usd(money(input.amount)) : '', str(input.name), str(input.group), input.day ? `${input.day} число` : ''].filter(Boolean).join(', ')}` }
  },
  async run(ctx, input) {
    const patch: Input = {}
    if (input.amount !== undefined) patch.amount = money(input.amount)
    if (str(input.name)) patch.name = str(input.name)
    if (str(input.group)) patch.grp = str(input.group)
    if (input.day) patch.day = Math.round(num(input.day))
    const { error } = await ctx.db.from('revenue_payments').update(patch).eq('id', str(input.payment_id))
    if (error) return 'Ошибка: не сохранилось'
    await ctx.core.log('update', 'revenue_payment', str(input.payment_id), patch)
    return 'Платёж изменён'
  },
}

const deletePayment: AgentTool = {
  mode: 'confirm', perms: P,
  def: { name: 'delete_payment', description: 'Удалить общий платёж. payment_id — из month_costs.', input_schema: { type: 'object', properties: { payment_id: { type: 'string' } }, required: ['payment_id'] } },
  async prepare(ctx, input) {
    const p = await paymentOf(ctx, input.payment_id)
    return p ? { summary: `Удалить платёж ${p.grp} · ${p.name || '—'} ${usd(num(p.amount))} (${ym(p.period)})` } : { error: 'Платёж не найден' }
  },
  async run(ctx, input) {
    const { error } = await ctx.db.from('revenue_payments').delete().eq('id', str(input.payment_id))
    if (error) return 'Ошибка: не удалилось'
    await ctx.core.log('delete', 'revenue_payment', str(input.payment_id), {})
    return 'Платёж удалён'
  },
}

// ── Аккаунты ──

const addCarToAccount: AgentTool = {
  mode: 'confirm', perms: P,
  def: { name: 'add_car_to_account', description: 'Добавить машину парка в аккаунт «Доходов» (Миша, Адилет, Радвизон, Анастасия…) с месяца from_month. Если машина сейчас в другом аккаунте — там она уйдёт с этого месяца.', input_schema: { type: 'object', properties: { car_id: { type: 'string' }, account: { type: 'string', description: 'Имя аккаунта' }, from_month: { type: 'string', description: 'YYYY-MM, по умолчанию текущий' } }, required: ['car_id', 'account'] } },
  async prepare(ctx, input) {
    const car = carOf(ctx, input.car_id)
    if (!car) return { error: 'Такой машины нет в парке' }
    const acc = await accountOf(ctx, input.account)
    if (!acc) return { error: 'Такого аккаунта нет' }
    const from = monthOr(input.from_month, ctx.today)
    const cur = await revenueCar(ctx, car.id, from)
    if (cur?.account === acc.key) return { error: `${carLabel(car)} уже в аккаунте ${acc.label}` }
    return { summary: `${carLabel(car)} → аккаунт ${acc.label} с ${ym(from)}${cur ? ' (из прежнего аккаунта уйдёт с этого месяца)' : ''}` }
  },
  async run(ctx, input) {
    const car = carOf(ctx, input.car_id)
    const acc = await accountOf(ctx, input.account)
    if (!car || !acc) return 'Ошибка: машина или аккаунт не найдены'
    const from = monthOr(input.from_month, ctx.today)
    const cur = await revenueCar(ctx, car.id, from)
    if (cur) {
      // Прежняя запись: с этого месяца её нет; если она начиналась с этого же месяца — просто переносим в новый аккаунт
      const { error } = cur.added_from >= from
        ? await ctx.db.from('revenue_cars').update({ account: acc.key }).eq('id', cur.id)
        : await ctx.db.from('revenue_cars').update({ sold_from: from }).eq('id', cur.id)
      if (error) return 'Ошибка: не сохранилось'
      if (cur.added_from >= from) { await ctx.core.log('update', 'revenue_car', cur.id, { account: acc.key }); return 'Машина перенесена' }
    }
    const { data: rows } = await ctx.db.from('revenue_cars').select('sort').eq('account', acc.key)
    const sort = Math.max(-1, ...((rows || []) as { sort: number }[]).map(r => r.sort)) + 1
    const { data, error } = await ctx.db.from('revenue_cars').insert({ account: acc.key, name: carLabel(car), car_id: car.id, added_from: from, sort }).select('id').single()
    if (error || !data) return 'Ошибка: не сохранилось'
    await ctx.core.log('create', 'revenue_car', data.id, { account: acc.key, from })
    return 'Машина добавлена в аккаунт'
  },
}

async function accountOf(ctx: ToolCtx, v: unknown) {
  const { data } = await ctx.db.from('revenue_accounts').select('key, label, active_until')
  const q = str(v).toLowerCase()
  return ((data || []) as { key: string; label: string; active_until: string | null }[]).find(a => a.label.toLowerCase() === q || a.key.toLowerCase() === q || a.label.toLowerCase().startsWith(q)) || null
}

export const INCOME_TOOLS = [incomeCar, monthCosts, incomeHistory, setRepair, addCarOther, removeCarOther, setStaffCosts, companyExpense(false), companyExpense(true), addPayment, updatePayment, deletePayment, addCarToAccount]

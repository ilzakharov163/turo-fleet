import { putIdle, endIdle, blocksOn, completeClaim, claimBlockOn, recordClaimPayment, removeCarFrom, canAny } from '../core'
import { carLabel, carOf, dateOr, isDate, money, monthOr, optStr, str, usd, type AgentTool, type ToolCtx, type Input } from './tools'

// Инструменты, которые меняют данные. add_expense пишет сразу (кнопка «Отменить»), остальные — после «Записать».

const nextMonth = (period: string) => { const [y, m] = period.split('-').map(Number); return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01` }
const ru = (d: string) => d.split('-').reverse().join('.')

type ClaimRow = { id: string; car_id: string | null; claim_number: string | null; description: string | null; status: string; initial_period: string | null; supplement_period: string | null }
async function claimOf(ctx: ToolCtx, id: unknown): Promise<ClaimRow | null> {
  if (!str(id)) return null
  const { data } = await ctx.db.from('claims').select('id, car_id, claim_number, description, status, initial_period, supplement_period').eq('id', str(id)).maybeSingle()
  return (data as ClaimRow | null) || null
}
const claimName = (ctx: ToolCtx, c: ClaimRow) => { const car = carOf(ctx, c.car_id); return `клейм № ${c.claim_number || '—'}${car ? ` (${carLabel(car)})` : ''}` }

const addExpense: AgentTool = {
  mode: 'instant', perms: ['/expenses'],
  def: {
    name: 'add_expense',
    description: 'Записать расход. Пишется сразу, человек может нажать «Отменить». Если к сообщению приложено фото чека — attach_receipt: true (чек прикрепится). Сумму бери из чека, если он есть; если сумма в подписи не совпадает с чеком — сначала спроси, не вызывай.',
    input_schema: {
      type: 'object',
      properties: {
        car_id: { type: 'string', description: 'id машины из списка парка; пусто — расход без машины' },
        title: { type: 'string', description: 'Статья: по возможности одна из уже используемых (Жетоны для мойки, Такси, Заказы/Покупки, Ремонт, Смог чек, Выезд из парковки LAX, Заправка) или короткое название, например «Установка GPS»' },
        amount: { type: 'number' },
        date: { type: 'string', description: 'YYYY-MM-DD, по умолчанию сегодня (или дата из чека)' },
        notes: { type: 'string' },
        attach_receipt: { type: 'boolean' },
      },
      required: ['title', 'amount'],
    },
  },
  async run(ctx, input) {
    const amount = money(input.amount)
    const title = str(input.title)
    if (!title || !(amount > 0)) return 'Ошибка: нужна статья и сумма больше нуля'
    const car = str(input.car_id) ? carOf(ctx, input.car_id) : null
    if (str(input.car_id) && !car) return 'Ошибка: такой машины нет в парке'
    const files: string[] = []
    if (input.attach_receipt) {
      if (!ctx.photo) return 'Ошибка: в этом сообщении нет фото чека'
      const ext = ctx.photo.mime === 'image/png' ? 'png' : 'jpg'
      const path = `${ctx.actor.userId}/${Date.now()}_telegram.${ext}`
      const { error } = await ctx.db.storage.from('receipts').upload(path, ctx.photo.bytes, { contentType: ctx.photo.mime })
      if (error) return 'Ошибка: чек не загрузился, расход не записан'
      files.push(path)
    }
    const date = dateOr(input.date, ctx.today)
    const { data, error } = await ctx.db.from('expenses').insert({
      car_id: car?.id || null, title, amount, date, notes: optStr(input.notes), files, created_by: ctx.actor.userId, updated_at: new Date().toISOString(),
    }).select('id').single()
    if (error || !data) { if (files.length) await ctx.db.storage.from('receipts').remove(files); return 'Ошибка: расход не записался' }
    await ctx.core.log('create', 'expense', data.id, { title, amount })
    const label = `${car ? carLabel(car) : 'без машины'} · ${title} · ${usd(amount)} · ${ru(date)}${files.length ? ' · чек прикреплён' : ''}`
    ctx.undo.push({ kind: 'expense', id: data.id, label })
    return `Записано: ${label}`
  },
}

// ── Простои ──

const putIdleTool: AgentTool = {
  mode: 'confirm', perms: ['/cars', '/calendar'],
  def: {
    name: 'put_idle',
    description: 'Снять машину с листинга / поставить в простой. По клейму (claim_number: создастся клейм «Ожидает ремонта», или снимется по уже открытому клейму этой машины) или по другой причине (other_reason).',
    input_schema: {
      type: 'object',
      properties: {
        car_id: { type: 'string' }, date: { type: 'string', description: 'С какого числа, YYYY-MM-DD, по умолчанию сегодня' },
        end_date: { type: 'string', description: 'По какое число, если известно' },
        claim_number: { type: 'string' }, description: { type: 'string', description: 'Коротко, что случилось' },
        other_reason: { type: 'string' },
      },
      required: ['car_id'],
    },
  },
  async prepare(ctx, input) {
    const car = carOf(ctx, input.car_id)
    if (!car) return { error: 'Такой машины нет в парке' }
    const num = str(input.claim_number)
    if (num && !canAny(ctx.actor, ['/claims'])) return { error: 'Нет доступа к клеймам' }
    if (!num && !str(input.other_reason)) return { error: 'Нужен номер клейма или причина' }
    if (input.end_date && !isDate(input.end_date)) return { error: 'Дата «по» в формате YYYY-MM-DD' }
    const date = dateOr(input.date, ctx.today)
    return { summary: `${carLabel(car)} — в простой с ${ru(date)}${isDate(input.end_date) ? ` по ${ru(input.end_date)}` : ''}, ${num ? `клейм № ${num}${str(input.description) ? ` — ${str(input.description)}` : ''}` : str(input.other_reason)}` }
  },
  async run(ctx, input) {
    const date = dateOr(input.date, ctx.today)
    const already = (await blocksOn(ctx.db, str(input.car_id), date)).length > 0
    const res = await putIdle(ctx.core, {
      carId: str(input.car_id), date, endDate: isDate(input.end_date) ? input.end_date : null, alreadyIdle: already,
      claimNumber: optStr(input.claim_number), description: optStr(input.description), otherReason: optStr(input.other_reason),
    })
    return res.ok ? res.text : `Ошибка: ${res.text}`
  },
}

const returnToWork: AgentTool = {
  mode: 'confirm', perms: ['/cars', '/calendar'],
  def: {
    name: 'return_to_work',
    description: 'Вернуть машину в работу: текущий простой заканчивается накануне даты. Если машина в простое по клейму и ремонт закончен — лучше complete_claim с return_car.',
    input_schema: { type: 'object', properties: { car_id: { type: 'string' }, date: { type: 'string', description: 'С какого числа в работе, по умолчанию сегодня' } }, required: ['car_id'] },
  },
  async prepare(ctx, input) {
    const car = carOf(ctx, input.car_id)
    if (!car) return { error: 'Такой машины нет в парке' }
    const date = dateOr(input.date, ctx.today)
    if (!(await blocksOn(ctx.db, car.id, date)).length) return { error: `${carLabel(car)} на ${ru(date)} не в простое` }
    return { summary: `${carLabel(car)} — в работе с ${ru(date)}` }
  },
  async run(ctx, input) {
    const date = dateOr(input.date, ctx.today)
    const block = (await blocksOn(ctx.db, str(input.car_id), date))[0]
    if (!block) return 'Машина уже не в простое'
    return await endIdle(ctx.core, { carId: str(input.car_id), block, date, details: { via: 'telegram' } }) ? 'Машина в работе' : 'Ошибка: не сохранилось'
  },
}

// ── Клеймы ──

const addClaim: AgentTool = {
  mode: 'confirm', perms: ['/claims'],
  def: {
    name: 'add_claim',
    description: 'Новый клейм, машина ОСТАЁТСЯ в листинге (катается до ремонта). Если машину снимают — используй put_idle с claim_number.',
    input_schema: { type: 'object', properties: { car_id: { type: 'string' }, claim_number: { type: 'string' }, description: { type: 'string' }, opened_date: { type: 'string' } }, required: ['car_id', 'claim_number'] },
  },
  async prepare(ctx, input) {
    const car = carOf(ctx, input.car_id)
    if (!car) return { error: 'Такой машины нет в парке' }
    const num = str(input.claim_number)
    if (!num) return { error: 'Нужен номер клейма' }
    const { data } = await ctx.db.from('claims').select('id').ilike('claim_number', num.replace(/[%_\\]/g, m => `\\${m}`)).limit(1)
    if (data?.length) return { error: `Клейм № ${num} уже есть` }
    return { summary: `Новый клейм № ${num} — ${carLabel(car)}${str(input.description) ? `, ${str(input.description)}` : ''}, машина остаётся в листинге` }
  },
  async run(ctx, input) {
    const { data, error } = await ctx.db.from('claims').insert({
      car_id: str(input.car_id), claim_number: str(input.claim_number), description: optStr(input.description),
      status: 'waiting', opened_date: dateOr(input.opened_date, ctx.today), still_listed: true,
    }).select('id').single()
    if (error || !data) return 'Ошибка: не сохранилось'
    await ctx.core.log('create', 'claim', data.id, { car_id: str(input.car_id), claim_number: str(input.claim_number) })
    return 'Клейм создан'
  },
}

const updateClaim: AgentTool = {
  mode: 'confirm', perms: ['/claims'],
  def: {
    name: 'update_claim',
    description: 'Изменить клейм: статус (waiting — ожидает ремонта, in_repair — в ремонте), описание или заметку. Для завершения — complete_claim.',
    input_schema: { type: 'object', properties: { claim_id: { type: 'string' }, status: { type: 'string', enum: ['waiting', 'in_repair'] }, description: { type: 'string' }, notes: { type: 'string' } }, required: ['claim_id'] },
  },
  async prepare(ctx, input) {
    const c = await claimOf(ctx, input.claim_id)
    if (!c) return { error: 'Клейм не найден' }
    const parts = [input.status ? `статус «${input.status === 'in_repair' ? 'В ремонте' : 'Ожидает ремонта'}»` : '', str(input.description) ? `описание «${str(input.description)}»` : '', str(input.notes) ? `заметка «${str(input.notes)}»` : ''].filter(Boolean)
    if (!parts.length) return { error: 'Нечего менять' }
    return { summary: `${claimName(ctx, c)}: ${parts.join(', ')}` }
  },
  async run(ctx, input) {
    const update: Input = {}
    if (input.status === 'waiting' || input.status === 'in_repair') update.status = input.status
    if (str(input.description)) update.description = str(input.description)
    if (str(input.notes)) update.notes = str(input.notes)
    const { error } = await ctx.db.from('claims').update(update).eq('id', str(input.claim_id))
    if (error) return 'Ошибка: не сохранилось'
    await ctx.core.log('update', 'claim', str(input.claim_id), update)
    return 'Клейм обновлён'
  },
}

const completeClaimTool: AgentTool = {
  mode: 'confirm', perms: ['/claims'],
  def: {
    name: 'complete_claim',
    description: 'Завершить клейм (ремонт закончен). return_car: true — вернуть машину в работу с этой даты (закрыть простой по клейму).',
    input_schema: { type: 'object', properties: { claim_id: { type: 'string' }, date: { type: 'string' }, return_car: { type: 'boolean' } }, required: ['claim_id'] },
  },
  async prepare(ctx, input) {
    const c = await claimOf(ctx, input.claim_id)
    if (!c) return { error: 'Клейм не найден' }
    if (c.status === 'done') return { error: 'Клейм уже завершён' }
    const date = dateOr(input.date, ctx.today)
    const back = input.return_car !== false && !!(await claimBlockOn(ctx.db, c, date))
    if (back && !canAny(ctx.actor, ['/cars', '/calendar'])) return { error: 'Нет доступа к простоям — вернуть машину нельзя' }
    return { summary: `Завершить ${claimName(ctx, c)} ${ru(date)}${back ? ', машина в работе с этого дня' : ''}` }
  },
  async run(ctx, input) {
    const c = await claimOf(ctx, input.claim_id)
    if (!c) return 'Клейм не найден'
    const res = await completeClaim(ctx.core, { claim: c, date: dateOr(input.date, ctx.today), back: input.return_car !== false })
    return res === false ? 'Ошибка: не сохранилось' : res === 'back' ? 'Клейм завершён, машина в работе' : 'Клейм завершён'
  },
}

const claimPayment: AgentTool = {
  mode: 'confirm', perms: ['/claims'],
  def: {
    name: 'claim_payment',
    description: 'Пришла выплата по клейму: kind initial или supplement, сумма в $. У supplement вычет Turo pct (по умолчанию 20 = 20%). Сумма записывается в клейм и в «Доходы» машины за месяц month (по умолчанию текущий).',
    input_schema: { type: 'object', properties: { claim_id: { type: 'string' }, kind: { type: 'string', enum: ['initial', 'supplement'] }, amount: { type: 'number' }, pct: { type: 'number', description: 'Проценты, 0–100' }, month: { type: 'string', description: 'YYYY-MM' } }, required: ['claim_id', 'kind', 'amount'] },
  },
  async prepare(ctx, input) {
    const c = await claimOf(ctx, input.claim_id)
    if (!c) return { error: 'Клейм не найден' }
    const amount = money(input.amount)
    if (!(amount > 0)) return { error: 'Нужна сумма больше нуля' }
    if (input.kind !== 'initial' && input.kind !== 'supplement') return { error: 'kind: initial или supplement' }
    const pct = input.kind === 'supplement' ? Math.min(100, Math.max(0, input.pct === undefined ? 20 : money(input.pct))) : 0
    const toIncome = canAny(ctx.actor, ['/income'])
    return { summary: `${input.kind === 'initial' ? 'Initial' : 'Supplement'} ${usd(amount)}${input.kind === 'supplement' ? ` (вычет Turo ${pct}%)` : ''} — ${claimName(ctx, c)}${toIncome ? `, в «Доходы» за ${monthOr(input.month, ctx.today).slice(0, 7)}` : ''}` }
  },
  async run(ctx, input) {
    const c = await claimOf(ctx, input.claim_id)
    if (!c) return 'Клейм не найден'
    const kind = input.kind === 'supplement' ? 'supplement' : 'initial'
    const pct = kind === 'supplement' ? Math.min(100, Math.max(0, input.pct === undefined ? 20 : money(input.pct))) / 100 : 0
    const err = await recordClaimPayment(ctx.core, { claim: c, kind, amount: money(input.amount), pct, period: monthOr(input.month, ctx.today), canIncome: canAny(ctx.actor, ['/income']) })
    return err ? `Ошибка: ${err}` : 'Выплата записана'
  },
}

// ── Зарплата, доходы, расходы, парк ──

const addDeduction: AgentTool = {
  mode: 'confirm', perms: ['/cars'],
  def: {
    name: 'add_deduction',
    description: 'Штраф или вычет из зарплаты работника за месяц.',
    input_schema: { type: 'object', properties: { reason: { type: 'string' }, amount: { type: 'number' }, date: { type: 'string' } }, required: ['reason', 'amount'] },
  },
  async prepare(ctx, input) {
    const amount = money(input.amount)
    if (!str(input.reason) || !(amount > 0)) return { error: 'Нужна причина и сумма' }
    return { summary: `Вычет из зарплаты ${usd(amount)} — ${str(input.reason)} (${ru(dateOr(input.date, ctx.today))})` }
  },
  async run(ctx, input) {
    const { data, error } = await ctx.db.from('salary_deductions').insert({ date: dateOr(input.date, ctx.today), reason: str(input.reason), amount: money(input.amount), created_by: ctx.actor.userId }).select('id').single()
    if (error || !data) return 'Ошибка: не сохранилось'
    await ctx.core.log('create', 'salary_deduction', data.id, { reason: str(input.reason), amount: money(input.amount) })
    return 'Вычет записан'
  },
}

// Запись «Доходов» машины, что числится в месяце
async function revenueCarId(ctx: ToolCtx, carId: string, period: string) {
  const { data } = await ctx.db.from('revenue_cars').select('id, added_from, sold_from').eq('car_id', carId)
  return ((data || []) as { id: string; added_from: string; sold_from: string | null }[]).find(r => r.added_from <= period && (!r.sold_from || period < r.sold_from))?.id || null
}

const setRevenue = (field: 'gross' | 'payment', what: string): AgentTool => ({
  mode: 'confirm', perms: ['/income'],
  def: {
    name: field === 'gross' ? 'set_gross' : 'set_car_payment',
    description: field === 'gross'
      ? 'Внести Gross за месяц (сколько машина заработала на Turo) — одной или сразу нескольким машинам. Заменяет прежнее значение.'
      : 'Ежемесячный платёж за машину (кредит/лизинг), если его платим мы; 0 — платежа нет. Заменяет прежнее значение.',
    input_schema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'YYYY-MM, по умолчанию текущий' },
        items: { type: 'array', items: { type: 'object', properties: { car_id: { type: 'string' }, amount: { type: 'number' } }, required: ['car_id', 'amount'] } },
      },
      required: ['items'],
    },
  },
  async prepare(ctx, input) {
    const period = monthOr(input.month, ctx.today)
    const items = Array.isArray(input.items) ? input.items as Input[] : []
    if (!items.length) return { error: 'Нет машин' }
    const lines: string[] = []
    for (const it of items) {
      const car = carOf(ctx, it.car_id)
      if (!car) return { error: 'Одной из машин нет в парке' }
      if (!(money(it.amount) >= 0)) return { error: `Неверная сумма у ${carLabel(car)}` }
      if (!await revenueCarId(ctx, car.id, period)) return { error: `${carLabel(car)} не привязана к «Доходам» в ${period.slice(0, 7)}` }
      lines.push(`${carLabel(car)} — ${usd(money(it.amount))}`)
    }
    return { summary: `${what} за ${period.slice(0, 7)}:\n${lines.join('\n')}` }
  },
  async run(ctx, input) {
    const period = monthOr(input.month, ctx.today)
    let ok = 0
    for (const it of (input.items as Input[])) {
      const rc = await revenueCarId(ctx, str(it.car_id), period)
      if (!rc) continue
      const { error } = await ctx.db.from('revenue_entries').upsert({ revenue_car_id: rc, period, [field]: money(it.amount), updated_at: new Date().toISOString() }, { onConflict: 'revenue_car_id,period' })
      if (error) continue
      await ctx.core.log('update', 'revenue_entry', rc, { period, [field]: money(it.amount) })
      ok++
    }
    return `${what}: записано ${ok} из ${(input.items as Input[]).length}`
  },
})

const setExpensePaid: AgentTool = {
  mode: 'confirm', perms: ['/expenses'],
  def: {
    name: 'set_expense_paid',
    description: 'Отметить расходы оплаченными (или снять отметку). expense_id бери из list_expenses.',
    input_schema: { type: 'object', properties: { expense_ids: { type: 'array', items: { type: 'string' } }, paid: { type: 'boolean' } }, required: ['expense_ids', 'paid'] },
  },
  async prepare(ctx, input) {
    const ids = Array.isArray(input.expense_ids) ? input.expense_ids.map(String) : []
    const { data } = await ctx.db.from('expenses').select('id, amount').in('id', ids)
    if (!data?.length) return { error: 'Расходы не найдены' }
    return { summary: `${input.paid ? 'Оплачено' : 'Не оплачено'}: ${data.length} расход(ов) на ${usd(data.reduce((s, e) => s + Number(e.amount), 0))}` }
  },
  async run(ctx, input) {
    const ids = (input.expense_ids as unknown[]).map(String)
    const { error } = await ctx.db.from('expenses').update({ paid: !!input.paid }).in('id', ids)
    if (error) return 'Ошибка: не сохранилось'
    await ctx.core.log('update', 'expense', ids.join(','), { paid: !!input.paid })
    return 'Готово'
  },
}

const deleteExpense: AgentTool = {
  mode: 'confirm', perms: ['/expenses'],
  def: { name: 'delete_expense', description: 'Удалить расход (вместе с фото чека).', input_schema: { type: 'object', properties: { expense_id: { type: 'string' } }, required: ['expense_id'] } },
  async prepare(ctx, input) {
    const { data } = await ctx.db.from('expenses').select('title, amount, date').eq('id', str(input.expense_id)).maybeSingle()
    if (!data) return { error: 'Расход не найден' }
    return { summary: `Удалить расход: ${data.title} · ${usd(Number(data.amount))} · ${ru(data.date)}` }
  },
  async run(ctx, input) {
    const { data } = await ctx.db.from('expenses').select('id, title, amount, files').eq('id', str(input.expense_id)).maybeSingle()
    if (!data) return 'Расход не найден'
    const { error } = await ctx.db.from('expenses').delete().eq('id', data.id)
    if (error) return 'Ошибка: не удалилось'
    if (data.files?.length) await ctx.db.storage.from('receipts').remove(data.files)
    await ctx.core.log('delete', 'expense', data.id, { title: data.title, amount: data.amount })
    return 'Расход удалён'
  },
}

const removeCar: AgentTool = {
  mode: 'confirm', perms: ['/cars', '/income'],
  def: { name: 'remove_car', description: 'Машина продана или разбита — убрать из парка и «Доходов» со следующего месяца (в текущем считается как обычно).', input_schema: { type: 'object', properties: { car_id: { type: 'string' } }, required: ['car_id'] } },
  async prepare(ctx, input) {
    const car = carOf(ctx, input.car_id)
    if (!car) return { error: 'Такой машины нет в парке' }
    return { summary: `${carLabel(car)} — продана/разбита, убрать с ${nextMonth(`${ctx.today.slice(0, 8)}01`).slice(0, 7)}` }
  },
  async run(ctx, input) {
    const ok = await removeCarFrom(ctx.core, { carId: str(input.car_id), from: nextMonth(`${ctx.today.slice(0, 8)}01`), canFleet: canAny(ctx.actor, ['/cars']), canIncome: canAny(ctx.actor, ['/income']) })
    return ok ? 'Машина убрана со следующего месяца' : 'Ошибка: не сохранилось'
  },
}

export const WRITE_TOOLS = [
  addExpense, putIdleTool, returnToWork, addClaim, updateClaim, completeClaimTool, claimPayment,
  addDeduction, setRevenue('gross', 'Gross'), setRevenue('payment', 'Платёж за машину'), setExpensePaid, deleteExpense, removeCar,
]

import { dropClaimPayment, recordStickerChange, restoreCar, latinPlate, hasCyrillic, canAny } from '../core'
import { carLabel, carOf, dateOr, isDate, money, str, usd, type AgentTool, type Input } from './tools'

// Остальные действия «Авто» и «Расходов»: машины, наклейки, правка простоев, клеймов, расходов и вычетов.
// Всё — через кнопку «Записать».

const ru = (d: string) => d.split('-').reverse().join('.')
const plateOf = (v: unknown) => latinPlate(str(v)).replace(/\s+/g, '')

// ── Машины ──

const addCar: AgentTool = {
  mode: 'confirm', perms: ['/cars'],
  def: {
    name: 'add_car',
    description: 'Добавить новую машину в парк (Авто → Машины). Номер латиницей.',
    input_schema: { type: 'object', properties: { make: { type: 'string' }, model: { type: 'string' }, plate: { type: 'string' } }, required: ['make', 'model', 'plate'] },
  },
  async prepare(ctx, input) {
    const plate = plateOf(input.plate)
    if (!str(input.make) || !str(input.model) || !plate) return { error: 'Нужны марка, модель и номер' }
    if (hasCyrillic(plate)) return { error: 'В номере русские буквы — нужен номер латиницей' }
    const { data } = await ctx.db.from('cars').select('id').eq('plate', plate).limit(1)
    if (data?.length) return { error: `Машина с номером ${plate} уже есть` }
    return { summary: `Новая машина: ${str(input.make)} ${str(input.model)} ${plate}` }
  },
  async run(ctx, input) {
    const row = { make: str(input.make), model: str(input.model), plate: plateOf(input.plate), owner_group: 'main' }
    const { data, error } = await ctx.db.from('cars').insert(row).select('id').single()
    if (error || !data) return 'Ошибка: не сохранилось'
    await ctx.core.log('create', 'car', data.id, row)
    return 'Машина добавлена'
  },
}

const updateCar: AgentTool = {
  mode: 'confirm', perms: ['/cars'],
  def: {
    name: 'update_car',
    description: 'Исправить марку, модель или номер машины (опечатка). Если номер меняется вместе с наклейкой — используй replace_sticker.',
    input_schema: { type: 'object', properties: { car_id: { type: 'string' }, make: { type: 'string' }, model: { type: 'string' }, plate: { type: 'string' } }, required: ['car_id'] },
  },
  async prepare(ctx, input) {
    const car = carOf(ctx, input.car_id)
    if (!car) return { error: 'Такой машины нет в парке' }
    const plate = str(input.plate) ? plateOf(input.plate) : ''
    if (plate && hasCyrillic(plate)) return { error: 'В номере русские буквы — нужен номер латиницей' }
    const next = { make: str(input.make) || car.make, model: str(input.model) || car.model, plate: plate || car.plate }
    if (next.make === car.make && next.model === car.model && next.plate === car.plate) return { error: 'Нечего менять' }
    return { summary: `${carLabel(car)} → ${carLabel(next)}` }
  },
  async run(ctx, input) {
    const car = carOf(ctx, input.car_id)
    if (!car) return 'Ошибка: машины нет'
    const next = { make: str(input.make) || car.make, model: str(input.model) || car.model, plate: str(input.plate) ? plateOf(input.plate) : car.plate }
    const { error } = await ctx.db.from('cars').update({ ...next, updated_at: new Date().toISOString() }).eq('id', car.id)
    if (error) return 'Ошибка: не сохранилось'
    await ctx.core.log('update', 'car', car.id, { old: { make: car.make, model: car.model, plate: car.plate }, new: next })
    return 'Машина изменена'
  },
}

const listRemovedCars: AgentTool = {
  mode: 'read', perms: ['/cars', '/income'],
  def: { name: 'list_removed_cars', description: 'Проданные / разбитые / убранные машины (их нет в списке парка) — с car_id, чтобы вернуть.', input_schema: { type: 'object', properties: {} } },
  async run(ctx) {
    const { data } = await ctx.db.from('cars').select('id, make, model, plate, removed_from, delisted').or('removed_from.not.is.null,delisted.eq.true')
    const rows = (data || []) as { id: string; make: string; model: string; plate: string; removed_from: string | null }[]
    return rows.length ? rows.map(c => `car_id ${c.id} · ${carLabel(c)} · ${c.removed_from ? `убрана с ${c.removed_from.slice(0, 7)}` : 'снята с листинга (старое)'}`).join('\n') : 'Убранных машин нет'
  },
}

const restoreCarTool: AgentTool = {
  mode: 'confirm', perms: ['/cars', '/income'],
  def: { name: 'restore_car', description: 'Вернуть убранную (проданную/разбитую) машину в парк и «Доходы». car_id — из list_removed_cars.', input_schema: { type: 'object', properties: { car_id: { type: 'string' } }, required: ['car_id'] } },
  async prepare(ctx, input) {
    const { data } = await ctx.db.from('cars').select('make, model, plate, removed_from').eq('id', str(input.car_id)).maybeSingle()
    if (!data?.removed_from) return { error: 'Эта машина не убрана' }
    return { summary: `Вернуть ${carLabel(data)} в парк` }
  },
  async run(ctx, input) {
    const { data } = await ctx.db.from('cars').select('removed_from').eq('id', str(input.car_id)).maybeSingle()
    const ok = await restoreCar(ctx.core, { carId: str(input.car_id), from: data?.removed_from || null, canFleet: canAny(ctx.actor, ['/cars']), canIncome: canAny(ctx.actor, ['/income']) })
    return ok ? 'Машина возвращена' : 'Ошибка: не сохранилось'
  },
}

// ── Наклейки ──

const stickersStatus: AgentTool = {
  mode: 'read', perms: ['/stickers', '/dashboard'],
  def: { name: 'stickers_status', description: 'Наклейки: у каких машин когда была последняя замена и когда следующая (каждые 45 дней).', input_schema: { type: 'object', properties: {} } },
  async run(ctx) {
    const [carsRes, chRes] = await Promise.all([
      ctx.db.from('sticker_cars').select('car_id'),
      ctx.db.from('sticker_changes').select('car_id, changed_date').order('changed_date', { ascending: false }),
    ])
    const changes = (chRes.data || []) as { car_id: string; changed_date: string }[]
    const rows = ((carsRes.data || []) as { car_id: string }[]).map(({ car_id }) => {
      const last = changes.find(c => c.car_id === car_id)?.changed_date || null
      const due = last ? new Date(Date.parse(`${last}T12:00:00Z`) + 45 * 86400_000).toISOString().slice(0, 10) : null
      const car = carOf(ctx, car_id)
      return { name: car ? carLabel(car) : car_id, last, due }
    }).sort((a, b) => (a.due || '').localeCompare(b.due || ''))
    if (!rows.length) return 'Машин в разделе «Наклейки» нет'
    return rows.map(r => `${r.name} · последняя замена ${r.last ? ru(r.last) : 'не записана'}${r.due ? ` · следующая ${ru(r.due)}${r.due <= ctx.today ? ' (просрочено)' : ''}` : ''}`).join('\n')
  },
}

const replaceSticker: AgentTool = {
  mode: 'confirm', perms: ['/stickers'],
  def: {
    name: 'replace_sticker',
    description: 'Замена наклейки (раз в 45 дней). Если выдали новый номер — new_plate, он сразу заменит номер машины везде.',
    input_schema: { type: 'object', properties: { car_id: { type: 'string' }, date: { type: 'string' }, new_plate: { type: 'string' } }, required: ['car_id'] },
  },
  async prepare(ctx, input) {
    const car = carOf(ctx, input.car_id)
    if (!car) return { error: 'Такой машины нет в парке' }
    const plate = str(input.new_plate) ? plateOf(input.new_plate) : ''
    if (plate && hasCyrillic(plate)) return { error: 'В номере русские буквы — нужен номер латиницей' }
    const { data } = await ctx.db.from('sticker_cars').select('id').eq('car_id', car.id).limit(1)
    if (!data?.length) return { error: `${carLabel(car)} нет в разделе «Наклейки»` }
    return { summary: `Замена наклейки ${carLabel(car)} ${ru(dateOr(input.date, ctx.today))}${plate && plate !== car.plate ? `, новый номер ${plate}` : ''}` }
  },
  async run(ctx, input) {
    const car = carOf(ctx, input.car_id)
    if (!car) return 'Ошибка: машины нет'
    const ok = await recordStickerChange(ctx.core, { carId: car.id, date: dateOr(input.date, ctx.today), oldPlate: car.plate, plate: str(input.new_plate) ? plateOf(input.new_plate) : null, source: 'telegram' })
    return ok ? 'Замена записана' : 'Ошибка: не сохранилось'
  },
}

// ── Простои: правка и удаление (id — из list_downtime) ──

type BlockRow = { id: string; car_id: string; start_date: string; end_date: string | null; reason: string | null }
async function blockOf(ctx: Parameters<AgentTool['run']>[0], id: unknown): Promise<BlockRow | null> {
  const { data } = await ctx.db.from('car_blocks').select('id, car_id, start_date, end_date, reason').eq('id', str(id)).maybeSingle()
  return (data as BlockRow | null) || null
}
const blockName = (ctx: Parameters<AgentTool['run']>[0], b: BlockRow) => { const c = carOf(ctx, b.car_id); return `простой ${c ? carLabel(c) : ''} с ${ru(b.start_date)} по ${b.end_date ? ru(b.end_date) : '…'}` }

const updateDowntime: AgentTool = {
  mode: 'confirm', perms: ['/cars', '/calendar'],
  def: {
    name: 'update_downtime',
    description: 'Исправить простой: даты или причину. end_date "" — бессрочно (до возврата). block_id — из list_downtime.',
    input_schema: { type: 'object', properties: { block_id: { type: 'string' }, start_date: { type: 'string' }, end_date: { type: 'string' }, reason: { type: 'string' } }, required: ['block_id'] },
  },
  async prepare(ctx, input) {
    const b = await blockOf(ctx, input.block_id)
    if (!b) return { error: 'Простой не найден' }
    const start = isDate(input.start_date) ? input.start_date : b.start_date
    const end = input.end_date === '' ? null : isDate(input.end_date) ? input.end_date : b.end_date
    if (end && end < start) return { error: 'Дата «по» раньше даты «с»' }
    return { summary: `Исправить ${blockName(ctx, b)} → с ${ru(start)} по ${end ? ru(end) : '…'}${str(input.reason) ? `, причина «${str(input.reason)}»` : ''}` }
  },
  async run(ctx, input) {
    const b = await blockOf(ctx, input.block_id)
    if (!b) return 'Простой не найден'
    const update = {
      start_date: isDate(input.start_date) ? input.start_date : b.start_date,
      end_date: input.end_date === '' ? null : isDate(input.end_date) ? input.end_date : b.end_date,
      reason: str(input.reason) || b.reason,
    }
    const { error } = await ctx.db.from('car_blocks').update(update).eq('id', b.id)
    if (error) return 'Ошибка: не сохранилось'
    await ctx.core.log('update', 'car_block', b.id, update)
    return 'Простой исправлен'
  },
}

const deleteDowntime: AgentTool = {
  mode: 'confirm', perms: ['/cars', '/calendar'],
  def: { name: 'delete_downtime', description: 'Удалить простой целиком (поставили по ошибке). block_id — из list_downtime.', input_schema: { type: 'object', properties: { block_id: { type: 'string' } }, required: ['block_id'] } },
  async prepare(ctx, input) {
    const b = await blockOf(ctx, input.block_id)
    return b ? { summary: `Удалить ${blockName(ctx, b)}` } : { error: 'Простой не найден' }
  },
  async run(ctx, input) {
    const b = await blockOf(ctx, input.block_id)
    if (!b) return 'Простой не найден'
    const { error } = await ctx.db.from('car_blocks').delete().eq('id', b.id)
    if (error) return 'Ошибка: не удалилось'
    await ctx.core.log('delete', 'car_block', b.id, { car_id: b.car_id, start_date: b.start_date, end_date: b.end_date, reason: b.reason })
    return 'Простой удалён'
  },
}

// ── Клеймы: удалить, снять выплату ──

const deleteClaim: AgentTool = {
  mode: 'confirm', perms: ['/claims'],
  def: { name: 'delete_claim', description: 'Удалить клейм (создан по ошибке). Суммы Initial/Supplement из «Доходов» тоже уберутся.', input_schema: { type: 'object', properties: { claim_id: { type: 'string' } }, required: ['claim_id'] } },
  async prepare(ctx, input) {
    const { data } = await ctx.db.from('claims').select('claim_number, car_id').eq('id', str(input.claim_id)).maybeSingle()
    if (!data) return { error: 'Клейм не найден' }
    const car = carOf(ctx, data.car_id)
    return { summary: `Удалить клейм № ${data.claim_number || '—'}${car ? ` (${carLabel(car)})` : ''}` }
  },
  async run(ctx, input) {
    const { data: c } = await ctx.db.from('claims').select('id, car_id, initial_period, supplement_period').eq('id', str(input.claim_id)).maybeSingle()
    if (!c) return 'Клейм не найден'
    if (canAny(ctx.actor, ['/income'])) {
      await dropClaimPayment(ctx.core, { claimId: c.id, carId: c.car_id, kind: 'initial', period: c.initial_period })
      await dropClaimPayment(ctx.core, { claimId: c.id, carId: c.car_id, kind: 'supplement', period: c.supplement_period })
    }
    const { error } = await ctx.db.from('claims').delete().eq('id', c.id)
    if (error) return 'Ошибка: не удалилось'
    await ctx.core.log('delete', 'claim', c.id, { car_id: c.car_id })
    return 'Клейм удалён'
  },
}

const undoClaimPayment: AgentTool = {
  mode: 'confirm', perms: ['/claims'],
  def: { name: 'undo_claim_payment', description: 'Снять отметку Initial или Supplement (внесли по ошибке): сумма уберётся из клейма и из «Доходов».', input_schema: { type: 'object', properties: { claim_id: { type: 'string' }, kind: { type: 'string', enum: ['initial', 'supplement'] } }, required: ['claim_id', 'kind'] } },
  async prepare(ctx, input) {
    const { data } = await ctx.db.from('claims').select('claim_number, initial_amount, supplement_amount').eq('id', str(input.claim_id)).maybeSingle()
    if (!data) return { error: 'Клейм не найден' }
    const amount = input.kind === 'initial' ? data.initial_amount : data.supplement_amount
    return { summary: `Снять ${input.kind === 'initial' ? 'Initial' : 'Supplement'}${amount ? ` ${usd(Number(amount))}` : ''} у клейма № ${data.claim_number || '—'}` }
  },
  async run(ctx, input) {
    const kind = input.kind === 'supplement' ? 'supplement' : 'initial'
    const { data: c } = await ctx.db.from('claims').select('id, car_id, initial_period, supplement_period').eq('id', str(input.claim_id)).maybeSingle()
    if (!c) return 'Клейм не найден'
    if (canAny(ctx.actor, ['/income'])) await dropClaimPayment(ctx.core, { claimId: c.id, carId: c.car_id, kind, period: kind === 'initial' ? c.initial_period : c.supplement_period })
    const update = kind === 'initial'
      ? { initial_payment_received: false, initial_amount: null, initial_period: null }
      : { supplement_paid: false, supplement_amount: null, supplement_pct: null, supplement_period: null }
    const { error } = await ctx.db.from('claims').update(update).eq('id', c.id)
    if (error) return 'Ошибка: не сохранилось'
    await ctx.core.log('update', 'claim', c.id, update)
    return 'Отметка снята'
  },
}

// ── Расходы и вычеты: правка ──

const updateExpense: AgentTool = {
  mode: 'confirm', perms: ['/expenses'], managersOnly: true,
  def: {
    name: 'update_expense',
    description: 'Исправить расход: машину, статью, сумму, дату или заметку. expense_id — из list_expenses. car_id "" — без машины.',
    input_schema: { type: 'object', properties: { expense_id: { type: 'string' }, car_id: { type: 'string' }, title: { type: 'string' }, amount: { type: 'number' }, date: { type: 'string' }, notes: { type: 'string' } }, required: ['expense_id'] },
  },
  async prepare(ctx, input) {
    const { data: e } = await ctx.db.from('expenses').select('title, amount, date, car_id').eq('id', str(input.expense_id)).maybeSingle()
    if (!e) return { error: 'Расход не найден' }
    if (str(input.car_id) && !carOf(ctx, input.car_id)) return { error: 'Такой машины нет в парке' }
    if (input.amount !== undefined && !(money(input.amount) > 0)) return { error: 'Сумма должна быть больше нуля' }
    const parts = [
      input.car_id !== undefined ? `машина: ${str(input.car_id) ? carLabel(carOf(ctx, input.car_id)!) : 'без машины'}` : '',
      str(input.title) ? `статья «${str(input.title)}»` : '', input.amount !== undefined ? `сумма ${usd(money(input.amount))}` : '',
      isDate(input.date) ? `дата ${ru(input.date)}` : '', str(input.notes) ? `заметка «${str(input.notes)}»` : '',
    ].filter(Boolean)
    if (!parts.length) return { error: 'Нечего менять' }
    return { summary: `Расход «${e.title}» ${usd(Number(e.amount))} от ${ru(e.date)}: ${parts.join(', ')}` }
  },
  async run(ctx, input) {
    const update: Input = { updated_at: new Date().toISOString() }
    if (input.car_id !== undefined) update.car_id = str(input.car_id) || null
    if (str(input.title)) update.title = str(input.title)
    if (input.amount !== undefined) update.amount = money(input.amount)
    if (isDate(input.date)) update.date = input.date
    if (str(input.notes)) update.notes = str(input.notes)
    const { error } = await ctx.db.from('expenses').update(update).eq('id', str(input.expense_id))
    if (error) return 'Ошибка: не сохранилось'
    await ctx.core.log('update', 'expense', str(input.expense_id), update)
    return 'Расход исправлен'
  },
}

const deleteDeduction: AgentTool = {
  mode: 'confirm', perms: ['/cars'],
  def: { name: 'delete_deduction', description: 'Удалить штраф/вычет из зарплаты. deduction_id — из salary_summary.', input_schema: { type: 'object', properties: { deduction_id: { type: 'string' } }, required: ['deduction_id'] } },
  async prepare(ctx, input) {
    const { data } = await ctx.db.from('salary_deductions').select('reason, amount, date').eq('id', str(input.deduction_id)).maybeSingle()
    return data ? { summary: `Удалить вычет ${usd(Number(data.amount))} — ${data.reason} (${ru(data.date)})` } : { error: 'Вычет не найден' }
  },
  async run(ctx, input) {
    const { error } = await ctx.db.from('salary_deductions').delete().eq('id', str(input.deduction_id))
    if (error) return 'Ошибка: не удалилось'
    await ctx.core.log('delete', 'salary_deduction', str(input.deduction_id), {})
    return 'Вычет удалён'
  },
}

export const FLEET_TOOLS = [addCar, updateCar, listRemovedCars, restoreCarTool, stickersStatus, replaceSticker, updateDowntime, deleteDowntime, deleteClaim, undoClaimPayment, updateExpense, deleteDeduction]

// Общие действия приложения — их вызывают и сайт (через lib/unlist, lib/claimIncome, lib/fleet),
// и агенты (Telegram-бот на сервере). Сюда передаются база (db) и запись в «Историю» (log),
// поэтому один и тот же код работает и в браузере, и на сервере.
// Без импортов кода (только типы) — чтобы проверять тестами (lib/core.test.ts).

import type { SupabaseClient } from '@supabase/supabase-js'

export type LogFn = (action: string, entityType: string, entityId: string, details?: Record<string, unknown>) => Promise<void>
export interface Ctx { db: SupabaseClient; log: LogFn }

// Запись в «Историю» от имени конкретного человека (для сервера, где нет входа через браузер)
export function logAs(db: SupabaseClient, user: { id: string; email: string }, via?: string): LogFn {
  return async (action, entityType, entityId, details = {}) => {
    await db.from('activity_log').insert({
      user_id: user.id, user_email: user.email, action, entity_type: entityType, entity_id: entityId,
      details: via ? { ...details, via } : details,
    })
  }
}

// ── Права (те же правила, что can_any в базе) ──
// admin — всё; не-админ без галочек — только /expenses; старая галочка «Календарь» = простои во вкладке «Авто».
export interface Access { role: string; perms: string[] }

export function accessFrom(role: string | null | undefined, permissions: string[] | null | undefined): Access {
  const r = role ?? 'employee'
  let perms = permissions ?? []
  if (r !== 'admin' && perms.length === 0) perms = ['/expenses']
  if (perms.includes('/calendar') && !perms.includes('/cars')) perms = [...perms, '/cars']
  return { role: r, perms }
}

export function canAny(access: Access | null, keys: string[]) {
  if (!access) return false
  if (access.role === 'admin' || keys.length === 0) return true
  return keys.some(k => access.perms.includes(k))
}

// ── Номера машин ──
// Русские буквы, похожие на латинские (номер могли набрать в русской раскладке)
const LOOKALIKE: Record<string, string> = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X' }
// Номер для сравнения: заглавные, без пробелов и дефисов, русские «двойники» → латиница
export const normPlate = (s: string | null | undefined) =>
  (s || '').toUpperCase().replace(/[\s-]/g, '').replace(/[АВЕКМНОРСТУХ]/g, ch => LOOKALIKE[ch] || ch)
// Номер при вводе: заглавные, русские буквы-двойники сразу в латиницу (527АКР1 → 527AKP1)
export const latinPlate = (s: string) => s.toUpperCase().replace(/[АВЕКМНОРСТУХ]/g, ch => LOOKALIKE[ch] || ch)
// Остались русские буквы без латинского двойника (Д, Б, Ж…) — такой номер не сохраняем
export const hasCyrillic = (s: string) => /[А-ЯЁ]/i.test(s)

// Предыдущий день: '2026-10-30' → '2026-10-29'
export function dayBefore(date: string) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

const claimReason = (num: string | null, desc: string | null) =>
  `Клейм${num ? ` № ${num}` : ''}${desc ? ` — ${desc}` : ''}`

// ── Простои ──

export interface Block { id: string; start_date: string; end_date: string | null; reason: string | null }

// Простои машины, в которые попадает дата
export async function blocksOn(db: SupabaseClient, carId: string, date: string): Promise<Block[]> {
  const { data } = await db.from('car_blocks').select('id, start_date, end_date, reason').eq('car_id', carId)
    .lte('start_date', date).or(`end_date.is.null,end_date.gte.${date}`)
  return (data || []) as Block[]
}

// Вернуть в работу с даты date: простой заканчивается накануне (начался в тот же день или позже — простоя не было, удаляем).
// details — что дописать в «Историю». Возвращает true, если всё записалось.
export async function endIdle(ctx: Ctx, opts: { carId: string; block: Pick<Block, 'id' | 'start_date'>; date: string; details?: Record<string, unknown> }) {
  const { db } = ctx
  const removed = opts.block.start_date >= opts.date
  const end = dayBefore(opts.date)
  const { error } = removed
    ? await db.from('car_blocks').delete().eq('id', opts.block.id)
    : await db.from('car_blocks').update({ end_date: end }).eq('id', opts.block.id)
  if (error) return false
  await db.from('cars').update({ status: 'active', inactive_reason: null, updated_at: new Date().toISOString() }).eq('id', opts.carId)
  await ctx.log('status_change', 'car', opts.carId, { status: 'active', block_id: opts.block.id, end_date: removed ? null : end, ...opts.details })
  return true
}

// ── Клеймы ──

// Снять машину с листинга по клейму: простой с даты (причина «Клейм № … — описание»),
// у клейма still_listed=false. Если машина на эту дату уже в простое — новый простой не создаётся.
export async function unlistByClaim(ctx: Ctx, opts: {
  carId: string; claimId: string; claimNumber: string | null; description: string | null
  date: string; endDate?: string | null
}): Promise<boolean> {
  const { db } = ctx
  const { data: cur } = await db.from('car_blocks').select('id').eq('car_id', opts.carId)
    .lte('start_date', opts.date).or(`end_date.is.null,end_date.gte.${opts.date}`).limit(1)
  if (!cur?.length) {
    const reason = claimReason(opts.claimNumber, opts.description)
    const { data, error } = await db.from('car_blocks')
      .insert({ car_id: opts.carId, start_date: opts.date, end_date: opts.endDate || null, reason }).select('id').single()
    if (error) return false
    await ctx.log('create', 'car_block', data?.id || '', { car_id: opts.carId, start_date: opts.date, end_date: opts.endDate || null, reason, from_claim: opts.claimId })
  }
  const { error } = await db.from('claims').update({ still_listed: false }).eq('id', opts.claimId)
  if (error) return false
  await ctx.log('update', 'claim', opts.claimId, { still_listed: false, unlisted_from: opts.date })
  return true
}

// «В простой»: по клейму (новый клейм «Ожидает ремонта» или уже открытый клейм этой машины) или по другой причине.
// alreadyIdle — машина на эту дату уже в простое (новый простой не нужен).
// Возвращает { ok, text } — text для сообщения: что сделано или почему нельзя.
export async function putIdle(ctx: Ctx, opts: {
  carId: string; date: string; endDate?: string | null; alreadyIdle?: boolean
  claimNumber?: string | null; description?: string | null; otherReason?: string | null
}): Promise<{ ok: boolean; text: string }> {
  const { db } = ctx
  const num = (opts.claimNumber || '').trim()
  const desc = (opts.description || '').trim()
  const end = opts.endDate || null

  if (num) {
    // Такой номер уже есть? Открытый клейм этой же машины (она каталась с клеймом) — снимаем по нему
    const { data: dup } = await db.from('claims').select('id, car_id, status, description, claim_number')
      .ilike('claim_number', num.replace(/[%_\\]/g, m => `\\${m}`)).limit(1)
    const ex = dup?.[0] as { id: string; car_id: string | null; status: string; description: string | null; claim_number: string | null } | undefined
    if (ex && (ex.car_id !== opts.carId || ex.status === 'done'))
      return { ok: false, text: ex.car_id !== opts.carId ? `Клейм № ${num} уже есть у другой машины` : `Клейм № ${num} уже завершён` }
    if (ex) {
      const ok = await unlistByClaim(ctx, { carId: opts.carId, claimId: ex.id, claimNumber: ex.claim_number || num, description: desc || ex.description, date: opts.date, endDate: end })
      if (desc && !ex.description) await db.from('claims').update({ description: desc }).eq('id', ex.id)
      return { ok, text: ok ? `Машина в простое по клейму № ${ex.claim_number || num}` : 'Не сохранилось' }
    }
    const { data, error } = await db.from('claims').insert({
      car_id: opts.carId, status: 'waiting', opened_date: opts.date, claim_number: num, description: desc || null, still_listed: false,
    }).select('id').single()
    if (error) return { ok: false, text: 'Не сохранилось' }
    await ctx.log('create', 'claim', data?.id || '', { car_id: opts.carId, claim_number: num, opened_date: opts.date, from: 'unlist' })
  } else if (!(opts.otherReason || '').trim()) {
    return { ok: false, text: 'Нужен номер клейма или причина' }
  }

  if (!opts.alreadyIdle) {
    const reason = num ? claimReason(num, desc || null) : opts.otherReason!.trim()
    const { data, error } = await db.from('car_blocks').insert({ car_id: opts.carId, start_date: opts.date, end_date: end, reason }).select('id').single()
    if (error) return { ok: false, text: 'Не сохранилось' }
    await ctx.log('create', 'car_block', data?.id || '', { car_id: opts.carId, start_date: opts.date, end_date: end, reason })
  }
  return { ok: true, text: num ? `В простое, клейм № ${num} создан` : 'Машина в простое' }
}

// Простой машины на дату по клейму: сначала тот, где в причине номер этого клейма
export async function claimBlockOn(db: SupabaseClient, c: { car_id: string | null; claim_number: string | null }, date: string): Promise<Block | null> {
  if (!c.car_id) return null
  const list = await blocksOn(db, c.car_id, date)
  const num = c.claim_number?.trim().toLowerCase()
  return list.find(b => num && (b.reason || '').toLowerCase().includes(num)) || list[0] || null
}

// «Завершить» клейм: done + дата; back — вернуть машину в работу с этой даты (если на дату есть простой).
// block — простой, найденный заранее (окно на сайте его показывает); undefined — найти здесь.
// Возвращает: false — не сохранилось; 'back' — завершён и машина в работе; 'done' — только завершён.
export async function completeClaim(ctx: Ctx, opts: {
  claim: { id: string; car_id: string | null; claim_number: string | null }; date: string; back: boolean; block?: Block | null
}): Promise<false | 'back' | 'done'> {
  const { claim: c, date, back } = opts
  const block = opts.block !== undefined ? opts.block : back ? await claimBlockOn(ctx.db, c, date) : null
  const update = { status: 'done' as const, completed_date: date, ...(back && block ? { still_listed: true } : {}) }
  const { error } = await ctx.db.from('claims').update(update).eq('id', c.id)
  if (error) return false
  await ctx.log('update', 'claim', c.id, update)
  if (!(back && block && c.car_id)) return 'done'
  return await endIdle(ctx, { carId: c.car_id, block, date, details: { from_claim: c.id } }) ? 'back' : 'done'
}

// ── Наклейки ──
// Замена наклейки: запись в sticker_changes; новый номер (если другой) сразу пишется в карточку авто — подтянется везде.
// plate — уже в латинице (latinPlate). Возвращает true, если всё записалось.
export async function recordStickerChange(ctx: Ctx, opts: { carId: string; date: string; oldPlate: string | null; plate: string | null; source?: string }) {
  const changed = !!opts.plate && opts.plate !== opts.oldPlate
  if (changed) {
    const { error } = await ctx.db.from('cars').update({ plate: opts.plate }).eq('id', opts.carId)
    if (error) return false
    await ctx.log('update', 'car', opts.carId, { plate_from: opts.oldPlate, plate_to: opts.plate, source: opts.source || 'stickers' })
  }
  const payload = { car_id: opts.carId, changed_date: opts.date, old_plate: opts.oldPlate, new_plate: changed ? opts.plate : opts.oldPlate }
  const { data, error } = await ctx.db.from('sticker_changes').insert(payload).select('id').single()
  if (error) return false
  await ctx.log('create', 'sticker_change', data?.id || '', payload)
  return true
}

// ── Клеймы → Доходы ──
// Сумма Initial / Supplement из клейма записывается строкой клейма (claim_items) в запись «Доходов» машины
// за выбранный месяц. Один клейм = одна строка (claim_id): Initial идёт в колонку claim, Supplement — в supplement + pct.
// Повторный ввод заменяет сумму, снятие обнуляет её (строка без сумм удаляется).

export type ClaimKind = 'initial' | 'supplement'
export interface ClaimItemRow { claim: number; supplement: number; pct: number; claim_id?: string }

interface RevCar { id: string; account: string; added_from: string; sold_from: string | null }

// Запись «Доходов» этой машины, которая числится в этом месяце (period = 'yyyy-MM-01')
async function revenueCarFor(db: SupabaseClient, carId: string, period: string): Promise<RevCar | null> {
  const { data } = await db.from('revenue_cars').select('id, account, added_from, sold_from').eq('car_id', carId)
  const list = (data || []) as RevCar[]
  return list.find(c => c.added_from <= period && (!c.sold_from || period < c.sold_from)) || list.find(c => c.added_from <= period) || null
}

async function writeItems(db: SupabaseClient, revenueCarId: string, period: string, change: (items: ClaimItemRow[]) => ClaimItemRow[]) {
  const { data: cur } = await db.from('revenue_entries').select('id, claim_items').eq('revenue_car_id', revenueCarId).eq('period', period).maybeSingle()
  const items = change(((cur?.claim_items as ClaimItemRow[]) || []).map(i => ({ ...i })))
  if (cur) {
    const { error } = await db.from('revenue_entries').update({ claim_items: items, updated_at: new Date().toISOString() }).eq('id', cur.id)
    return !error
  }
  if (!items.length) return true
  const { error } = await db.from('revenue_entries').insert({ revenue_car_id: revenueCarId, period, claim_items: items })
  return !error
}

// Поставить сумму Initial или Supplement в строку этого клейма (0 — убрать)
export function setPart(items: ClaimItemRow[], claimId: string, kind: ClaimKind, amount: number, pct: number) {
  const idx = items.findIndex(i => i.claim_id === claimId)
  const row: ClaimItemRow = idx >= 0 ? items[idx] : { claim: 0, supplement: 0, pct: 0, claim_id: claimId }
  if (kind === 'initial') row.claim = amount
  else { row.supplement = amount; row.pct = amount ? pct : 0 }
  if (idx < 0 && amount) items.push(row)
  return items.filter(i => i.claim || i.supplement)
}

// Записать сумму клейма в «Доходы». Возвращает текст ошибки или null.
export async function putClaimPayment(ctx: Ctx, opts: {
  claimId: string; carId: string | null; kind: ClaimKind; amount: number; pct?: number; period: string
  prevPeriod?: string | null   // если сумма раньше была в другом месяце — убрать её оттуда
}): Promise<string | null> {
  const { db } = ctx
  if (!opts.carId) return 'У клейма не выбрана машина'
  const rc = await revenueCarFor(db, opts.carId, opts.period)
  if (!rc) return 'Эта машина не привязана к «Доходам» в этом месяце'
  if (opts.prevPeriod && opts.prevPeriod !== opts.period) {
    const prevRc = await revenueCarFor(db, opts.carId, opts.prevPeriod)
    if (prevRc) await writeItems(db, prevRc.id, opts.prevPeriod, items => setPart(items, opts.claimId, opts.kind, 0, 0))
  }
  const ok = await writeItems(db, rc.id, opts.period, items => setPart(items, opts.claimId, opts.kind, opts.amount, opts.pct ?? 0.2))
  if (!ok) return 'Не удалось записать в «Доходы»'
  await ctx.log('update', 'revenue_entry', rc.id, { period: opts.period, from_claim: opts.claimId, kind: opts.kind, amount: opts.amount })
  return null
}

// Initial / Supplement получен: сумма и месяц в клейме + (если есть доступ к «Доходам») строка в «Доходах».
// Возвращает текст ошибки или null.
export async function recordClaimPayment(ctx: Ctx, opts: {
  claim: { id: string; car_id: string | null; initial_period: string | null; supplement_period: string | null }
  kind: ClaimKind; amount: number; pct: number; period: string; canIncome: boolean
}): Promise<string | null> {
  const { claim: c, kind, amount, pct, period } = opts
  if (opts.canIncome) {
    const err = await putClaimPayment(ctx, { claimId: c.id, carId: c.car_id, kind, amount, pct, period, prevPeriod: kind === 'initial' ? c.initial_period : c.supplement_period })
    if (err) return err
  }
  const update = kind === 'initial'
    ? { initial_payment_received: true, initial_amount: amount, initial_period: period }
    : { supplement_paid: true, supplement_amount: amount, supplement_pct: pct, supplement_period: period }
  const { error } = await ctx.db.from('claims').update(update).eq('id', c.id)
  if (error) return 'Не сохранилось'
  await ctx.log('update', 'claim', c.id, update)
  return null
}

// Убрать сумму клейма из «Доходов»
export async function dropClaimPayment(ctx: Ctx, opts: { claimId: string; carId: string | null; kind: ClaimKind; period: string | null }) {
  if (!opts.carId || !opts.period) return true
  const rc = await revenueCarFor(ctx.db, opts.carId, opts.period)
  if (!rc) return true
  return writeItems(ctx.db, rc.id, opts.period, items => setPart(items, opts.claimId, opts.kind, 0, 0))
}

// ── Парк: «Продана или разбита» ──
// Машина уходит со следующего месяца сразу везде — из парка (cars.removed_from → списки, счётчики, зарплата)
// и из «Доходов» (revenue_cars.sold_from). В текущем месяце остаётся как обычно. canFleet / canIncome — есть ли права на эти разделы.

export async function removeCarFrom(ctx: Ctx, opts: { carId: string | null; revenueCarId?: string | null; from: string; canFleet: boolean; canIncome: boolean }) {
  const { db } = ctx
  if (opts.carId && opts.canFleet) {
    const { error } = await db.from('cars').update({ removed_from: opts.from, updated_at: new Date().toISOString() }).eq('id', opts.carId)
    if (error) return false
    await ctx.log('update', 'car', opts.carId, { removed_from: opts.from })
  }
  if (opts.canIncome) {
    // Все записи «Доходов», привязанные к этой машине, плюс та, из которой нажали (даже если не привязана)
    let q = db.from('revenue_cars').update({ sold_from: opts.from }).is('sold_from', null)
    q = opts.carId && opts.revenueCarId ? q.or(`car_id.eq.${opts.carId},id.eq.${opts.revenueCarId}`)
      : opts.carId ? q.eq('car_id', opts.carId) : q.eq('id', opts.revenueCarId!)
    const { error } = await q
    if (error) return false
    if (opts.revenueCarId) await ctx.log('update', 'revenue_car', opts.revenueCarId, { sold_from: opts.from })
  }
  return true
}

// Вернуть машину: снимаем отметку и в парке, и в «Доходах» (только те записи, что были убраны тем же месяцем)
export async function restoreCar(ctx: Ctx, opts: { carId: string | null; revenueCarId?: string | null; from: string | null; canFleet: boolean; canIncome: boolean }) {
  const { db } = ctx
  if (opts.carId && opts.canFleet) {
    const { error } = await db.from('cars').update({ removed_from: null, updated_at: new Date().toISOString() }).eq('id', opts.carId)
    if (error) return false
    await ctx.log('update', 'car', opts.carId, { removed_from: null })
  }
  if (opts.canIncome && opts.from) {
    let q = db.from('revenue_cars').update({ sold_from: null }).eq('sold_from', opts.from)
    q = opts.carId && opts.revenueCarId ? q.or(`car_id.eq.${opts.carId},id.eq.${opts.revenueCarId}`)
      : opts.carId ? q.eq('car_id', opts.carId) : q.eq('id', opts.revenueCarId!)
    const { error } = await q
    if (error) return false
  }
  return true
}

// Проверка общих действий (lib/core.ts) на базе в памяти: npm test
/* eslint-disable @typescript-eslint/no-explicit-any -- поддельная база: строки и запросы без типов */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accessFrom, canAny, recordClaimPayment, dayBefore, putIdle, unlistByClaim, completeClaim, endIdle, putClaimPayment, dropClaimPayment, removeCarFrom, restoreCar, type Ctx } from './core.ts'

type Row = Record<string, any>

// Мини-копия запросов Supabase — только то, что используется в core.ts
function fakeDb(tables: Record<string, Row[]>) {
  let n = 0
  const from = (name: string) => {
    tables[name] ||= []
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
    let payload: Row | null = null
    let one: 'single' | 'maybe' | null = null
    let max = Infinity
    const conds: ((r: Row) => boolean)[] = []
    const cond = (col: string, o: string, v: string): ((r: Row) => boolean) =>
      o === 'is' ? r => r[col] == null : o === 'eq' ? r => String(r[col]) === v : o === 'gte' ? r => r[col] >= v : () => false
    const run = () => {
      const t = tables[name]
      let rows: Row[]
      if (op === 'insert') { rows = [{ id: `${name}-${++n}`, ...payload }]; t.push(...rows) }
      else {
        rows = t.filter(r => conds.every(c => c(r))).slice(0, max)
        if (op === 'update') rows.forEach(r => Object.assign(r, payload))
        if (op === 'delete') tables[name] = t.filter(r => !rows.includes(r))
      }
      const data = one ? rows[0] ?? null : rows
      return { data, error: one === 'single' && !rows.length ? { message: 'none' } : null }
    }
    const q: any = {
      select: () => q,
      insert: (p: Row) => { op = 'insert'; payload = p; return q },
      update: (p: Row) => { op = 'update'; payload = p; return q },
      delete: () => { op = 'delete'; return q },
      eq: (c: string, v: unknown) => { conds.push(r => r[c] === v); return q },
      is: (c: string) => { conds.push(r => r[c] == null); return q },
      lte: (c: string, v: string) => { conds.push(r => r[c] <= v); return q },
      ilike: (c: string, v: string) => { const x = v.replace(/\\(.)/g, '$1').toLowerCase(); conds.push(r => String(r[c] ?? '').toLowerCase() === x); return q },
      or: (s: string) => {
        const parts = s.split(',').map(p => { const [col, o, ...v] = p.split('.'); return cond(col, o, v.join('.')) })
        conds.push(r => parts.some(p => p(r))); return q
      },
      limit: (k: number) => { max = k; return q },
      single: () => { one = 'single'; return q },
      maybeSingle: () => { one = 'maybe'; return q },
      then: (ok: (v: unknown) => void, bad: (e: unknown) => void) => Promise.resolve().then(run).then(ok, bad),
    }
    return q
  }
  return { from } as any
}

function setup(tables: Record<string, Row[]>) {
  const logs: { action: string; entity: string; details?: Record<string, unknown> }[] = []
  const ctx: Ctx = { db: fakeDb(tables), log: async (action, entity, _id, details) => { logs.push({ action, entity, details }) } }
  return { ctx, logs, tables }
}

test('предыдущий день, в том числе через месяц и год', () => {
  assert.equal(dayBefore('2026-10-30'), '2026-10-29')
  assert.equal(dayBefore('2026-11-01'), '2026-10-31')
  assert.equal(dayBefore('2026-01-01'), '2025-12-31')
  assert.equal(dayBefore('2028-03-01'), '2028-02-29')
})

test('в простой по новому клейму: клейм «Ожидает ремонта» + простой с причиной', async () => {
  const { ctx, tables } = setup({ claims: [], car_blocks: [] })
  const res = await putIdle(ctx, { carId: 'car1', date: '2026-10-30', claimNumber: ' 1110455 ', description: 'бампер' })
  assert.deepEqual(res, { ok: true, text: 'В простое, клейм № 1110455 создан' })
  assert.equal(tables.claims.length, 1)
  assert.equal(tables.claims[0].status, 'waiting')
  assert.equal(tables.claims[0].still_listed, false)
  assert.equal(tables.car_blocks[0].reason, 'Клейм № 1110455 — бампер')
  assert.equal(tables.car_blocks[0].start_date, '2026-10-30')
})

test('в простой: машина уже в простое — новый простой не создаётся', async () => {
  const { ctx, tables } = setup({ claims: [], car_blocks: [] })
  await putIdle(ctx, { carId: 'car1', date: '2026-10-30', claimNumber: '1', alreadyIdle: true })
  assert.equal(tables.claims.length, 1)
  assert.equal(tables.car_blocks.length, 0)
})

test('в простой: номер клейма чужой машины или завершённого — ошибка, ничего не пишется', async () => {
  const { ctx, tables } = setup({ claims: [{ id: 'c1', car_id: 'car2', status: 'waiting', claim_number: 'AB1' }, { id: 'c2', car_id: 'car1', status: 'done', claim_number: 'XY9' }], car_blocks: [] })
  assert.deepEqual(await putIdle(ctx, { carId: 'car1', date: '2026-10-30', claimNumber: 'ab1' }), { ok: false, text: 'Клейм № ab1 уже есть у другой машины' })
  assert.deepEqual(await putIdle(ctx, { carId: 'car1', date: '2026-10-30', claimNumber: 'XY9' }), { ok: false, text: 'Клейм № XY9 уже завершён' })
  assert.equal(tables.car_blocks.length, 0)
  assert.equal(tables.claims.length, 2)
})

test('в простой: открытый клейм этой машины — снимаем по нему, нового клейма нет', async () => {
  const { ctx, tables } = setup({ claims: [{ id: 'c1', car_id: 'car1', status: 'waiting', claim_number: '777', description: null, still_listed: true }], car_blocks: [] })
  const res = await putIdle(ctx, { carId: 'car1', date: '2026-10-30', claimNumber: '777', description: 'дверь' })
  assert.equal(res.ok, true)
  assert.equal(tables.claims.length, 1)
  assert.equal(tables.claims[0].still_listed, false)
  assert.equal(tables.claims[0].description, 'дверь')
  assert.equal(tables.car_blocks[0].reason, 'Клейм № 777 — дверь')
})

test('в простой по другой причине; без причины — ошибка', async () => {
  const { ctx, tables } = setup({ claims: [], car_blocks: [] })
  assert.equal((await putIdle(ctx, { carId: 'car1', date: '2026-10-30', otherReason: '  ' })).ok, false)
  assert.deepEqual(await putIdle(ctx, { carId: 'car1', date: '2026-10-30', otherReason: 'Сервис' }), { ok: true, text: 'Машина в простое' })
  assert.equal(tables.car_blocks[0].reason, 'Сервис')
  assert.equal(tables.claims.length, 0)
})

test('снять по клейму: если на дату уже есть простой — второй не создаётся', async () => {
  const { ctx, tables } = setup({ claims: [{ id: 'c1', still_listed: true }], car_blocks: [{ id: 'b1', car_id: 'car1', start_date: '2026-10-01', end_date: null }] })
  assert.equal(await unlistByClaim(ctx, { carId: 'car1', claimId: 'c1', claimNumber: '1', description: null, date: '2026-10-30' }), true)
  assert.equal(tables.car_blocks.length, 1)
  assert.equal(tables.claims[0].still_listed, false)
})

test('вернуть в работу: простой заканчивается накануне, начавшийся в тот же день — удаляется', async () => {
  const { ctx, tables, logs } = setup({
    cars: [{ id: 'car1', status: 'inactive' }, { id: 'car2', status: 'inactive' }],
    car_blocks: [{ id: 'b1', car_id: 'car1', start_date: '2026-10-10', end_date: null }, { id: 'b2', car_id: 'car2', start_date: '2026-10-30', end_date: null }],
  })
  assert.equal(await endIdle(ctx, { carId: 'car1', block: tables.car_blocks[0] as any, date: '2026-10-30' }), true)
  assert.equal(tables.car_blocks.find(b => b.id === 'b1')!.end_date, '2026-10-29')
  assert.equal(await endIdle(ctx, { carId: 'car2', block: tables.car_blocks[1] as any, date: '2026-10-30' }), true)
  assert.equal(tables.car_blocks.some(b => b.id === 'b2'), false)
  assert.deepEqual(tables.cars.map(c => c.status), ['active', 'active'])
  assert.equal(logs.filter(l => l.action === 'status_change').length, 2)
})

test('завершить клейм: находит простой с номером клейма и возвращает машину', async () => {
  const { ctx, tables } = setup({
    cars: [{ id: 'car1', status: 'inactive' }],
    claims: [{ id: 'c1', car_id: 'car1', claim_number: '555', status: 'in_repair' }],
    car_blocks: [
      { id: 'other', car_id: 'car1', start_date: '2026-10-01', end_date: null, reason: 'Сервис' },
      { id: 'mine', car_id: 'car1', start_date: '2026-10-05', end_date: null, reason: 'Клейм № 555 — бампер' },
    ],
  })
  assert.equal(await completeClaim(ctx, { claim: tables.claims[0] as any, date: '2026-10-30', back: true }), 'back')
  assert.equal(tables.claims[0].status, 'done')
  assert.equal(tables.claims[0].completed_date, '2026-10-30')
  assert.equal(tables.claims[0].still_listed, true)
  assert.equal(tables.car_blocks.find(b => b.id === 'mine')!.end_date, '2026-10-29')
  assert.equal(tables.car_blocks.find(b => b.id === 'other')!.end_date, null)
})

test('завершить клейм без возврата: простой не трогается', async () => {
  const { ctx, tables } = setup({ claims: [{ id: 'c1', car_id: 'car1', claim_number: '1' }], car_blocks: [{ id: 'b', car_id: 'car1', start_date: '2026-10-01', end_date: null }] })
  assert.equal(await completeClaim(ctx, { claim: tables.claims[0] as any, date: '2026-10-30', back: false }), 'done')
  assert.equal(tables.car_blocks[0].end_date, null)
  assert.equal(tables.claims[0].still_listed, undefined)
})

test('Supplement → «Доходы»: одна строка на клейм, повтор заменяет, смена месяца переносит, снятие удаляет', async () => {
  const { ctx, tables } = setup({
    revenue_cars: [{ id: 'rc1', car_id: 'car1', account: 'A', added_from: '2026-01-01', sold_from: null }],
    revenue_entries: [{ id: 'e1', revenue_car_id: 'rc1', period: '2026-10-01', claim_items: [{ claim: 100, supplement: 0, pct: 0 }] }],
  })
  const entry = (p: string) => tables.revenue_entries.find(e => e.period === p)
  assert.equal(await putClaimPayment(ctx, { claimId: 'c1', carId: 'car1', kind: 'supplement', amount: 2300, period: '2026-10-01' }), null)
  assert.deepEqual(entry('2026-10-01')!.claim_items, [{ claim: 100, supplement: 0, pct: 0 }, { claim: 0, supplement: 2300, pct: 0.2, claim_id: 'c1' }])
  await putClaimPayment(ctx, { claimId: 'c1', carId: 'car1', kind: 'supplement', amount: 2500, pct: 0.15, period: '2026-10-01' })
  assert.equal(entry('2026-10-01')!.claim_items.length, 2)
  assert.equal(entry('2026-10-01')!.claim_items[1].supplement, 2500)
  // в ноябре записи ещё нет — создаётся; из октября сумма уходит
  await putClaimPayment(ctx, { claimId: 'c1', carId: 'car1', kind: 'supplement', amount: 2500, pct: 0.15, period: '2026-11-01', prevPeriod: '2026-10-01' })
  assert.deepEqual(entry('2026-10-01')!.claim_items, [{ claim: 100, supplement: 0, pct: 0 }])
  assert.deepEqual(entry('2026-11-01')!.claim_items, [{ claim: 0, supplement: 2500, pct: 0.15, claim_id: 'c1' }])
  await dropClaimPayment(ctx, { claimId: 'c1', carId: 'car1', kind: 'supplement', period: '2026-11-01' })
  assert.deepEqual(entry('2026-11-01')!.claim_items, [])
})

test('клейм → «Доходы»: без машины или без привязки к «Доходам» — понятная ошибка', async () => {
  const { ctx } = setup({ revenue_cars: [], revenue_entries: [] })
  assert.equal(await putClaimPayment(ctx, { claimId: 'c', carId: null, kind: 'initial', amount: 1, period: '2026-10-01' }), 'У клейма не выбрана машина')
  assert.equal(await putClaimPayment(ctx, { claimId: 'c', carId: 'car9', kind: 'initial', amount: 1, period: '2026-10-01' }), 'Эта машина не привязана к «Доходам» в этом месяце')
})

test('продана/разбита и вернуть: парк и все записи «Доходов» машины', async () => {
  const { ctx, tables } = setup({
    cars: [{ id: 'car1', removed_from: null }],
    revenue_cars: [
      { id: 'rc1', car_id: 'car1', sold_from: null }, { id: 'rc2', car_id: 'car1', sold_from: null },
      { id: 'rcOld', car_id: 'car1', sold_from: '2026-05-01' }, { id: 'rcOther', car_id: 'car2', sold_from: null },
    ],
  })
  assert.equal(await removeCarFrom(ctx, { carId: 'car1', from: '2026-11-01', canFleet: true, canIncome: true }), true)
  assert.equal(tables.cars[0].removed_from, '2026-11-01')
  assert.deepEqual(tables.revenue_cars.map(r => r.sold_from), ['2026-11-01', '2026-11-01', '2026-05-01', null])
  assert.equal(await restoreCar(ctx, { carId: 'car1', from: '2026-11-01', canFleet: true, canIncome: true }), true)
  assert.equal(tables.cars[0].removed_from, null)
  assert.deepEqual(tables.revenue_cars.map(r => r.sold_from), [null, null, '2026-05-01', null])
})

test('права: админ — всё; без галочек — только расходы; «Календарь» = «Авто»', () => {
  assert.equal(canAny(accessFrom('admin', []), ['/income']), true)
  assert.equal(canAny(accessFrom('employee', []), ['/expenses']), true)
  assert.equal(canAny(accessFrom('employee', null), ['/claims']), false)
  assert.equal(canAny(accessFrom(null, ['/calendar']), ['/cars']), true)
  assert.equal(canAny(accessFrom('partner', ['/claims']), ['/income', '/claims']), true)
  assert.equal(canAny(null, []), false)
})

test('выплата по клейму: сумма в клейме и в «Доходах»; без доступа к «Доходам» — только в клейме', async () => {
  const { ctx, tables } = setup({
    claims: [{ id: 'c1', car_id: 'car1', initial_period: null, supplement_period: null }],
    revenue_cars: [{ id: 'rc1', car_id: 'car1', added_from: '2026-01-01', sold_from: null }],
    revenue_entries: [],
  })
  assert.equal(await recordClaimPayment(ctx, { claim: tables.claims[0] as any, kind: 'supplement', amount: 1000, pct: 0.2, period: '2026-10-01', canIncome: true }), null)
  assert.equal(tables.claims[0].supplement_paid, true)
  assert.equal(tables.claims[0].supplement_amount, 1000)
  assert.equal(tables.revenue_entries[0].claim_items[0].supplement, 1000)
  assert.equal(await recordClaimPayment(ctx, { claim: tables.claims[0] as any, kind: 'initial', amount: 300, pct: 0, period: '2026-10-01', canIncome: false }), null)
  assert.equal(tables.claims[0].initial_amount, 300)
  assert.equal(tables.revenue_entries[0].claim_items.length, 1)
})

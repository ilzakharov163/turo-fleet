// Проверка формул: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcSalary, idleDaysInMonth, calcEntry, monthExpensesTotal, monthProfit, inFleet } from './calc.ts'

test('зарплата: < 14 дней простоя → 150, ≥ 14 → 75, весь месяц → 0', () => {
  assert.equal(calcSalary(0, 31), 150)
  assert.equal(calcSalary(13, 31), 150)
  assert.equal(calcSalary(14, 31), 75)
  assert.equal(calcSalary(30, 31), 75)
  assert.equal(calcSalary(31, 31), 0)
  assert.equal(calcSalary(28, 28), 0)
})

test('дни простоя в месяце', () => {
  assert.equal(idleDaysInMonth([], '2026-10-01'), 0)
  assert.equal(idleDaysInMonth([{ start_date: '2026-10-05', end_date: '2026-10-09' }], '2026-10-01'), 5)
  assert.equal(idleDaysInMonth([{ start_date: '2026-09-20', end_date: null }], '2026-10-01'), 31)
  assert.equal(idleDaysInMonth([{ start_date: '2026-10-30', end_date: '2026-11-03' }], '2026-10-01'), 2)
  // пересекающиеся простои не считаются дважды
  assert.equal(idleDaysInMonth([{ start_date: '2026-10-01', end_date: '2026-10-10' }, { start_date: '2026-10-05', end_date: '2026-10-12' }], '2026-10-01'), 12)
  assert.equal(idleDaysInMonth([{ start_date: '2026-02-01', end_date: null }], '2026-02-01'), 28)
})

test('итог машины', () => {
  assert.equal(calcEntry(null).net, 0)
  const e = { gross: 1000, repair: 200, claim_items: [{ claim: 500, supplement: 6538, pct: 0.2 }], other_items: [{ desc: 'мойка', amount: 50 }] }
  const t = calcEntry(e)
  assert.equal(t.ded, 6538 * 0.2)
  assert.equal(Math.round(t.net * 100) / 100, Math.round((1000 + 500 + 6538 - 1307.6 - 200 - 50) * 100) / 100)
})

test('прибыль месяца = итоги − расходы компании − платежи', () => {
  const entries = [{ gross: 3000, repair: 0, claim_items: [], other_items: [] }, { gross: 0, repair: 400, claim_items: null, other_items: null }]
  const exp = { salary1: 1000, salary2: 500, items: [{ amount: 100 }] }
  assert.equal(monthExpensesTotal(exp), 1600)
  assert.equal(monthProfit(entries, exp, [{ amount: 250 }]), 3000 - 400 - 1600 - 250)
  assert.equal(monthProfit([], null, []), 0)
})

test('машина в парке: снятая с листинга и убранная с месяца не считаются', () => {
  assert.equal(inFleet({ delisted: false, removed_from: null }, '2026-10-01'), true)
  assert.equal(inFleet({ delisted: true, removed_from: null }, '2026-10-01'), false)
  // убрана с ноября: в октябре ещё в парке, с ноября — нет
  assert.equal(inFleet({ delisted: false, removed_from: '2026-11-01' }, '2026-10-01'), true)
  assert.equal(inFleet({ delisted: false, removed_from: '2026-11-01' }, '2026-11-01'), false)
  assert.equal(inFleet({ delisted: false, removed_from: '2026-11-01' }, '2026-12-01'), false)
})

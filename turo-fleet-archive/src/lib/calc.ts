// Общие формулы приложения. Без импортов — чтобы их можно было проверять тестами (lib/calc.test.ts).

export const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }

// ── Зарплата работника: за месяц по машине в листинге ──
// простой < 14 дней → $150; ≥ 14 дней → $75; весь месяц → $0
export function calcSalary(inactiveDays: number, totalDays: number): number {
  if (inactiveDays >= totalDays) return 0
  if (inactiveDays >= 14) return 75
  return 150
}

// Сколько дней месяца (period = 'yyyy-MM-01') машина была в простое; end_date null — бессрочно
export function idleDaysInMonth(blocks: { start_date: string; end_date: string | null }[], period: string): number {
  const [y, m] = period.split('-').map(Number)
  const total = new Date(y, m, 0).getDate()
  let days = 0
  for (let d = 1; d <= total; d++) {
    const day = `${period.slice(0, 8)}${String(d).padStart(2, '0')}`
    if (blocks.some(b => b.start_date <= day && (!b.end_date || b.end_date >= day))) days++
  }
  return days
}

// ── Парк ──
// Машина в парке в месяце period ('yyyy-MM-01'): не снята с листинга и не убрана (продана/разбита) к этому месяцу.
// removed_from — первый месяц, когда машины уже нет; в предыдущих месяцах она считается как обычно.
export const inFleet = (car: { delisted?: boolean | null; removed_from?: string | null }, period: string) =>
  !car.delisted && (!car.removed_from || car.removed_from > period)

// ── Доходы ──
export interface ClaimItem { claim: number; supplement: number; pct: number }
export interface OtherItem { desc?: string; amount: number }
export interface RevenueEntry { gross: number; repair: number; claim_items: ClaimItem[] | null; other_items: OtherItem[] | null }

// итог машины = gross + Σ claim + Σ supplement − вычет − ремонт − Σ прочее; вычет = Σ supplement × pct
export function calcEntry(e?: RevenueEntry | null) {
  const items = e?.claim_items || []
  const gross = num(e?.gross)
  const claim = items.reduce((s, c) => s + num(c.claim), 0)
  const supp = items.reduce((s, c) => s + num(c.supplement), 0)
  const ded = items.reduce((s, c) => s + num(c.supplement) * num(c.pct), 0)
  const repair = num(e?.repair)
  const other = (e?.other_items || []).reduce((s, o) => s + num(o.amount), 0)
  const net = gross + claim + supp - ded - repair - other
  return { gross, claim, supp, ded, repair, other, net }
}

export interface MonthExpenses { salary1: number; salary2: number; items: OtherItem[] | null }
export const monthExpensesTotal = (m?: MonthExpenses | null) =>
  num(m?.salary1) + num(m?.salary2) + (m?.items || []).reduce((s, i) => s + num(i.amount), 0)

// чистая прибыль месяца = Σ итогов машин − расходы компании − Σ платежей
export function monthProfit(entries: RevenueEntry[], expenses: MonthExpenses | null | undefined, payments: { amount: number }[]) {
  return entries.reduce((s, e) => s + calcEntry(e).net, 0) - monthExpensesTotal(expenses) - payments.reduce((s, p) => s + num(p.amount), 0)
}

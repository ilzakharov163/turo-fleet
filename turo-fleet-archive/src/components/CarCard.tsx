'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { X, CalendarDays, Receipt, ShieldAlert, Tag, Wallet, ChevronRight } from 'lucide-react'
import { format, parseISO, addDays, differenceInCalendarDays, subMonths } from 'date-fns'
import { ru } from 'date-fns/locale'
import { createClient } from '@/lib/supabase'
import { canAny, useAccess } from '@/lib/access'
import { calcEntry, calcSalary, idleDaysInMonth, num, type RevenueEntry } from '@/lib/calc'
import { Car } from '@/types'

// Всё о машине на одном экране: простои, расходы, клеймы, наклейка, доход.
// Разделы без доступа (галочки в «Команде») не показываются — база их всё равно не отдаст.

interface Block { id: string; start_date: string; end_date: string | null; reason: string | null }
interface Exp { id: string; title: string; amount: number; date: string; paid: boolean | null }
interface Claim { id: string; status: string; opened_date: string | null; completed_date: string | null }
interface Entry extends RevenueEntry { period: string; revenue_car_id: string }

const STICKER_INTERVAL = 45
const CLAIM_STATUS: Record<string, string> = { waiting: 'Ждёт ремонта', in_repair: 'В ремонте', done: 'Завершён' }
const fmt = (d: string) => format(parseISO(d), 'd MMM yyyy', { locale: ru })
const usd = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

export default function CarCard({ car, onClose }: { car: Car; onClose: () => void }) {
  const access = useAccess()
  const [loading, setLoading] = useState(true)
  const [blocks, setBlocks] = useState<Block[]>([])
  const [expenses, setExpenses] = useState<Exp[]>([])
  const [claims, setClaims] = useState<Claim[]>([])
  const [sticker, setSticker] = useState<{ tracked: boolean; last: string | null }>({ tracked: false, last: null })
  const [entries, setEntries] = useState<Entry[]>([])

  useEffect(() => {
    if (!access) return
    const supabase = createClient()
    const empty = Promise.resolve({ data: [] as never[] })
    Promise.all([
      canAny(access, ['/cars']) ? supabase.from('car_blocks').select('id, start_date, end_date, reason').eq('car_id', car.id).order('start_date', { ascending: false }) : empty,
      canAny(access, ['/expenses']) ? supabase.from('expenses').select('id, title, amount, date, paid').eq('car_id', car.id).order('date', { ascending: false }) : empty,
      canAny(access, ['/claims']) ? supabase.from('claims').select('id, status, opened_date, completed_date').eq('car_id', car.id).order('opened_date', { ascending: false }) : empty,
      canAny(access, ['/stickers']) ? supabase.from('sticker_cars').select('id').eq('car_id', car.id) : empty,
      canAny(access, ['/stickers']) ? supabase.from('sticker_changes').select('changed_date').eq('car_id', car.id).order('changed_date', { ascending: false }).limit(1) : empty,
      canAny(access, ['/income']) ? supabase.from('revenue_cars').select('id').eq('car_id', car.id) : empty,
    ]).then(async ([b, e, c, sc, sch, rc]) => {
      setBlocks((b.data || []) as Block[])
      setExpenses((e.data || []) as Exp[])
      setClaims((c.data || []) as Claim[])
      setSticker({ tracked: (sc.data || []).length > 0, last: ((sch.data || []) as { changed_date: string }[])[0]?.changed_date || null })
      const ids = ((rc.data || []) as { id: string }[]).map(x => x.id)
      if (ids.length) {
        const { data } = await supabase.from('revenue_entries').select('revenue_car_id, period, gross, repair, claim_items, other_items').in('revenue_car_id', ids)
        setEntries((data || []) as Entry[])
      }
      setLoading(false)
    })
  }, [access, car.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const today = format(new Date(), 'yyyy-MM-dd')
  const curP = format(new Date(), 'yyyy-MM-01')
  const idle = blocks.find(b => b.start_date <= today && (!b.end_date || b.end_date >= today))
  const idleDays = idleDaysInMonth(blocks, curP)
  const monthDays = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()

  const monthExp = expenses.filter(e => e.date >= curP).reduce((s, e) => s + num(e.amount), 0)
  const yearExp = expenses.filter(e => e.date >= format(subMonths(new Date(), 12), 'yyyy-MM-dd')).reduce((s, e) => s + num(e.amount), 0)

  const openClaims = claims.filter(c => c.status !== 'done')
  const stickerLeft = sticker.last ? differenceInCalendarDays(addDays(parseISO(sticker.last), STICKER_INTERVAL), new Date()) : null

  const lifetime = entries.reduce((s, e) => s + calcEntry(e).net, 0)
  const months = Array.from({ length: 6 }, (_, i) => {
    const p = format(subMonths(new Date(), 5 - i), 'yyyy-MM-01')
    const list = entries.filter(e => e.period === p)
    return { p, net: list.reduce((s, e) => s + calcEntry(e).net, 0), has: list.length > 0 }
  })
  const hMax = Math.max(1, ...months.map(m => Math.abs(m.net)))

  const show = (keys: string[]) => canAny(access, keys)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end bg-black/30" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full sm:w-[460px] max-h-[92vh] sm:max-h-none bg-white rounded-t-[24px] sm:rounded-none sm:rounded-l-[24px] shadow-2xl flex flex-col animate-in">
        <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-gray-100">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-gray-900 truncate">{car.make} {car.model}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="font-mono text-xs font-semibold text-gray-600 bg-gray-100 rounded-md px-1.5 py-0.5">{car.plate}</span>
              {show(['/cars']) && !loading && (
                <span className={`text-xs font-semibold rounded-md px-1.5 py-0.5 ${idle ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-600'}`}>{idle ? 'В простое' : 'В работе'}</span>
              )}
              {car.delisted && <span className="text-xs font-semibold rounded-md px-1.5 py-0.5 bg-orange-50 text-orange-500">Снята с листинга</span>}
            </div>
          </div>
          <button onClick={onClose} className="p-2 -mr-2 rounded-xl text-gray-400 hover:bg-gray-100" aria-label="Закрыть"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          {loading ? (
            <div className="space-y-3">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-20" />)}</div>
          ) : (
            <>
              {show(['/cars']) && (
                <Section icon={CalendarDays} title="Простои" href="/cars?tab=downtime">
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label={`Простой за ${format(new Date(), 'LLLL', { locale: ru })}`} value={`${idleDays} дн.`} />
                    <Stat label="Зарплата работника" value={`$${car.delisted ? 0 : calcSalary(idleDays, monthDays)}`} />
                  </div>
                  {idle && <p className="text-sm text-red-600 mt-2">Сейчас в простое с {fmt(idle.start_date)}{idle.end_date ? ` по ${fmt(idle.end_date)}` : ''}{idle.reason ? ` · ${idle.reason}` : ''}</p>}
                  {blocks.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {blocks.slice(0, 4).map(b => (
                        <li key={b.id} className="text-xs text-gray-500">{fmt(b.start_date)} — {b.end_date ? fmt(b.end_date) : 'без даты'}{b.reason ? ` · ${b.reason}` : ''}</li>
                      ))}
                    </ul>
                  )}
                </Section>
              )}

              {show(['/expenses']) && (
                <Section icon={Receipt} title="Расходы" href="/expenses">
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label="В этом месяце" value={usd(monthExp)} />
                    <Stat label="За 12 месяцев" value={usd(yearExp)} />
                  </div>
                  {expenses.length > 0 ? (
                    <ul className="mt-2 divide-y divide-gray-100">
                      {expenses.slice(0, 5).map(e => (
                        <li key={e.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                          <span className="min-w-0 truncate text-gray-700">{e.title} <span className="text-xs text-gray-400">· {format(parseISO(e.date), 'd MMM', { locale: ru })}</span></span>
                          <span className="tabular-nums font-medium text-gray-900">${num(e.amount).toFixed(2)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-sm text-gray-400 mt-2">Расходов нет</p>}
                </Section>
              )}

              {show(['/claims']) && (
                <Section icon={ShieldAlert} title="Клеймы" href="/cars?tab=claims">
                  {claims.length === 0 ? <p className="text-sm text-gray-400">Клеймов нет</p> : (
                    <>
                      <p className="text-sm text-gray-700">{openClaims.length ? `Открыто: ${openClaims.length}` : 'Открытых нет'} · всего {claims.length}</p>
                      <ul className="mt-1.5 space-y-1">
                        {claims.slice(0, 4).map(c => (
                          <li key={c.id} className="text-xs text-gray-500">
                            {CLAIM_STATUS[c.status] || c.status}
                            {c.status === 'done' && c.completed_date ? ` · ${fmt(c.completed_date)}` : c.opened_date ? ` · открыт ${fmt(c.opened_date)}` : ''}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </Section>
              )}

              {show(['/stickers']) && (
                <Section icon={Tag} title="Наклейка" href="/cars?tab=stickers">
                  {!sticker.tracked ? <p className="text-sm text-gray-400">Не отслеживается</p>
                    : stickerLeft === null ? <p className="text-sm text-gray-500">Замен ещё не было</p>
                    : (
                      <p className={`text-sm font-medium ${stickerLeft <= 0 ? 'text-red-600' : stickerLeft <= 7 ? 'text-yellow-600' : 'text-gray-700'}`}>
                        {stickerLeft <= 0 ? `Пора менять (просрочено ${-stickerLeft} дн.)` : `Замена через ${stickerLeft} дн.`}
                        <span className="text-xs font-normal text-gray-400"> · последняя {fmt(sticker.last!)}</span>
                      </p>
                    )}
                </Section>
              )}

              {show(['/income']) && (
                <Section icon={Wallet} title="Доход" href="/income">
                  {entries.length === 0 ? (
                    <p className="text-sm text-gray-400">Машина не привязана к «Доходам» или данных ещё нет</p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <Stat label="Итог за всё время" value={usd(lifetime)} negative={lifetime < 0} />
                        <Stat label="В среднем за месяц" value={usd(lifetime / new Set(entries.map(e => e.period)).size)} />
                      </div>
                      <div className="flex items-end gap-2 mt-3">
                        {months.map(m => (
                          <div key={m.p} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={m.has ? usd(m.net) : 'нет данных'}>
                            <div className="w-full h-12 flex items-end">
                              <div className={`w-full rounded-md ${!m.has ? 'bg-gray-100' : m.net < 0 ? 'bg-red-400' : 'bg-indigo-300'}`}
                                style={{ height: `${m.has ? Math.max(8, Math.abs(m.net) / hMax * 100) : 8}%` }} />
                            </div>
                            <span className="text-[10px] text-gray-400">{format(parseISO(m.p), 'LLL', { locale: ru })}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ icon: Icon, title, href, children }: { icon: typeof Tag; title: string; href: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-100 p-3.5">
      <Link href={href} className="flex items-center justify-between mb-2.5">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900">
          <span className="w-7 h-7 rounded-lg bg-indigo-50 text-[#4F46E5] dark:text-indigo-300 flex items-center justify-center"><Icon size={15} /></span>
          {title}
        </span>
        <ChevronRight size={16} className="text-gray-300" />
      </Link>
      {children}
    </div>
  )
}

function Stat({ label, value, negative = false }: { label: string; value: string; negative?: boolean }) {
  return (
    <div className="rounded-xl bg-gray-50 px-3 py-2">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className={`text-base font-bold tabular-nums ${negative ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}

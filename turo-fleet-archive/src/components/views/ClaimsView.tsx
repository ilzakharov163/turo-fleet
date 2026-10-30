'use client'

import { Fragment, useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { log } from '@/lib/logger'
import { Car } from '@/types'
import { Plus, X, Pencil, ChevronLeft, ChevronRight, Check, StickyNote, Search } from 'lucide-react'
import { format, parseISO, startOfMonth, addMonths, subMonths, subDays, isSameMonth } from 'date-fns'
import { ru } from 'date-fns/locale'
import DatePicker from '@/components/ui/DatePicker'
import { ask, notify } from '@/lib/ui'
import { canAny, useAccess } from '@/lib/access'
import { unlistByClaim } from '@/lib/unlist'
import { loadPlateHistory, normPlate, oldPlatesByCar } from '@/lib/plates'
import PlateHistory from '@/components/PlateHistory'
import { putClaimPayment, dropClaimPayment, type ClaimKind } from '@/lib/claimIncome'
import MonthPicker from '@/components/ui/MonthPicker'
import { inFleet } from '@/lib/calc'
import { ACCOUNT_COLORS } from '@/lib/accountColors'
import { inputCls } from '@/components/ui/PageShell'

interface Claim {
  id: string
  car_id: string | null
  status: 'waiting' | 'in_repair' | 'done'
  opened_date: string | null
  completed_date: string | null
  initial_payment_received: boolean
  supplement_paid: boolean
  still_listed: boolean
  notes: string | null
  claim_number: string | null
  description: string | null
  initial_amount: number | null
  initial_period: string | null
  supplement_amount: number | null
  supplement_pct: number | null
  supplement_period: string | null
  created_at: string
  car?: Car
}

const STATUS_LABELS: Record<Claim['status'], string> = {
  waiting: 'Ожидает ремонта',
  in_repair: 'В ремонте',
  done: 'Завершён',
}

const emptyForm = {
  car_id: '',
  status: 'waiting' as Claim['status'],
  opened_date: '',
  completed_date: '',
  initial_payment_received: false,
  supplement_paid: false,
  still_listed: true,
  notes: '',
  claim_number: '',
  description: '',
}

function today() {
  return format(new Date(), 'yyyy-MM-dd')
}

const short = (iso: string) => format(parseISO(iso), 'd MMM', { locale: ru })

// Дата, по которой завершённый клейм относится к месяцу
function doneDate(c: Claim): string | null {
  return c.completed_date || c.opened_date || c.created_at || null
}

// Аккаунт «Доходов», на котором машина (имя и цвет точки как в «Доходах»)
interface CarAccount { label: string; dot: string }
interface Block { id: string; start_date: string; end_date: string | null; reason: string | null }

function CarTitle({ c, acc }: { c: Claim; acc?: CarAccount | null }) {
  return c.car ? (
    <>
      {c.car.make} {c.car.model} <span className="font-semibold text-gray-900">{c.car.plate}</span>
      {acc && <span className="ml-1.5 inline-flex items-center gap-1 align-middle rounded-md bg-gray-100 px-1.5 py-px text-[11px] font-medium text-gray-600" title="Аккаунт в «Доходах»"><span className={`w-1.5 h-1.5 rounded-full ${acc.dot}`} />{acc.label}</span>}
    </>
  ) : <span className="text-gray-400">— без авто —</span>
}

export default function ClaimsView() {
  const [claims, setClaims] = useState<Claim[]>([])
  const [cars, setCars] = useState<Car[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editClaim, setEditClaim] = useState<Claim | null>(null)
  // Снять с листинга из карточки клейма (машина каталась с открытым клеймом)
  const [unlistDate, setUnlistDate] = useState('')
  const [unlistBusy, setUnlistBusy] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()))
  const [openNotes, setOpenNotes] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [formError, setFormError] = useState('')
  // Окно суммы Initial / Supplement (сумма сразу попадает в «Доходы» машины)
  const [pay, setPay] = useState<{ c: Claim; kind: ClaimKind; amount: string; pct: string; month: string; busy: boolean; error: string } | null>(null)
  const access = useAccess()
  const [carAcc, setCarAcc] = useState<Record<string, CarAccount>>({})
  // Прежние номера машин (car_id → старые номера) — для поиска и выбора машины по старому номеру
  const [oldPlates, setOldPlates] = useState<Record<string, string[]>>({})
  // «Завершить»: клейм завершается, машина возвращается в работу (закрывается её текущий простой)
  const [finish, setFinish] = useState<{ c: Claim; date: string; back: boolean; block: Block | null; busy: boolean } | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const [claimsRes, carsRes, rcRes, accRes] = await Promise.all([
      supabase.from('claims').select('*, car:cars(*)').order('opened_date', { ascending: true }),
      supabase.from('cars').select('*').order('make'),
      // Аккаунты «Доходов» (без доступа к «Доходам» запрос вернёт ошибку — тогда аккаунт просто не показываем)
      supabase.from('revenue_cars').select('car_id, account, added_from, sold_from').not('car_id', 'is', null),
      supabase.from('revenue_accounts').select('key, label').order('sort'),
    ])
    const accs = (accRes.data || []) as { key: string; label: string }[]
    const now = format(new Date(), 'yyyy-MM-01')
    const map: Record<string, CarAccount> = {}
    // Сначала старые записи, потом те, что числятся в текущем месяце, — они перезаписывают
    const rcs = ((rcRes.data || []) as { car_id: string; account: string; added_from: string; sold_from: string | null }[])
      .map(rc => ({ rc, cur: rc.added_from <= now && (!rc.sold_from || now < rc.sold_from) }))
      .sort((a, b) => Number(a.cur) - Number(b.cur) || a.rc.added_from.localeCompare(b.rc.added_from))
    for (const { rc } of rcs) {
      const i = accs.findIndex(a => a.key === rc.account)
      if (i >= 0) map[rc.car_id] = { label: accs[i].label, dot: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length].dot }
    }
    setCarAcc(map)
    setOldPlates(oldPlatesByCar(await loadPlateHistory()))
    setClaims((claimsRes.data as Claim[]) || [])
    setCars(carsRes.data || [])
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- загрузка данных при открытии
  useEffect(() => { load() }, [load])

  function openAdd() {
    setEditClaim(null)
    setForm({ ...emptyForm, opened_date: today() })
    setFormError('')
    setShowModal(true)
  }

  function openEdit(c: Claim) {
    setEditClaim(c)
    setUnlistDate(today())
    setForm({
      car_id: c.car_id || '',
      status: c.status,
      opened_date: c.opened_date || '',
      completed_date: c.completed_date || '',
      initial_payment_received: c.initial_payment_received,
      supplement_paid: c.supplement_paid,
      still_listed: c.still_listed,
      notes: c.notes || '',
      claim_number: c.claim_number || '',
      description: c.description || '',
    })
    setFormError('')
    setShowModal(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    // Номер клейма обязателен для новых; у старых клеймов без номера его можно дописать позже
    if (!editClaim && !form.claim_number.trim()) { setFormError('Укажите номер клейма'); return }
    const supabase = createClient()
    const payload = {
      claim_number: form.claim_number.trim() || null,
      description: form.description.trim() || null,
      car_id: form.car_id || null,
      status: form.status,
      opened_date: form.opened_date || null,
      completed_date: form.status === 'done' ? (form.completed_date || today()) : null,
      initial_payment_received: form.initial_payment_received,
      supplement_paid: form.supplement_paid,
      still_listed: form.still_listed,
      notes: form.notes || null,
    }
    if (editClaim) {
      const { error } = await supabase.from('claims').update(payload).eq('id', editClaim.id)
      if (error) { return }
      await log('update', 'claim', editClaim.id, payload)
    } else {
      const { data, error } = await supabase.from('claims').insert(payload).select().single()
      if (error) { return }
      if (data) await log('create', 'claim', data.id, payload)
    }
    setShowModal(false)
    load()
  }

  async function unlistFromClaim() {
    if (!editClaim?.car_id || !unlistDate) return
    setUnlistBusy(true)
    const ok = await unlistByClaim({ carId: editClaim.car_id, claimId: editClaim.id, claimNumber: form.claim_number.trim() || editClaim.claim_number, description: form.description.trim() || editClaim.description, date: unlistDate })
    setUnlistBusy(false)
    if (!ok) return
    setEditClaim({ ...editClaim, still_listed: false })
    setForm(f => ({ ...f, still_listed: false }))
    notify(`Машина снята с листинга с ${format(parseISO(unlistDate), 'd MMMM', { locale: ru })}`, 'success')
    load()
  }

  async function handleDelete(c: Claim) {
    if (!await ask('Удалить клейм?', { ok: 'Удалить', danger: true })) return
    const supabase = createClient()
    await supabase.from('claims').delete().eq('id', c.id)
    await log('delete', 'claim', c.id, { car_id: c.car_id })
    setShowModal(false)
    load()
  }

  function openPay(c: Claim, kind: ClaimKind) {
    const amount = kind === 'initial' ? c.initial_amount : c.supplement_amount
    const per = kind === 'initial' ? c.initial_period : c.supplement_period
    setPay({ c, kind, amount: amount ? String(amount) : '', pct: String(Math.round(((c.supplement_pct ?? 0.2) * 100) * 100) / 100), month: (per || format(new Date(), 'yyyy-MM-01')).slice(0, 7), busy: false, error: '' })
  }

  async function savePay() {
    if (!pay) return
    const amount = Number(pay.amount.replace(',', '.'))
    if (!(amount > 0)) { setPay({ ...pay, error: 'Введите сумму' }); return }
    const pct = Math.min(100, Math.max(0, Number(pay.pct.replace(',', '.')) || 0)) / 100
    const period = `${pay.month}-01`
    const { c, kind } = pay
    setPay({ ...pay, busy: true, error: '' })
    const canIncome = canAny(access, ['/income'])
    if (canIncome) {
      const err = await putClaimPayment({ claimId: c.id, carId: c.car_id, kind, amount, pct, period, prevPeriod: kind === 'initial' ? c.initial_period : c.supplement_period })
      if (err) { setPay({ ...pay, busy: false, error: err }); return }
    }
    const update = kind === 'initial'
      ? { initial_payment_received: true, initial_amount: amount, initial_period: period }
      : { supplement_paid: true, supplement_amount: amount, supplement_pct: pct, supplement_period: period }
    const { error } = await createClient().from('claims').update(update).eq('id', c.id)
    if (error) { setPay({ ...pay, busy: false }); return }
    await log('update', 'claim', c.id, update)
    notify(canIncome ? `${kind === 'initial' ? 'Initial' : 'Supplement'} записан в «Доходы»` : 'Сумма сохранена в клейме (в «Доходы» не записана — нет доступа)', canIncome ? 'success' : 'info')
    setPay(null)
    load()
  }

  async function clearPay() {
    if (!pay) return
    const { c, kind } = pay
    const amount = kind === 'initial' ? c.initial_amount : c.supplement_amount
    const per = kind === 'initial' ? c.initial_period : c.supplement_period
    if (!await ask(`Снять отметку ${kind === 'initial' ? 'Initial' : 'Supplement'}?`, { detail: amount && per ? `Сумма ${amount} уберётся из «Доходов» за ${format(parseISO(per), 'LLLL', { locale: ru })}.` : undefined, ok: 'Снять' })) return
    setPay({ ...pay, busy: true })
    if (canAny(access, ['/income'])) await dropClaimPayment({ claimId: c.id, carId: c.car_id, kind, period: per })
    const update = kind === 'initial'
      ? { initial_payment_received: false, initial_amount: null, initial_period: null }
      : { supplement_paid: false, supplement_amount: null, supplement_pct: null, supplement_period: null }
    await createClient().from('claims').update(update).eq('id', c.id)
    await log('update', 'claim', c.id, update)
    setPay(null)
    load()
  }


  // Текущий простой машины на дату: сначала тот, где в причине номер этого клейма
  async function openBlockFor(c: Claim, date: string): Promise<Block | null> {
    if (!c.car_id) return null
    const { data } = await createClient().from('car_blocks').select('id, start_date, end_date, reason').eq('car_id', c.car_id)
      .lte('start_date', date).or(`end_date.is.null,end_date.gte.${date}`)
    const list = (data || []) as Block[]
    const num = c.claim_number?.trim().toLowerCase()
    return list.find(b => num && (b.reason || '').toLowerCase().includes(num)) || list[0] || null
  }

  async function openFinish(c: Claim) {
    const date = today()
    setFinish({ c, date, back: true, block: await openBlockFor(c, date), busy: false })
  }

  async function changeFinishDate(date: string) {
    if (!finish || !date) return
    const block = await openBlockFor(finish.c, date)
    setFinish(f => f && { ...f, date, block })
  }

  async function saveFinish() {
    if (!finish) return
    const { c, date, back, block } = finish
    setFinish({ ...finish, busy: true })
    const supabase = createClient()
    const update = { status: 'done' as const, completed_date: date, ...(back && block ? { still_listed: true } : {}) }
    const { error } = await supabase.from('claims').update(update).eq('id', c.id)
    if (error) { setFinish({ ...finish, busy: false }); return }
    await log('update', 'claim', c.id, update)
    if (back && block && c.car_id) {
      // В работе с выбранной даты: простой заканчивается накануне (начался в тот же день — простоя не было)
      const dayBefore = format(subDays(parseISO(date), 1), 'yyyy-MM-dd')
      const res = block.start_date >= date
        ? await supabase.from('car_blocks').delete().eq('id', block.id)
        : await supabase.from('car_blocks').update({ end_date: dayBefore }).eq('id', block.id)
      if (!res.error) {
        await supabase.from('cars').update({ status: 'active', inactive_reason: null, updated_at: new Date().toISOString() }).eq('id', c.car_id)
        await log('status_change', 'car', c.car_id, { status: 'active', from_claim: c.id, block_id: block.id, end_date: block.start_date >= date ? null : dayBefore })
      }
    }
    notify(back && block ? `Клейм завершён, машина в работе с ${format(parseISO(date), 'd MMMM', { locale: ru })}` : 'Клейм завершён', 'success')
    setFinish(null)
    load()
  }

  async function setStatus(c: Claim, status: Claim['status']) {
    const supabase = createClient()
    const update = { status, completed_date: status === 'done' ? today() : null }
    const { error } = await supabase.from('claims').update(update).eq('id', c.id)
    if (error) { return }
    await log('update', 'claim', c.id, update)
    load()
  }

  const q = query.trim().toLowerCase()
  const nq = normPlate(query)
  const matches = (c: Claim) => !q || [c.claim_number, c.description, c.notes, c.car ? `${c.car.make} ${c.car.model} ${c.car.plate}` : ''].some(v => (v || '').toLowerCase().includes(q))
    || (!!nq && !!c.car_id && [c.car?.plate, ...(oldPlates[c.car_id] || [])].some(p => normPlate(p).includes(nq)))
  const found = q ? claims.filter(matches).sort((a, b) => (b.opened_date || b.created_at).localeCompare(a.opened_date || a.created_at)) : []
  const waiting = claims.filter(c => c.status === 'waiting')
  const inRepair = claims.filter(c => c.status === 'in_repair')
  const done = claims
    .filter(c => {
      if (c.status !== 'done') return false
      const d = doneDate(c)
      return d ? isSameMonth(parseISO(d), month) : false
    })
    .sort((a, b) => (doneDate(b) || '').localeCompare(doneDate(a) || ''))
  const isCurrentMonth = isSameMonth(month, new Date())
  const monthLabel = format(month, 'LLLL yyyy', { locale: ru })

  // ── Строка активного клейма ──
  function activeRow(c: Claim) {
    const notesOpen = openNotes === c.id
    return (
      <div className="px-4 py-3">
        <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
          <div className="flex-1 min-w-[180px]">
            <p className="text-sm text-gray-700 truncate"><CarTitle c={c} acc={c.car_id ? carAcc[c.car_id] : null} /></p>
            {(c.claim_number || c.description) && (
              <p className="text-xs text-gray-600 truncate">
                {c.claim_number && <span className="font-mono font-semibold text-[#4F46E5] dark:text-indigo-300">№ {c.claim_number}</span>}
                {c.claim_number && c.description ? ' · ' : ''}{c.description}
              </p>
            )}
            <p className="text-xs text-gray-400 flex items-center gap-1.5 flex-wrap">
              {c.opened_date ? `открыт ${short(c.opened_date)}` : 'дата не указана'}
              {c.still_listed && <button type="button" onClick={() => openEdit(c)} className="text-purple-500 hover:underline" title="Снять с листинга">· листинг активен</button>}
              {c.notes && (
                <button onClick={() => setOpenNotes(notesOpen ? null : c.id)} className="inline-flex items-center gap-0.5 text-gray-400 hover:text-gray-600">
                  · <StickyNote size={11} /> заметка
                </button>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => openPay(c, 'initial')}
              title="Initial payment получен"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors ${c.initial_payment_received ? 'bg-green-50 text-green-700 border-green-200' : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'}`}
            >
              {c.initial_payment_received ? <Check size={11} /> : <span className="w-[11px] h-[11px] rounded-sm border border-gray-300" />} Initial{c.initial_amount ? ` $${Number(c.initial_amount).toLocaleString('en-US')}` : ''}
            </button>
            <button
              onClick={() => openPay(c, 'supplement')}
              title="Supplement оплачен"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors ${c.supplement_paid ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-500 border-red-200 hover:bg-red-100'}`}
            >
              {c.supplement_paid ? <Check size={11} /> : <span className="w-[11px] h-[11px] rounded-sm border border-red-300" />} Supplement{c.supplement_amount ? ` $${Number(c.supplement_amount).toLocaleString('en-US')}` : ''}
            </button>
          </div>
          <div className="flex items-center gap-1 ml-auto">
            {c.status === 'waiting' ? (
              <button onClick={() => setStatus(c, 'in_repair')} className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-600 border border-blue-100 hover:bg-blue-100 whitespace-nowrap">→ В ремонт</button>
            ) : (
              <button onClick={() => openFinish(c)} className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-green-50 text-green-600 border border-green-100 hover:bg-green-100 whitespace-nowrap">→ Завершить</button>
            )}
            <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600" title="Редактировать"><Pencil size={14} /></button>
          </div>
        </div>
        {notesOpen && c.notes && <p className="mt-2 text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">{c.notes}</p>}
      </div>
    )
  }

  function section(title: string, dot: string, items: Claim[], empty: string) {
    return (
      <div className="bg-white rounded-[18px] border border-gray-100/80 card-shadow overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
          <span className={`w-2 h-2 rounded-full ${dot}`} />
          <h2 className="text-sm font-bold text-gray-900">{title}</h2>
          <span className="text-xs font-semibold text-gray-400">{items.length}</span>
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-4 text-sm text-gray-400">{empty}</p>
        ) : (
          <div className="divide-y divide-gray-100">{items.map(c => <Fragment key={c.id}>{activeRow(c)}</Fragment>)}</div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Клеймы и ремонт</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {loading ? 'Загрузка…' : `${waiting.length} ждут ремонта · ${inRepair.length} в ремонте`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PlateHistory cars={cars} className="hidden sm:inline-flex" />
          <button onClick={openAdd} className="flex items-center gap-2 btn-primary px-4 h-10">
            <Plus size={16} /> Добавить клейм
          </button>
        </div>
      </div>

      {/* Поиск по номеру клейма, машине, описанию */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск: номер клейма, машина (и старый номер), описание…"
          className="w-full h-11 pl-9 pr-9 text-base sm:text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400/30 focus:border-indigo-400" />
        {query && <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" aria-label="Очистить"><X size={15} /></button>}
      </div>

      {!loading && q && (
        <div className="bg-white rounded-[18px] border border-gray-100/80 card-shadow overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 text-sm font-bold text-gray-900">Найдено: {found.length}</div>
          {found.length === 0 ? <p className="px-4 py-4 text-sm text-gray-400">Ничего не найдено</p> : (
            <div className="divide-y divide-gray-100">
              {found.map(c => c.status === 'done' ? (
                <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Check size={14} className="text-green-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700 truncate"><CarTitle c={c} acc={c.car_id ? carAcc[c.car_id] : null} /></p>
                    <p className="text-xs text-gray-500 truncate">{c.claim_number && <span className="font-mono font-semibold">№ {c.claim_number} · </span>}{c.opened_date ? `открыт ${short(c.opened_date)} → ` : ''}завершён {c.completed_date ? short(c.completed_date) : '—'}{c.description ? ` · ${c.description}` : ''}</p>
                  </div>
                  <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-gray-300 hover:bg-gray-100 hover:text-gray-600" title="Редактировать"><Pencil size={13} /></button>
                </div>
              ) : <Fragment key={c.id}>{activeRow(c)}</Fragment>)}
            </div>
          )}
        </div>
      )}

      {!loading && !q && (
        <>
          {section('Ожидают ремонта', 'bg-yellow-400', waiting, 'Нет машин в очереди')}
          {section('В ремонте', 'bg-blue-500', inRepair, 'Сейчас в ремонте ничего нет')}

          {/* Завершённые — по месяцам, без Initial/Supplement */}
          <div className="bg-white rounded-[18px] border border-gray-100/80 card-shadow overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 flex-wrap">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <h2 className="text-sm font-bold text-gray-900">Завершены</h2>
              <span className="text-xs font-semibold text-gray-400">{done.length}</span>
              <div className="flex items-center gap-1 ml-auto">
                <button onClick={() => setMonth(m => subMonths(m, 1))} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100" aria-label="Предыдущий месяц"><ChevronLeft size={15} /></button>
                <span className="text-xs font-semibold text-gray-700 capitalize min-w-[100px] text-center">{monthLabel}</span>
                <button onClick={() => setMonth(m => addMonths(m, 1))} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100" aria-label="Следующий месяц"><ChevronRight size={15} /></button>
                {!isCurrentMonth && (
                  <button onClick={() => setMonth(startOfMonth(new Date()))} className="text-[11px] font-medium text-[#4F46E5] hover:underline ml-1">Текущий</button>
                )}
              </div>
            </div>
            {done.length === 0 ? (
              <p className="px-4 py-4 text-sm text-gray-400">В этом месяце завершённых нет</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {done.map(c => (
                  <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Check size={14} className="text-green-500 flex-shrink-0" />
                    <p className="flex-1 min-w-0 text-sm text-gray-700 truncate"><CarTitle c={c} acc={c.car_id ? carAcc[c.car_id] : null} />{c.claim_number && <span className="ml-1.5 font-mono text-xs text-gray-400">№ {c.claim_number}</span>}</p>
                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      {c.opened_date ? `${short(c.opened_date)} → ` : ''}завершён {c.completed_date ? short(c.completed_date) : '—'}
                    </span>
                    <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-gray-300 hover:bg-gray-100 hover:text-gray-600" title="Редактировать"><Pencil size={13} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-[2px] flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div className="bg-white rounded-t-[22px] sm:rounded-[20px] shadow-2xl p-5 sm:p-6 w-full max-w-lg max-h-[92vh] overflow-y-auto animate-in" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold">{editClaim ? 'Редактировать клейм' : 'Новый клейм'}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Номер клейма{!editClaim && ' *'}</label>
                  <input value={form.claim_number} onChange={e => { setForm(f => ({ ...f, claim_number: e.target.value })); setFormError('') }} placeholder="Например, 12345678" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Что случилось</label>
                  <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Коротко: бампер, фара…" className={inputCls} />
                </div>
              </div>
              {formError && <p className="text-sm text-red-600 -mt-2">{formError}</p>}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">Авто</label>
                  <PlateHistory cars={cars} onPick={id => setForm(f => ({ ...f, car_id: id }))} label="Не помню номер" className="text-xs" />
                </div>
                <select value={form.car_id} onChange={e => setForm(f => ({ ...f, car_id: e.target.value }))} className={inputCls}>
                  <option value="">Выберите авто</option>
                  {cars.filter(c => inFleet(c, format(new Date(), 'yyyy-MM-01'))).map(c => (<option key={c.id} value={c.id}>{c.make} {c.model} {c.plate}{oldPlates[c.id]?.length ? ` (был ${oldPlates[c.id].join(', ')})` : ''}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Статус</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['waiting', 'in_repair', 'done'] as const).map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, status: s }))}
                      className={`px-2 py-2 rounded-lg border text-xs font-semibold transition-colors ${form.status === s ? 'border-[#4F46E5] bg-indigo-50 text-[#4F46E5]' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                    >
                      {STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Открыт</label>
                  <DatePicker value={form.opened_date} onChange={val => setForm(f => ({ ...f, opened_date: val }))} />
                </div>
                {form.status === 'done' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Завершён</label>
                    <DatePicker value={form.completed_date} onChange={val => setForm(f => ({ ...f, completed_date: val }))} />
                  </div>
                )}
              </div>
              {form.status !== 'done' && (
                <div className="space-y-2.5">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={form.initial_payment_received} onChange={e => setForm(f => ({ ...f, initial_payment_received: e.target.checked }))} className="w-4 h-4 rounded accent-blue-600" />
                    <span className="text-sm text-gray-700">Initial payment получен</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={form.supplement_paid} onChange={e => setForm(f => ({ ...f, supplement_paid: e.target.checked }))} className="w-4 h-4 rounded accent-blue-600" />
                    <span className="text-sm text-gray-700">Supplement оплачен</span>
                  </label>
                  {editClaim && editClaim.car_id && editClaim.status !== 'done' ? (
                    editClaim.still_listed ? (
                      <div className="rounded-2xl border border-purple-100 bg-purple-50/60 dark:bg-purple-500/10 p-3 space-y-2">
                        <p className="text-sm text-gray-700"><b className="text-gray-900">Машина ещё в листинге</b> — катается с открытым клеймом. Когда уходит на supplement / ремонт, снимите её:</p>
                        <div className="flex gap-2 items-center">
                          <div className="flex-1 min-w-0"><DatePicker value={unlistDate} onChange={setUnlistDate} /></div>
                          <button type="button" onClick={unlistFromClaim} disabled={unlistBusy || !unlistDate} className="h-11 px-3 rounded-[10px] bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 whitespace-nowrap">{unlistBusy ? 'Снимаю…' : 'Снять с листинга'}</button>
                        </div>
                        <p className="text-xs text-gray-500">Машина будет в простое с этой даты («Клейм № …»). Вернётся в работу кнопкой «Завершить».</p>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">Машина снята с листинга — вернётся в работу кнопкой «Завершить».</p>
                    )
                  ) : (
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={form.still_listed} onChange={e => setForm(f => ({ ...f, still_listed: e.target.checked }))} className="w-4 h-4 rounded accent-blue-600" />
                      <span className="text-sm text-gray-700">Машина остаётся в листинге (мелкий ущерб)</span>
                    </label>
                  )}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Заметки</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Описание повреждений, детали клейма..." rows={3} className={`${inputCls} resize-none`} />
              </div>
              <div className="flex gap-3 pt-2">
                {editClaim && (
                  <button type="button" onClick={() => handleDelete(editClaim)} className="px-4 py-2 rounded-lg border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-colors">Удалить</button>
                )}
                <button type="submit" className="flex-1 btn-primary h-11">Сохранить</button>
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 btn-secondary h-11">Отмена</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {finish && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-[2px] flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={e => { if (e.target === e.currentTarget && !finish.busy) setFinish(null) }}>
          <div className="bg-white rounded-t-[22px] sm:rounded-[20px] shadow-2xl p-5 sm:p-6 w-full max-w-sm space-y-4 animate-in" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Завершить клейм</h2>
              <p className="text-sm text-gray-500"><CarTitle c={finish.c} acc={finish.c.car_id ? carAcc[finish.c.car_id] : null} />{finish.c.claim_number ? ` · № ${finish.c.claim_number}` : ''}</p>
            </div>
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 mb-1">Дата завершения (машина в работе с этого дня)</span>
              <DatePicker value={finish.date} onChange={changeFinishDate} />
            </label>
            {finish.block ? (
              <label className="flex items-start gap-2.5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-500/10 p-3 cursor-pointer">
                <input type="checkbox" checked={finish.back} onChange={e => setFinish({ ...finish, back: e.target.checked })} className="mt-0.5 w-4 h-4 accent-emerald-600" />
                <span className="text-sm text-gray-700">
                  <b className="text-gray-900">Вернуть машину в работу</b>
                  <span className="block text-xs text-gray-500 mt-0.5">Простой с {short(finish.block.start_date)}{finish.block.reason ? ` (${finish.block.reason})` : ''} {finish.block.start_date >= finish.date ? 'удалится — он начался в этот же день' : `закончится ${short(format(subDays(parseISO(finish.date), 1), 'yyyy-MM-dd'))}`}</span>
                </span>
              </label>
            ) : finish.c.car_id ? (
              <p className="text-xs text-gray-500">Машина на эту дату не в простое — завершится только клейм.</p>
            ) : null}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setFinish(null)} disabled={finish.busy} className="btn-secondary flex-1 h-11">Отмена</button>
              <button type="button" onClick={saveFinish} disabled={finish.busy || !finish.date} className="btn-primary flex-1 h-11">{finish.busy ? 'Сохраняю…' : 'Завершить'}</button>
            </div>
          </div>
        </div>
      )}
      {pay && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-[2px] flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={e => { if (e.target === e.currentTarget && !pay.busy) setPay(null) }}>
          <div className="bg-white rounded-t-[22px] sm:rounded-[20px] shadow-2xl p-5 sm:p-6 w-full max-w-sm space-y-4 animate-in" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
            <div>
              <h2 className="text-lg font-bold text-gray-900">{pay.kind === 'initial' ? 'Initial получен' : 'Supplement получен'}</h2>
              <p className="text-sm text-gray-500"><CarTitle c={pay.c} acc={pay.c.car_id ? carAcc[pay.c.car_id] : null} />{pay.c.claim_number ? ` · № ${pay.c.claim_number}` : ''}</p>
            </div>
            <div className={pay.kind === 'supplement' ? 'grid grid-cols-[1fr_110px] gap-3' : ''}>
              <label className="block">
                <span className="block text-sm font-medium text-gray-700 mb-1">Сумма, $</span>
                <input autoFocus inputMode="decimal" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value, error: '' })} placeholder="0" className={inputCls} />
              </label>
              {pay.kind === 'supplement' && (
                <label className="block">
                  <span className="block text-sm font-medium text-gray-700 mb-1">Вычет Turo, %</span>
                  <input inputMode="decimal" value={pay.pct} onChange={e => setPay({ ...pay, pct: e.target.value })} className={inputCls} />
                </label>
              )}
            </div>
            <div>
              <span className="block text-sm font-medium text-gray-700 mb-1">В какой месяц «Доходов»</span>
              <MonthPicker value={pay.month} onChange={m => setPay({ ...pay, month: m })} min={format(subMonths(new Date(), 12), 'yyyy-MM')} max={format(addMonths(new Date(), 1), 'yyyy-MM')} className="w-full" />
            </div>
            {pay.kind === 'supplement' && Number(pay.amount) > 0 && (
              <p className="text-xs text-gray-500">В «Доходы» попадёт {Number(pay.amount).toLocaleString('en-US')} − вычет {pay.pct || 0}% = <b>${(Number(pay.amount) * (1 - (Number(pay.pct) || 0) / 100)).toLocaleString('en-US', { maximumFractionDigits: 2 })}</b></p>
            )}
            {!canAny(access, ['/income']) && <p className="text-xs text-orange-600">У вас нет доступа к «Доходам» — сумма сохранится только в клейме.</p>}
            {pay.error && <p className="text-sm text-red-600">{pay.error}</p>}
            <div className="flex gap-2 pt-1">
              {(pay.kind === 'initial' ? pay.c.initial_payment_received : pay.c.supplement_paid) && (
                <button type="button" onClick={clearPay} disabled={pay.busy} className="h-11 px-3 rounded-[10px] border border-red-200 text-red-500 text-sm font-semibold hover:bg-red-50">Снять</button>
              )}
              <button type="button" onClick={() => setPay(null)} disabled={pay.busy} className="btn-secondary flex-1 h-11">Отмена</button>
              <button type="button" onClick={savePay} disabled={pay.busy} className="btn-primary flex-1 h-11">{pay.busy ? 'Сохраняю…' : 'Сохранить'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

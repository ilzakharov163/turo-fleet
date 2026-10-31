'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MessageSquare, ShieldCheck, Lightbulb, Play, Mic, Image as ImageIcon, Wrench, CheckCircle2, AlertTriangle, Hand, Reply, RefreshCw, ArrowRight } from 'lucide-react'
import { format, parseISO, isToday, startOfMonth } from 'date-fns'
import { ru } from 'date-fns/locale'
import { createClient } from '@/lib/supabase'
import { notify } from '@/lib/ui'

// Настройки → Агенты (только админ): кто из агентов что делал — каждый запуск по шагам (agent_runs / agent_steps).
// Учётчик — Telegram-бот; Ревизор (каждый день) и Советник (по понедельникам) — по расписанию Vercel Cron, можно запустить вручную.

interface Run {
  id: string; agent: string; user_id: string | null; input: string | null; output: string | null
  status: 'running' | 'done' | 'waiting' | 'error'; input_tokens: number; output_tokens: number; created_at: string
  agent_steps: { id: number; kind: string; text: string }[]
}

// Claude Opus 5.5: $4 за 1 млн входных токенов, $20 за 1 млн выходных (кэш считаем как обычный вход — оценка сверху)
const cost = (r: Pick<Run, 'input_tokens' | 'output_tokens'>) => (r.input_tokens * 4 + r.output_tokens * 20) / 1_000_000

const TOOL_LABELS: Record<string, string> = {
  add_expense: 'Записал расход', put_idle: 'Подготовил простой', return_to_work: 'Подготовил возврат в работу',
  add_claim: 'Подготовил новый клейм', update_claim: 'Подготовил изменение клейма', complete_claim: 'Подготовил завершение клейма',
  claim_payment: 'Подготовил выплату по клейму', add_deduction: 'Подготовил вычет из зарплаты', set_gross: 'Подготовил Gross',
  set_car_payment: 'Подготовил платёж за машину', set_expense_paid: 'Подготовил отметку оплаты', delete_expense: 'Подготовил удаление расхода',
  remove_car: 'Подготовил «продана/разбита»', list_claims: 'Посмотрел клеймы', list_expenses: 'Посмотрел расходы',
  list_downtime: 'Посмотрел простои', income_summary: 'Посмотрел доходы', salary_summary: 'Посчитал зарплату',
  add_car: 'Подготовил новую машину', update_car: 'Подготовил правку машины', list_removed_cars: 'Посмотрел убранные машины',
  restore_car: 'Подготовил возврат машины', stickers_status: 'Посмотрел наклейки', replace_sticker: 'Подготовил замену наклейки',
  update_downtime: 'Подготовил правку простоя', delete_downtime: 'Подготовил удаление простоя', delete_claim: 'Подготовил удаление клейма',
  undo_claim_payment: 'Подготовил снятие выплаты', update_expense: 'Подготовил правку расхода', delete_deduction: 'Подготовил удаление вычета',
  income_car: 'Посмотрел доходы машины', month_costs: 'Посмотрел расходы месяца', income_history: 'Посмотрел прибыль по месяцам',
  set_repair: 'Подготовил ремонт', add_car_other: 'Подготовил «Прочее»', remove_car_other: 'Подготовил удаление «Прочего»',
  set_staff_costs: 'Подготовил затраты на сотрудника', add_company_expense: 'Подготовил расход компании', remove_company_expense: 'Подготовил удаление расхода компании',
  add_payment: 'Подготовил платёж', update_payment: 'Подготовил правку платежа', delete_payment: 'Подготовил удаление платежа',
  add_car_to_account: 'Подготовил перенос в аккаунт',
}

const AGENT_NAME: Record<string, string> = { bookkeeper: 'Учётчик', auditor: 'Ревизор', advisor: 'Советник', reader: 'Чтение чека' }

const STEP_ICON: Record<string, typeof Wrench> = { voice: Mic, photo: ImageIcon, tool: Wrench, confirm: Hand, write: CheckCircle2, error: AlertTriangle }

function stepText(s: Run['agent_steps'][number]) {
  if (s.kind === 'voice') return `Распознал голос: «${s.text}»`
  if (s.kind === 'confirm') return `Ждёт кнопки «Записать»: ${s.text}`
  if (s.kind === 'tool') {
    const [name, ...rest] = s.text.split(': ')
    // У чтения результат — служебная выгрузка (id записей), его не показываем; ответ человеку виден ниже
    const result = /^(list_|income_|salary_|month_costs|stickers_status)/.test(name) && !rest.join(': ').startsWith('Ошибка') ? '' : rest.join(': ')
    return `${TOOL_LABELS[name] || name}${result ? ` — ${result}` : ''}`
  }
  return s.text
}

const STATUS: Record<Run['status'], { label: string; cls: string }> = {
  done: { label: 'Готово', cls: 'bg-emerald-50 text-emerald-600' },
  waiting: { label: 'Ждёт «Записать»', cls: 'bg-indigo-50 text-[#4F46E5] dark:text-indigo-300' },
  running: { label: 'Работает…', cls: 'bg-amber-50 text-amber-600' },
  error: { label: 'Ошибка', cls: 'bg-rose-50 text-rose-500' },
}

export default function AgentsView() {
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [person, setPerson] = useState('')
  const [busy, setBusy] = useState('')                      // какой агент запускаем вручную
  const [noCron, setNoCron] = useState(false)              // в Vercel нет CRON_SECRET — расписание не сработает

  const load = useCallback(async () => {
    const supabase = createClient()
    const [runsRes, teamRes] = await Promise.all([
      supabase.from('agent_runs').select('id, agent, user_id, input, output, status, input_tokens, output_tokens, created_at, agent_steps(id, kind, text)')
        .order('created_at', { ascending: false }).limit(100),
      supabase.rpc('list_team'),
    ])
    setRuns(((runsRes.data || []) as Run[]).map(r => ({ ...r, agent_steps: [...(r.agent_steps || [])].sort((a, b) => a.id - b.id) })))
    setNames(Object.fromEntries(((teamRes.data || []) as { id: string; full_name: string | null; email: string }[]).map(u => [u.id, u.full_name || u.email.split('@')[0]])))
  }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- загрузка данных при открытии
  useEffect(() => { load() }, [load])
  useEffect(() => {
    fetch('/api/telegram/setup').then(r => (r.ok ? r.json() : null)).then(j => setNoCron(!!j?.missing?.includes('CRON_SECRET'))).catch(() => {})
  }, [])

  async function runNow(agent: 'auditor' | 'advisor') {
    setBusy(agent)
    const res = await fetch(`/api/agents/${agent}`, { method: 'POST' })
    setBusy('')
    if (!res.ok) { notify('Не получилось запустить', 'error'); return }
    notify(agent === 'auditor' ? 'Ревизор проверил данные и написал в Telegram' : 'Советник прислал идеи в Telegram', 'success')
    load()
  }

  const shown = useMemo(() => (runs || []).filter(r => !person || r.user_id === person), [runs, person])
  const stats = useMemo(() => {
    const all = runs || []
    const month = all.filter(r => parseISO(r.created_at) >= startOfMonth(new Date()))
    const book = all.filter(r => r.agent === 'bookkeeper')
    const last = (agent: string) => all.find(r => r.agent === agent) || null
    return {
      auditor: last('auditor'), advisor: last('advisor'),
      today: book.filter(r => isToday(parseISO(r.created_at))).length,
      waiting: book.filter(r => r.status === 'waiting').length,
      errors: book.filter(r => r.status === 'error' && isToday(parseISO(r.created_at))).length,
      monthCost: month.reduce((s, r) => s + cost(r), 0),
    }
  }, [runs])
  const people = useMemo(() => [...new Set((runs || []).map(r => r.user_id).filter(Boolean))] as string[], [runs])

  if (!runs) return <div className="space-y-3">{[0, 1, 2].map(i => <div key={i} className="skeleton h-24" />)}</div>

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Как это работает */}
      <div className="bg-white rounded-[18px] p-5 card-shadow border border-gray-100/80">
        <p className="text-sm font-semibold text-gray-900 mb-3">Как работает Учётчик</p>
        <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
          {['Сообщение в Telegram', 'Claude понимает, что произошло', 'Вызывает действия сайта', 'Отвечает / кнопка «Записать»', 'Запись в базе + «История»'].map((t, i, a) => (
            <span key={t} className="inline-flex items-center gap-2">
              <span className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-gray-700">{t}</span>
              {i < a.length - 1 && <ArrowRight size={14} className="text-gray-300" />}
            </span>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-3">Ревизор и Советник просыпаются по расписанию, смотрят базу и пишут владельцам в Telegram — на их сообщение можно ответить боту, и Учётчик подготовит исправление. Ниже — каждый запуск по шагам. Клеймы, простои, доходы и удаления агент только готовит: в базу они попадают после кнопки «Записать». Расходы пишет сразу (кнопка «Отменить» сутки).</p>
      </div>

      {/* Агенты */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-[18px] p-4 card-shadow border border-gray-100/80">
          <p className="flex items-center gap-2 text-sm font-semibold text-gray-900"><span className="w-8 h-8 rounded-xl bg-indigo-50 text-[#4F46E5] dark:text-indigo-300 flex items-center justify-center"><MessageSquare size={16} /></span> Учётчик</p>
          <p className="text-xs text-gray-500 mt-2"><span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1.5" />Работает · сегодня {stats.today}{stats.waiting ? ` · ждут «Записать»: ${stats.waiting}` : ''}{stats.errors ? ` · ошибок: ${stats.errors}` : ''}</p>
          <p className="text-xs text-gray-400 mt-1 tabular-nums">Claude за месяц (все агенты и чтение чеков) ≈ ${stats.monthCost.toFixed(2)}</p>
        </div>
        {([
          { key: 'auditor', icon: ShieldCheck, name: 'Ревизор', when: 'Каждый день ~10:00', text: 'проверяет, что данные сходятся; пишет, только если нашёл проблему' },
          { key: 'advisor', icon: Lightbulb, name: 'Советник', when: 'По понедельникам ~9:00', text: 'присылает 2–3 идеи улучшений по фактам недели' },
        ] as const).map(a => {
          const last = stats[a.key]
          return (
            <div key={a.key} className="bg-white rounded-[18px] p-4 card-shadow border border-gray-100/80">
              <p className="flex items-center gap-2 text-sm font-semibold text-gray-900"><span className="w-8 h-8 rounded-xl bg-indigo-50 text-[#4F46E5] dark:text-indigo-300 flex items-center justify-center"><a.icon size={16} /></span> {a.name}</p>
              <p className="text-xs text-gray-500 mt-2"><span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${noCron ? 'bg-amber-400' : 'bg-emerald-500'}`} />{a.when} · {a.text}</p>
              <p className="text-xs text-gray-400 mt-1">{last ? `Последний запуск: ${format(parseISO(last.created_at), 'd MMM, HH:mm', { locale: ru })}${last.status === 'error' ? ' — ошибка' : ''}` : 'Ещё не запускался'}</p>
              {noCron && <p className="text-xs text-amber-600 mt-1">Расписание не включено: в Vercel нет CRON_SECRET</p>}
              <button type="button" disabled={!!busy} onClick={() => runNow(a.key)} className="btn-secondary inline-flex items-center gap-1.5 mt-3"><Play size={14} /> {busy === a.key ? 'Работает…' : 'Запустить сейчас'}</button>
            </div>
          )
        })}
      </div>

      {/* Лента */}
      <div className="bg-white rounded-[18px] card-shadow border border-gray-100/80">
        <div className="flex flex-wrap items-center gap-2 px-4 sm:px-5 py-3 border-b border-gray-100">
          <p className="text-sm font-semibold text-gray-900 mr-auto">Что делали агенты</p>
          <select value={person} onChange={e => setPerson(e.target.value)} className="h-9 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-700">
            <option value="">Все люди</option>
            {people.map(id => <option key={id} value={id}>{names[id] || 'Без имени'}</option>)}
          </select>
          <button type="button" onClick={load} className="btn-secondary inline-flex items-center gap-1.5"><RefreshCw size={14} /> Обновить</button>
        </div>
        {!shown.length && <p className="px-5 py-10 text-center text-sm text-gray-400">Пока пусто — напишите что-нибудь боту в Telegram.</p>}
        {shown.map(r => (
          <div key={r.id} className="px-4 sm:px-5 py-3.5 border-b border-gray-100 last:border-0">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 break-words">{r.input || (r.agent_steps.some(s => s.kind === 'photo') ? 'Фото чека' : r.agent_steps.some(s => s.kind === 'voice') ? 'Голосовое' : 'Сообщение')}</p>
                <p className="text-xs text-gray-400 mt-0.5">{format(parseISO(r.created_at), 'd MMM, HH:mm', { locale: ru })} · {AGENT_NAME[r.agent] || r.agent}{r.user_id ? ` · ${names[r.user_id] || 'Без имени'}` : ''}{r.input_tokens ? ` · ≈ $${cost(r).toFixed(3)}` : ''}</p>
              </div>
              <span className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
            </div>
            {(r.agent_steps.length > 0 || r.output) && (
              <div className="mt-2 space-y-1 border-l-2 border-gray-100 pl-3">
                {r.agent_steps.map(s => {
                  const Icon = STEP_ICON[s.kind] || Wrench
                  return <p key={s.id} className={`flex gap-2 text-xs ${s.kind === 'error' || s.text.includes('Ошибка') || s.text.startsWith('✗') ? 'text-rose-500' : 'text-gray-600'}`}><Icon size={13} className="shrink-0 mt-0.5 text-gray-400" /><span className="break-words">{stepText(s)}</span></p>
                })}
                {r.output && r.input !== '«Записать»' && <p className="flex gap-2 text-xs text-gray-500"><Reply size={13} className="shrink-0 mt-0.5 text-gray-400" /><span className="break-words whitespace-pre-line">{r.output}</span></p>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

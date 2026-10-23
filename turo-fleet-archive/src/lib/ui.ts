// Сообщения и подтверждения вместо системных alert/confirm.
// Показываются компонентом <Feedback /> (components/ui/Feedback.tsx) в общем каркасе приложения.

export type Tone = 'error' | 'success' | 'info'
export interface Toast { id: number; text: string; tone: Tone }
export interface Ask { text: string; detail?: string; ok: string; danger: boolean; resolve: (v: boolean) => void }

interface State { toasts: Toast[]; ask: Ask | null }

let state: State = { toasts: [], ask: null }
const listeners = new Set<() => void>()
const emit = (next: Partial<State>) => { state = { ...state, ...next }; listeners.forEach(l => l()) }

export const uiStore = {
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } },
  get: () => state,
}

let seq = 0
export function notify(text: string, tone: Tone = 'info') {
  // Одинаковое сообщение подряд не дублируем
  if (state.toasts.some(t => t.text === text)) return
  const id = ++seq
  emit({ toasts: [...state.toasts, { id, text, tone }].slice(-3) })
  setTimeout(() => emit({ toasts: state.toasts.filter(t => t.id !== id) }), tone === 'error' ? 6000 : 2500)
}

export function dismissToast(id: number) {
  emit({ toasts: state.toasts.filter(t => t.id !== id) })
}

// const ok = await ask('Удалить клейм?', { ok: 'Удалить', danger: true })
export function ask(text: string, opts: { detail?: string; ok?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise(resolve => {
    state.ask?.resolve(false)
    emit({ ask: { text, detail: opts.detail, ok: opts.ok || 'Да', danger: opts.danger ?? false, resolve } })
  })
}

export function answer(v: boolean) {
  const a = state.ask
  emit({ ask: null })
  a?.resolve(v)
}

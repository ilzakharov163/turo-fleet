// Reusable page wrapper — consistent card style

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-[18px] card-shadow border border-gray-100/80 ${className}`}>
      {children}
    </div>
  )
}

export function PageHeader({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-between mb-6">{children}</div>
}

export function PrimaryButton({ children, onClick, type = 'button' }: {
  children: React.ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className="btn-primary flex items-center gap-2 px-5 py-2.5"
    >
      {children}
    </button>
  )
}

export function Modal({ children, title, onClose }: {
  children: React.ReactNode
  title: string
  onClose: () => void
}) {
  return (
    // На телефоне — панель снизу, на компьютере — окно по центру
    <div className="fixed inset-0 bg-black/30 backdrop-blur-[2px] flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-t-[22px] sm:rounded-[20px] shadow-2xl w-full max-w-md max-h-[92vh] overflow-y-auto animate-in" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-700 transition-colors text-base leading-none"
          >
            ✕
          </button>
        </div>
        <div className="p-5 sm:p-6">{children}</div>
      </div>
    </div>
  )
}

export function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1.5">{label}</label>
      {children}
    </div>
  )
}

export const inputCls = "w-full border border-gray-200 rounded-[12px] px-3.5 py-2.5 text-base sm:text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400/30 focus:border-indigo-400 transition-all placeholder:text-gray-400"

export function ModalActions({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-3 pt-2">{children}</div>
}

export function SaveButton({ loading = false, label }: { loading?: boolean; label?: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="btn-primary flex-1 h-11"
    >
      {loading ? 'Сохраняем...' : (label || 'Сохранить')}
    </button>
  )
}

export function CancelButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn-secondary flex-1 h-11"
    >
      Отмена
    </button>
  )
}

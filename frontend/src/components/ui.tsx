import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
}) {
  const variants: Record<string, string> = {
    primary:
      'bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm disabled:bg-indigo-900 disabled:text-slate-400',
    secondary:
      'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-50',
    danger: 'bg-rose-700 hover:bg-rose-600 text-white disabled:opacity-50',
    ghost: 'hover:bg-slate-800 text-slate-300 disabled:opacity-50',
  }
  return (
    <button
      className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors cursor-pointer disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...props}
    />
  )
}

export function Input({
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 ${className}`}
      {...props}
    />
  )
}

export function Select({
  className = '',
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 ${className}`}
      {...props}
    />
  )
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
      {children}
    </label>
  )
}

export function Card({
  title,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-900/60 ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
          <div className="flex gap-2">{actions}</div>
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  )
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-10"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={`w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-xl border border-slate-700 bg-slate-900 shadow-2xl`}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <h3 className="text-base font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-800 text-slate-300 border-slate-600',
  quoted: 'bg-sky-950 text-sky-300 border-sky-800',
  won: 'bg-emerald-950 text-emerald-300 border-emerald-800',
  lost: 'bg-rose-950 text-rose-300 border-rose-800',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${
        STATUS_STYLES[status] ?? STATUS_STYLES.draft
      }`}
    >
      {status}
    </span>
  )
}

export function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-indigo-500" />
    </div>
  )
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-rose-800 bg-rose-950/60 px-4 py-3 text-sm text-rose-200">
      {message}
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-700 px-6 py-10 text-center text-sm text-slate-500">
      {children}
    </div>
  )
}

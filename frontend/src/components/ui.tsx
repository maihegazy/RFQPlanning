import {
  useEffect,
  useId,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'

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

const INPUT_CLASS =
  'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500'

/**
 * A number field that keeps what the user is typing.
 *
 * Callers store `Number(e.target.value)` and pass the number back as `value`,
 * so a cleared field used to snap straight back to "0" and typing a new
 * figure meant fighting a leading zero. While the field has focus it shows the
 * typed text as is (empty included); the parent still receives every change,
 * and the stored value is shown again on blur.
 */
function NumberInput({
  className = '',
  value,
  onFocus,
  onChange,
  onBlur,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  const [draft, setDraft] = useState<string | null>(null)
  const stored = value === undefined || value === null ? '' : String(value)
  return (
    <input
      {...props}
      type="number"
      className={`${INPUT_CLASS} ${className}`}
      value={draft ?? stored}
      onFocus={(e) => {
        setDraft(stored)
        onFocus?.(e)
      }}
      onChange={(e) => {
        setDraft(e.target.value)
        onChange?.(e)
      }}
      onBlur={(e) => {
        setDraft(null)
        onBlur?.(e)
      }}
    />
  )
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  if (props.type === 'number') return <NumberInput className={className} {...props} />
  return <input className={`${INPUT_CLASS} ${className}`} {...props} />
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 ${className}`}
      {...props}
    />
  )
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400"
    >
      {children}
    </label>
  )
}

/** The secondary button's look on a real link, for downloads the browser performs itself. */
export function LinkButton({ className = '', ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700 ${className}`}
      {...props}
    />
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

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * A dialog the keyboard can use: it announces itself, takes focus when it
 * opens, keeps Tab inside, closes on Escape, and hands focus back to the
 * control that opened it when it closes.
 */
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  size,
  closeHint,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
  /** Overrides `wide`: md = default dialog, lg = form dialog, xl = data table */
  size?: 'md' | 'lg' | 'xl'
  /** Shown on the close button when closing is not what the user expects. */
  closeHint?: string
}) {
  const maxWidth = {
    md: 'max-w-lg',
    lg: 'max-w-3xl',
    xl: 'max-w-6xl',
  }[size ?? (wide ? 'lg' : 'md')]
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // The focus choreography needs a real DOM; the test renderer has none.
    if (typeof document === 'undefined') return
    const opener = document.activeElement as HTMLElement | null
    const node = panel.current
    if (node) {
      // Prefer the first field or button, but never the close button, so a
      // form dialog starts in its first input and a message dialog on "Done".
      const targets = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.getAttribute('aria-label') !== 'Close',
      )
      const autofocused = targets.find((el) => el.hasAttribute('autofocus'))
      ;(autofocused ?? targets[0] ?? node).focus()
    }
    return () => {
      opener?.focus?.()
    }
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !panel.current || typeof document === 'undefined') return
    const targets = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (targets.length === 0) return
    const first = targets[0]
    const last = targets[targets.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-10"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`w-full ${maxWidth} rounded-xl border border-slate-700 bg-slate-900 shadow-2xl outline-none`}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <h3 id={titleId} className="text-base font-semibold">
            {title}
          </h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            aria-label="Close"
            title={closeHint}
          >
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

/**
 * The styled stand-in for `window.confirm`: a question, a plain answer and a
 * cancel, in the same dialog as everything else in the app.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  danger = true,
  onConfirm,
  onCancel,
}: {
  title: string
  message: ReactNode
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="space-y-4">
        <p className="text-sm text-slate-300">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** The styled stand-in for `window.prompt`: one text field and a submit. */
export function PromptDialog({
  title,
  label,
  initialValue = '',
  submitLabel = 'OK',
  onSubmit,
  onCancel,
}: {
  title: string
  label: string
  initialValue?: string
  submitLabel?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initialValue)
  const trimmed = value.trim()
  return (
    <Modal title={title} onClose={onCancel}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (trimmed !== '') onSubmit(trimmed)
        }}
      >
        <div>
          <Label>{label}</Label>
          <Input
            aria-label={label}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={trimmed === ''}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** A headline figure with its label: the one tile every dashboard uses. */
export function KpiTile({
  label,
  value,
  hint,
  tone = 'default',
  children,
}: {
  label: string
  /** null renders an ellipsis: the figure is still being computed. */
  value: string | null
  hint?: string
  tone?: 'default' | 'warning'
  children?: ReactNode
}) {
  const warning = tone === 'warning'
  return (
    <div
      className={`rounded-xl border p-4 ${
        warning ? 'border-rose-800 bg-rose-950/40' : 'border-slate-800 bg-slate-900/60'
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-1 text-xl font-bold tabular-nums ${
          warning ? 'text-rose-300' : 'text-slate-100'
        }`}
      >
        {value ?? '…'}
      </p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {children}
    </div>
  )
}

/** A small count with its label, for a row of quick figures. */
export function Stat({
  label,
  value,
  tone = 'text-slate-100',
  size = 'md',
}: {
  label: string
  value: string | number
  tone?: string
  size?: 'sm' | 'md'
}) {
  const small = size === 'sm'
  return (
    <div
      className={`rounded-xl border border-slate-800 bg-slate-900/60 ${
        small ? 'rounded-lg px-3 py-2' : 'px-4 py-3'
      }`}
    >
      <div className={`font-semibold tabular-nums ${small ? 'text-base' : 'text-2xl'} ${tone}`}>
        {value}
      </div>
      <div className={`text-xs text-slate-500 ${small ? '' : 'mt-0.5 uppercase tracking-wide'}`}>
        {label}
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

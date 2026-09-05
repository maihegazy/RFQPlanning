import { formatEuro } from '../utils'
import { Input, Label } from './ui'

/**
 * The register is wider than any screen once the year columns are in, so the
 * name column is pinned — the frozen first column the working document used,
 * in CSS. A pinned cell needs an opaque background or the scrolling columns
 * show through it.
 */
export const PINNED_LEFT = 'sticky left-0 z-20 border-r border-slate-800 bg-slate-900'

/** The row counts towards no year; the title says why, in the server's words. */
export function UncountedPill({ reason }: { reason: string }) {
  return (
    <span
      title={reason}
      className="ml-2 rounded-full border border-rose-900 bg-rose-950 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-rose-300"
    >
      not counted
    </span>
  )
}

export function PlannedPill() {
  return (
    <span className="ml-2 rounded-full border border-amber-800 bg-amber-950 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-amber-300">
      planned
    </span>
  )
}

/** One computed money cell. Planned money is muted: it is not committed spend. */
export function CostCell({ value, planned }: { value: number; planned: boolean }) {
  if (value === 0) return <span className="text-slate-600">—</span>
  return (
    <span className={planned ? 'italic text-slate-500' : 'text-slate-200'}>
      {formatEuro(value)}
    </span>
  )
}

export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        aria-label={label}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

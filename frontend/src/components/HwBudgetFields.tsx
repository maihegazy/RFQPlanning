import type { HwBudgetMode } from '../types'
import { formatEuro } from '../utils'
import { Input, Label } from './ui'

/**
 * The budget half of the hardware-project dialogs.
 *
 * A budget is approved either as one number or split between assets and
 * licenses, and which of the two is authoritative has to be recorded — not
 * guessed from whether a field happens to be zero. The figures for the mode
 * that is not in use are kept, not cleared, so switching back and forth does
 * not lose what was typed.
 */

export interface BudgetDraft {
  mode: HwBudgetMode
  total: string
  assets: string
  licenses: string
}

const MODES: { value: HwBudgetMode; label: string; hint: string }[] = [
  { value: 'overall', label: 'One overall budget', hint: 'A single approved figure' },
  { value: 'split', label: 'Split by type', hint: 'Separate assets and licenses budgets' },
]

export function toAmount(raw: string): number {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : 0
}

/** What the project actually has to spend, whichever way it was entered. */
export function effectiveBudget(draft: BudgetDraft): number {
  return draft.mode === 'overall'
    ? toAmount(draft.total)
    : toAmount(draft.assets) + toAmount(draft.licenses)
}

/** The four budget fields of `HwProjectInput`, ready to send. */
export function budgetPayload(draft: BudgetDraft) {
  return {
    budget_mode: draft.mode,
    budget_total: toAmount(draft.total),
    budget_assets: toAmount(draft.assets),
    budget_licenses: toAmount(draft.licenses),
  }
}

export function draftFromProject(project: {
  budget_mode: HwBudgetMode
  budget_total: number
  budget_assets: number
  budget_licenses: number
}): BudgetDraft {
  return {
    mode: project.budget_mode,
    total: String(project.budget_total),
    assets: String(project.budget_assets),
    licenses: String(project.budget_licenses),
  }
}

export const EMPTY_BUDGET: BudgetDraft = {
  mode: 'overall',
  total: '0',
  assets: '0',
  licenses: '0',
}

/**
 * The "Assets X · Licenses Y" caption for a budget tile, or null when it would
 * lie: an overall budget has no split, so the two components sum to less than
 * the total and showing them would imply money that is not accounted for.
 */
export function budgetBreakdown(dashboard: {
  budget_total: number
  budget_assets: number
  budget_licenses: number
}): string | null {
  const split = dashboard.budget_assets + dashboard.budget_licenses
  if (dashboard.budget_total <= 0 || Math.abs(split - dashboard.budget_total) > 0.01) {
    return null
  }
  return `Assets ${formatEuro(dashboard.budget_assets)} · Licenses ${formatEuro(
    dashboard.budget_licenses,
  )}`
}

export default function HwBudgetFields({
  draft,
  onChange,
}: {
  draft: BudgetDraft
  onChange: (next: BudgetDraft) => void
}) {
  const patch = (next: Partial<BudgetDraft>) => onChange({ ...draft, ...next })
  const active = MODES.find((m) => m.value === draft.mode) ?? MODES[0]

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Label>Budget</Label>
        <div
          role="radiogroup"
          aria-label="How the budget is entered"
          className="inline-flex rounded-lg border border-slate-700 bg-slate-900 p-0.5"
        >
          {MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              role="radio"
              aria-checked={draft.mode === mode.value}
              onClick={() => patch({ mode: mode.value })}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                draft.mode === mode.value
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      {draft.mode === 'overall' ? (
        <div className="sm:max-w-xs">
          <Label>Overall budget (€)</Label>
          <Input
            aria-label="Overall budget (€)"
            type="number"
            step="0.01"
            min="0"
            value={draft.total}
            onChange={(e) => patch({ total: e.target.value })}
          />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Assets budget (€)</Label>
            <Input
              aria-label="Assets budget (€)"
              type="number"
              step="0.01"
              min="0"
              value={draft.assets}
              onChange={(e) => patch({ assets: e.target.value })}
            />
          </div>
          <div>
            <Label>Licenses budget (€)</Label>
            <Input
              aria-label="Licenses budget (€)"
              type="number"
              step="0.01"
              min="0"
              value={draft.licenses}
              onChange={(e) => patch({ licenses: e.target.value })}
            />
          </div>
        </div>
      )}

      <p className="mt-2 text-xs text-slate-500">
        {active.hint} · Overall budget {formatEuro(effectiveBudget(draft))}
        {draft.mode === 'overall'
          ? '. The assets and licenses split stays unknown until you switch.'
          : '.'}
      </p>
    </div>
  )
}

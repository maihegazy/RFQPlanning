import { BUDGET_MODES, effectiveBudget, type BudgetDraft } from '../hardware/budget'
import { formatEuro } from '../utils'
import { Input, Label } from './ui'

/**
 * The budget half of the hardware-project dialogs: a mode switch and the
 * amount fields for the mode in use. The rules (what counts, what is sent)
 * live in `hardware/budget.ts`.
 */
export default function HwBudgetFields({
  draft,
  onChange,
}: {
  draft: BudgetDraft
  onChange: (next: BudgetDraft) => void
}) {
  const patch = (next: Partial<BudgetDraft>) => onChange({ ...draft, ...next })
  const active = BUDGET_MODES.find((m) => m.value === draft.mode) ?? BUDGET_MODES[0]

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Label>Budget</Label>
        <div
          role="radiogroup"
          aria-label="How the budget is entered"
          className="inline-flex rounded-lg border border-slate-700 bg-slate-900 p-0.5"
        >
          {BUDGET_MODES.map((mode) => (
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

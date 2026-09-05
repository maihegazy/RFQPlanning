import { FIRST_YEAR, LAST_YEAR } from '../hardware/depreciation'
import { yearOrNull, type PlanningWindowDraft } from '../hardware/planningWindow'
import { Input, Label } from './ui'

/**
 * Start and end year of the budget horizon. Optional: with nothing entered the
 * summary spans the years the registers touch; with a window it always spans
 * at least these years, so an empty project still shows its whole horizon.
 */
export default function PlanningWindowFields({
  draft,
  onChange,
}: {
  draft: PlanningWindowDraft
  onChange: (next: PlanningWindowDraft) => void
}) {
  const start = yearOrNull(draft.start)
  const end = yearOrNull(draft.end)
  const backwards = start !== null && end !== null && start > end
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <Label>Planning window (optional)</Label>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>First year</Label>
          <Input
            aria-label="First planning year"
            type="number"
            min={FIRST_YEAR}
            max={LAST_YEAR}
            step={1}
            value={draft.start}
            placeholder="e.g. 2026"
            onChange={(e) => onChange({ ...draft, start: e.target.value })}
          />
        </div>
        <div>
          <Label>Last year</Label>
          <Input
            aria-label="Last planning year"
            type="number"
            min={FIRST_YEAR}
            max={LAST_YEAR}
            step={1}
            value={draft.end}
            placeholder="e.g. 2028"
            onChange={(e) => onChange({ ...draft, end: e.target.value })}
          />
        </div>
      </div>
      <p className={`mt-2 text-xs ${backwards ? 'text-rose-300' : 'text-slate-500'}`}>
        {backwards
          ? 'The first year must not be after the last year.'
          : 'The summary always covers these years, so the budget horizon shows before anything is bought.'}
      </p>
    </div>
  )
}

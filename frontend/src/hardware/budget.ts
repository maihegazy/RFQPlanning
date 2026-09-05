/**
 * The budget half of a hardware project, as the dialogs edit it.
 *
 * A budget is approved either as one number or split between assets and
 * licenses, and which of the two is authoritative has to be recorded, not
 * guessed from whether a field happens to be zero. The figures for the mode
 * that is not in use are kept, not cleared, so switching back and forth does
 * not lose what was typed.
 */

import type { HwBudgetMode } from '../types'
import { formatEuro } from '../utils'

export interface BudgetDraft {
  mode: HwBudgetMode
  total: string
  assets: string
  licenses: string
}

export const BUDGET_MODES: { value: HwBudgetMode; label: string; hint: string }[] = [
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

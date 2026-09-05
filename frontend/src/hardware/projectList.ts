/**
 * How the hardware project list is sorted and searched.
 *
 * Kept beside the other hardware helpers rather than in the table component,
 * so the rules can be tested and reused without rendering anything.
 */

import type { HwProjectRollup } from '../types'

export type HwProjectSortKey =
  | 'name'
  | 'company'
  | 'asset_count'
  | 'license_count'
  | 'effective_budget'
  | 'actual_total'
  | 'planned_total'
  | 'remaining'
  | 'utilisation'

export type SortDir = 'asc' | 'desc'

export const PROJECT_COLUMNS: { key: HwProjectSortKey; label: string; numeric: boolean }[] = [
  { key: 'name', label: 'Project', numeric: false },
  { key: 'company', label: 'Company', numeric: false },
  { key: 'asset_count', label: 'Assets', numeric: true },
  { key: 'license_count', label: 'Licenses', numeric: true },
  { key: 'effective_budget', label: 'Budget', numeric: true },
  { key: 'actual_total', label: 'Committed', numeric: true },
  { key: 'planned_total', label: 'Planned', numeric: true },
  { key: 'remaining', label: 'Remaining', numeric: true },
  { key: 'utilisation', label: 'Utilisation', numeric: true },
]

export function sortValue(project: HwProjectRollup, key: HwProjectSortKey): string | number {
  switch (key) {
    case 'name':
      return project.name.toLowerCase()
    case 'company':
      return project.company.toLowerCase()
    // Projects without a budget have no utilisation; -1 parks them at the end.
    case 'utilisation':
      return project.effective_budget > 0 ? project.actual_total / project.effective_budget : -1
    default:
      return project[key]
  }
}

/** Names read best A→Z; money and counts read best largest-first. */
export function defaultSortDir(key: HwProjectSortKey): SortDir {
  return key === 'name' || key === 'company' ? 'asc' : 'desc'
}

/** The rows a search box and a sort choice leave, in that order. */
export function visibleProjects(
  projects: HwProjectRollup[],
  query: string,
  sortKey: HwProjectSortKey,
  sortDir: SortDir,
): HwProjectRollup[] {
  const needle = query.trim().toLowerCase()
  const filtered = needle
    ? projects.filter(
        (p) => p.name.toLowerCase().includes(needle) || p.company.toLowerCase().includes(needle),
      )
    : [...projects]
  filtered.sort((a, b) => {
    const left = sortValue(a, sortKey)
    const right = sortValue(b, sortKey)
    const cmp =
      typeof left === 'string' && typeof right === 'string'
        ? left.localeCompare(right)
        : Number(left) - Number(right)
    return sortDir === 'asc' ? cmp : -cmp
  })
  return filtered
}

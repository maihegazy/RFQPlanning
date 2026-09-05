import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, ArrowUpDown, TriangleAlert } from 'lucide-react'
import type { HwProjectRollup } from '../types'
import { PROJECT_COLUMNS, type HwProjectSortKey, type SortDir } from '../hardware/projectList'
import { share, utilisationTone } from '../hardware/utilisation'
import { formatEuro, formatNumber } from '../utils'

/**
 * The sortable list of hardware projects, one row per purchasing project.
 *
 * It lives on the Hardware Projects page and is kept as its own component so
 * the list has a single definition wherever it is shown.
 */

export function UtilisationCell({ used, budget }: { used: number; budget: number }) {
  if (!(budget > 0)) return <span className="text-xs text-slate-600">no budget</span>
  const ratio = (used / budget) * 100
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full ${utilisationTone(ratio)}`}
          style={{ width: `${share(used, budget)}%` }}
        />
      </div>
      <span
        className={`w-11 shrink-0 text-right text-xs tabular-nums ${
          ratio > 100 ? 'text-rose-300' : 'text-slate-400'
        }`}
      >
        {formatNumber(ratio, 0)}%
      </span>
    </div>
  )
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 text-slate-600" strokeWidth={2} />
  return dir === 'asc' ? (
    <ArrowUp className="h-3 w-3" strokeWidth={2} />
  ) : (
    <ArrowDown className="h-3 w-3" strokeWidth={2} />
  )
}

export default function HwProjectsTable({
  projects,
  sortKey,
  sortDir,
  onSort,
}: {
  projects: HwProjectRollup[]
  sortKey: HwProjectSortKey
  sortDir: SortDir
  onSort: (key: HwProjectSortKey) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-slate-500">
            {PROJECT_COLUMNS.map((column) => {
              const active = column.key === sortKey
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={`pb-2 font-medium ${column.numeric ? 'pl-4 text-right' : 'pr-4 text-left'}`}
                >
                  <button
                    type="button"
                    onClick={() => onSort(column.key)}
                    className={`inline-flex w-full cursor-pointer items-center gap-1 transition-colors hover:text-slate-300 ${
                      column.numeric ? 'justify-end' : ''
                    } ${active ? 'text-indigo-300' : ''}`}
                  >
                    {column.label}
                    <SortIcon active={active} dir={sortDir} />
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr key={project.id} className="border-t border-slate-800/60">
              <td className="py-2 pr-4">
                <div className="flex items-center gap-2">
                  <Link
                    to={`/hardware/projects/${project.id}`}
                    className="font-medium text-slate-200 hover:text-indigo-400"
                  >
                    {project.name}
                  </Link>
                  {project.licenses_expired > 0 && (
                    <span
                      className="flex items-center gap-1 text-xs text-rose-300"
                      title={`${project.licenses_expired} expired license(s)`}
                    >
                      <TriangleAlert className="h-3.5 w-3.5" strokeWidth={2} />
                      {project.licenses_expired}
                    </span>
                  )}
                </div>
              </td>
              <td className="py-2 pr-4 text-slate-400">
                {project.company || <span className="text-slate-600">—</span>}
              </td>
              <td className="py-2 pl-4 text-right tabular-nums text-slate-400">
                {project.asset_count}
              </td>
              <td className="py-2 pl-4 text-right tabular-nums text-slate-400">
                {project.license_count}
              </td>
              <td className="py-2 pl-4 text-right tabular-nums text-slate-400">
                {formatEuro(project.effective_budget)}
              </td>
              <td className="py-2 pl-4 text-right tabular-nums text-slate-200">
                {formatEuro(project.actual_total)}
              </td>
              <td className="py-2 pl-4 text-right tabular-nums text-slate-400">
                {formatEuro(project.planned_total)}
              </td>
              <td
                className={`py-2 pl-4 text-right tabular-nums ${
                  project.remaining < 0 ? 'text-rose-300' : 'text-slate-200'
                }`}
              >
                {formatEuro(project.remaining)}
              </td>
              <td className="py-2 pl-4">
                <UtilisationCell used={project.actual_total} budget={project.effective_budget} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

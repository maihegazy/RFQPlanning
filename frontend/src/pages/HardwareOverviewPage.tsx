import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarClock,
  Download,
  ExternalLink,
  FolderKanban,
  HardDrive,
  KeyRound,
  Layers,
  Server,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { api } from '../api'
import { budgetBreakdown } from '../hardware/budget'
import { share, utilisationTone } from '../hardware/utilisation'
import type { HwLicenseExpiry, HwOverview, HwPivot, HwYearRow } from '../types'
import { Button, Card, EmptyState, ErrorBanner, KpiTile, Spinner } from '../components/ui'
import { formatEuro, formatNumber } from '../utils'

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'Something went wrong.'
}

/* -------------------------------------------------------------------------- */
/* KPI tiles                                                                   */
/* -------------------------------------------------------------------------- */

function CountTile({
  Icon,
  label,
  value,
  to,
}: {
  Icon: LucideIcon
  label: string
  value: number
  /** Renders the tile as a link when the figure has a page behind it. */
  to?: string
}) {
  const body = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-indigo-800 bg-indigo-950 text-indigo-300">
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </span>
      <div>
        <p className="text-lg font-semibold tabular-nums text-slate-100">{value}</p>
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      </div>
    </>
  )
  const shell =
    'flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3'
  if (to === undefined) return <div className={shell}>{body}</div>
  return (
    <Link to={to} className={`${shell} transition-colors hover:border-indigo-800`}>
      {body}
    </Link>
  )
}

function Kpis({ overview }: { overview: HwOverview }) {
  const { dashboard } = overview
  const budget = dashboard.budget_total
  const ratio = budget > 0 ? (dashboard.spent_total / budget) * 100 : 0
  const over = dashboard.remaining < 0

  return (
    <>
      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Overall budget"
          value={formatEuro(budget)}
          hint={budgetBreakdown(dashboard) ?? 'Approved as one overall figure'}
        />
        <KpiTile
          label="Committed spend"
          value={formatEuro(dashboard.spent_total)}
          hint={
            budget > 0
              ? `${formatNumber(ratio, 0)}% of the overall budget`
              : 'Depreciated purchases and leases'
          }
        />
        <KpiTile
          label="Planned spend"
          value={formatEuro(dashboard.planned_total)}
          hint="Planned purchases, not yet ordered"
        />
        <KpiTile
          label="Remaining"
          value={formatEuro(dashboard.remaining)}
          hint={over ? 'Over budget' : 'Budget minus committed spend'}
          tone={over ? 'warning' : 'default'}
        >
          <div className="mt-3">
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full rounded-full ${utilisationTone(ratio)}`}
                style={{ width: `${share(dashboard.spent_total, budget)}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              {budget > 0 ? `${formatNumber(ratio, 0)}% of budget used` : 'No budget set'}
            </p>
          </div>
        </KpiTile>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <CountTile
          Icon={Layers}
          label="Projects"
          value={overview.project_count}
          to="/hardware/projects"
        />
        <CountTile Icon={HardDrive} label="Assets" value={overview.asset_count} />
        <CountTile Icon={KeyRound} label="Licenses" value={overview.license_count} />
      </div>
      {overview.uncounted_rows > 0 && (
        <p className="mb-6 flex items-start gap-2 rounded-lg border border-rose-900 bg-rose-950/40 px-4 py-2.5 text-sm text-rose-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {overview.uncounted_rows} register row{overview.uncounted_rows === 1 ? '' : 's'} across
            the projects count towards no year (a missing date, an unknown purchase type, or a date
            outside 1990–2100). They are marked in the registers of their project.
          </span>
        </p>
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Spend by year                                                               */
/* -------------------------------------------------------------------------- */

function SpendByYear({ years, totals }: { years: HwYearRow[]; totals: HwYearRow }) {
  // The bars are scaled to the tallest year, not to the budget: the point is the
  // shape of the spend over time.
  const max = Math.max(0, ...years.map((y) => y.grand_total))

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="pb-2 pr-4 font-medium">Year</th>
            <th className="pb-2 pr-4 text-right font-medium">Assets</th>
            <th className="pb-2 pr-4 text-right font-medium">Licenses</th>
            <th className="pb-2 pr-4 text-right font-medium">Actual total</th>
            <th className="pb-2 pr-4 text-right font-medium">Planned</th>
            <th className="pb-2 pr-4 text-right font-medium">Grand total</th>
            <th className="w-40 pb-2 font-medium">Profile</th>
          </tr>
        </thead>
        <tbody>
          {years.map((row) => (
            <tr key={row.year} className="border-t border-slate-800/60">
              <td className="py-2 pr-4 font-medium text-slate-200 tabular-nums">{row.year}</td>
              <td className="py-2 pr-4 text-right tabular-nums text-slate-400">
                {formatEuro(row.actual_assets)}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums text-slate-400">
                {formatEuro(row.actual_licenses)}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums text-slate-200">
                {formatEuro(row.actual_total)}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums text-slate-400">
                {formatEuro(row.planned_total)}
              </td>
              <td className="py-2 pr-4 text-right font-medium tabular-nums text-slate-100">
                {formatEuro(row.grand_total)}
              </td>
              <td className="py-2">
                <div
                  className="flex h-2 overflow-hidden rounded-full bg-slate-800"
                  title={`Actual ${formatEuro(row.actual_total)} · Planned ${formatEuro(
                    row.planned_total,
                  )}`}
                >
                  <div
                    className="h-full bg-indigo-500"
                    style={{ width: `${share(row.actual_total, max)}%` }}
                  />
                  <div
                    className="h-full bg-sky-500"
                    style={{ width: `${share(row.planned_total, max)}%` }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-700 font-semibold text-slate-100">
            <td className="py-2 pr-4">Total</td>
            <td className="py-2 pr-4 text-right tabular-nums">
              {formatEuro(totals.actual_assets)}
            </td>
            <td className="py-2 pr-4 text-right tabular-nums">
              {formatEuro(totals.actual_licenses)}
            </td>
            <td className="py-2 pr-4 text-right tabular-nums">{formatEuro(totals.actual_total)}</td>
            <td className="py-2 pr-4 text-right tabular-nums">
              {formatEuro(totals.planned_total)}
            </td>
            <td className="py-2 pr-4 text-right tabular-nums">{formatEuro(totals.grand_total)}</td>
            <td className="py-2" />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function BarLegend() {
  return (
    <div className="flex items-center gap-3 text-xs text-slate-500">
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-indigo-500" />
        Actual
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-sky-500" />
        Planned
      </span>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* License renewal risk                                                        */
/* -------------------------------------------------------------------------- */

const RISK_TONES = {
  rose: 'border-rose-800 bg-rose-950/40 text-rose-300',
  amber: 'border-amber-800 bg-amber-950/40 text-amber-300',
  sky: 'border-sky-800 bg-sky-950/40 text-sky-300',
} as const

function RiskTile({
  label,
  count,
  tone,
}: {
  label: string
  count: number
  tone: keyof typeof RISK_TONES
}) {
  return (
    <div className={`rounded-xl border p-4 ${RISK_TONES[tone]}`}>
      <p className="text-2xl font-bold tabular-nums">{count}</p>
      <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  )
}

function expiryTone(daysLeft: number): string {
  if (daysLeft <= 30) return 'border-rose-800 bg-rose-950/40 text-rose-300'
  if (daysLeft <= 60) return 'border-amber-800 bg-amber-950/40 text-amber-300'
  return 'border-sky-800 bg-sky-950/40 text-sky-300'
}

function expiryLabel(daysLeft: number): string {
  if (daysLeft < 0) return `${Math.abs(daysLeft)} d overdue`
  if (daysLeft === 0) return 'today'
  return `${daysLeft} d left`
}

function ExpiringList({ expiring }: { expiring: HwLicenseExpiry[] }) {
  const rows = useMemo(() => [...expiring].sort((a, b) => a.days_left - b.days_left), [expiring])

  return (
    <ul className="max-h-96 overflow-y-auto">
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-slate-800/60 py-2 last:border-0"
        >
          <div className="min-w-0">
            <Link
              to={`/hardware/projects/${row.hw_project_id}`}
              className="text-xs text-slate-500 hover:text-indigo-400"
            >
              {row.hw_project_name}
            </Link>
            <p className="truncate text-sm text-slate-200">
              {row.name}
              {row.manufacturer && <span className="text-slate-500"> · {row.manufacturer}</span>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-sm tabular-nums text-slate-400">{row.expiration_date}</span>
            <span
              className={`w-24 rounded-full border px-2 py-0.5 text-center text-xs font-medium tabular-nums ${expiryTone(
                row.days_left,
              )}`}
            >
              {expiryLabel(row.days_left)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}

/* -------------------------------------------------------------------------- */
/* Asset pivot                                                                 */
/* -------------------------------------------------------------------------- */

function PivotTable({ pivot }: { pivot: HwPivot }) {
  const columnTotals = pivot.statuses.map((status) =>
    pivot.rows.reduce((sum, row) => sum + (row.counts[status] ?? 0), 0),
  )
  const grandTotal = pivot.rows.reduce((sum, row) => sum + row.total, 0)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-slate-500">
            <th className="pb-2 pr-4 text-left font-medium">Category</th>
            {pivot.statuses.map((status) => (
              <th key={status} className="pb-2 pl-4 text-right font-medium">
                {status}
              </th>
            ))}
            <th className="pb-2 pl-4 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {pivot.rows.map((row) => (
            <tr key={row.category} className="border-t border-slate-800/60">
              <td className="py-2 pr-4 text-slate-200">{row.category}</td>
              {pivot.statuses.map((status) => {
                const count = row.counts[status] ?? 0
                return (
                  <td key={status} className="py-2 pl-4 text-right tabular-nums text-slate-400">
                    {count === 0 ? <span className="text-slate-600">—</span> : count}
                  </td>
                )
              })}
              <td className="py-2 pl-4 text-right font-medium tabular-nums text-slate-100">
                {row.total}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-700 font-semibold text-slate-100">
            <td className="py-2 pr-4">Total</td>
            {pivot.statuses.map((status, index) => (
              <td key={status} className="py-2 pl-4 text-right tabular-nums">
                {columnTotals[index]}
              </td>
            ))}
            <td className="py-2 pl-4 text-right tabular-nums">{grandTotal}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

const ACTION_LINK =
  'inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700'

export default function HardwareOverviewPage() {
  const [overview, setOverview] = useState<HwOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    api
      .getHwOverview()
      .then(setOverview)
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-indigo-800 bg-indigo-950 text-indigo-300">
            <Server className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Hardware Management</h1>
            <p className="text-sm text-slate-400">
              Assets, licenses, depreciation and budget across every hardware project
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/hardware/projects" className={ACTION_LINK}>
            <FolderKanban className="h-4 w-4" strokeWidth={1.75} />
            Projects
          </Link>
          <Link to="/hardware-catalog" className={ACTION_LINK}>
            <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
            Catalog
          </Link>
          <a href={api.hwImportTemplateUrl()} download className={ACTION_LINK}>
            <Download className="h-4 w-4" strokeWidth={1.75} />
            Template
          </a>
        </div>
      </header>

      {error && (
        <div className="mb-6 space-y-3">
          <ErrorBanner message={error} />
          <Button variant="secondary" onClick={load}>
            Try again
          </Button>
        </div>
      )}

      {loading && <Spinner />}

      {overview && !loading && (
        <>
          <Kpis overview={overview} />

          <Card title="Spend by year" actions={<BarLegend />} className="mb-6">
            {overview.years.length === 0 ? (
              <EmptyState>
                No purchases or planned purchases yet — years appear once assets or licenses carry
                dates.
              </EmptyState>
            ) : (
              <SpendByYear years={overview.years} totals={overview.totals} />
            )}
          </Card>

          <Card
            title="License renewal risk"
            actions={
              <span className="flex items-center gap-1.5 text-xs text-slate-500">
                <CalendarClock className="h-4 w-4" strokeWidth={1.75} />
                By expiration date
              </span>
            }
            className="mb-6"
          >
            <div className="mb-5 grid gap-4 sm:grid-cols-4">
              <RiskTile label="Expired" count={overview.risk.expired} tone="rose" />
              <RiskTile label="Within 30 days" count={overview.risk.in_30_days} tone="rose" />
              <RiskTile label="31–60 days" count={overview.risk.in_60_days} tone="amber" />
              <RiskTile label="61–90 days" count={overview.risk.in_90_days} tone="sky" />
            </div>
            {overview.expiring.length === 0 ? (
              <EmptyState>No license expires within the next 90 days.</EmptyState>
            ) : (
              <ExpiringList expiring={overview.expiring} />
            )}
          </Card>

          <Card title="Assets by category and status">
            {overview.asset_pivot.rows.length === 0 ? (
              <EmptyState>No assets registered yet.</EmptyState>
            ) : (
              <PivotTable pivot={overview.asset_pivot} />
            )}
          </Card>
        </>
      )}
    </div>
  )
}

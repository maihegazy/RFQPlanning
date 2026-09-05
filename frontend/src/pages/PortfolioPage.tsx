import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { PortfolioCapacity, ProjectSummary } from '../types'
import { Card, EmptyState, ErrorBanner, Spinner, StatusBadge } from '../components/ui'
import { MONTH_NAMES, formatEuro, formatNumber } from '../utils'
import { useVault } from '../vault/VaultContext'
import { VaultPrompt, VaultStatusButton } from '../vault/VaultGate'
import { computeBudgetPlan } from '../money/engine'
import { emptyMoneyConfig, normalizeMoneyConfig, type MoneyConfig } from '../money/types'

const ALL_STATUSES = ['draft', 'quoted', 'won', 'lost']
const STATUS_WEIGHT: Record<string, (p: ProjectSummary) => number> = {
  draft: (p) => p.win_probability_pct / 100,
  quoted: (p) => p.win_probability_pct / 100,
  won: () => 1,
  lost: () => 0,
}

interface ProjectMoney {
  summary: ProjectSummary
  revenue: number
  cost: number
  marginPct: number
  weighted: number
}

export default function PortfolioPage() {
  const vault = useVault()
  const [statuses, setStatuses] = useState<string[]>(['draft', 'quoted', 'won'])
  const [capacity, setCapacity] = useState<PortfolioCapacity | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [moneyRows, setMoneyRows] = useState<ProjectMoney[] | null>(null)
  const [error, setError] = useState('')
  /* Toggling two filters quickly, or unlocking while the money is still being
   * computed, must not let the slower response overwrite the newer one. */
  const moneySeq = useRef(0)

  useEffect(() => {
    let cancelled = false
    setCapacity(null)
    // Every status deselected means no status, which the API takes as an empty list.
    api
      .getPortfolioCapacity(statuses)
      .then((next) => {
        if (!cancelled) setCapacity(next)
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [statuses])

  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch((e) => setError(e.message))
  }, [])

  const computeMoney = useCallback(async () => {
    if (vault.status !== 'unlocked' || !projects) return
    const seq = moneySeq.current + 1
    moneySeq.current = seq
    try {
      const meta = await api.getMeta()
      const rows: ProjectMoney[] = []
      for (const summary of projects) {
        const [full, rates, blob] = await Promise.all([
          api.getProject(summary.id),
          api.getRates(summary.id),
          api.getMoneyBlob(summary.id),
        ])
        const money =
          blob.encrypted_money && blob.money_iv
            ? normalizeMoneyConfig(
                await vault.decrypt<MoneyConfig>({
                  iv: blob.money_iv,
                  ciphertext: blob.encrypted_money,
                }),
              )
            : emptyMoneyConfig(meta.locations, meta.levels, meta.ticket_sizes)
        const plan = computeBudgetPlan(full, money, rates)
        const revenue = plan.cost_profit_overall.reduce((s, r) => s + r.selling_price, 0)
        const cost = plan.cost_profit_overall.reduce((s, r) => s + r.cost, 0)
        rows.push({
          summary,
          revenue,
          cost,
          marginPct: revenue > 0 ? ((revenue - cost) / revenue) * 100 : 0,
          weighted: revenue * (STATUS_WEIGHT[summary.status]?.(summary) ?? 0),
        })
      }
      if (seq !== moneySeq.current) return
      setMoneyRows(rows)
    } catch (e) {
      if (seq === moneySeq.current) setError((e as Error).message)
    }
  }, [projects, vault])

  useEffect(() => {
    setMoneyRows(null)
    computeMoney()
  }, [computeMoney])

  const toggleStatus = (s: string) => {
    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  }

  const visibleMoney = moneyRows?.filter((r) => statuses.includes(r.summary.status)) ?? null
  const pipeline = visibleMoney?.reduce((s, r) => s + r.revenue, 0)
  const weighted = visibleMoney?.reduce((s, r) => s + r.weighted, 0)
  const wonRows = moneyRows?.filter((r) => r.summary.status === 'won')
  const wonValue = wonRows?.reduce((s, r) => s + r.revenue, 0)
  const wonCount = projects?.filter((p) => p.status === 'won').length ?? 0
  const lostCount = projects?.filter((p) => p.status === 'lost').length ?? 0
  const hitRate = wonCount + lostCount > 0 ? (wonCount / (wonCount + lostCount)) * 100 : null

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <Link to="/" className="text-sm text-slate-400 hover:text-indigo-400">
            ← All projects
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Portfolio</h1>
        </div>
        <VaultStatusButton />
      </header>

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="mb-6 flex gap-1.5">
        {ALL_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => toggleStatus(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
              statuses.includes(s)
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-500 hover:text-slate-300'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {vault.status !== 'unlocked' ? (
        <div className="mb-6">
          <VaultPrompt>
            Pipeline value, weighted revenue and margins require unlocked financial data. The
            capacity heatmap below works without unlocking.
          </VaultPrompt>
        </div>
      ) : (
        <div className="mb-6 grid gap-4 sm:grid-cols-4">
          <StatTile
            label="Pipeline value"
            value={pipeline === undefined ? null : formatEuro(pipeline)}
            hint="Total revenue of selected statuses"
          />
          <StatTile
            label="Weighted revenue"
            value={weighted === undefined ? null : formatEuro(weighted)}
            hint="Win-probability weighted"
          />
          <StatTile
            label="Won value"
            value={wonValue === undefined ? null : formatEuro(wonValue ?? 0)}
            hint="Revenue of won RFQs"
          />
          <StatTile
            label="Hit rate"
            value={hitRate === null ? '—' : `${formatNumber(hitRate, 0)}%`}
            hint={`${wonCount} won / ${lostCount} lost`}
          />
        </div>
      )}

      {vault.status === 'unlocked' && (
        <Card title="Margin by Project" className="mb-6">
          {visibleMoney === null ? (
            <Spinner />
          ) : visibleMoney.length === 0 ? (
            <EmptyState>No projects in the selected statuses.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="pb-2 pr-4">Project</th>
                    <th className="pb-2 pr-4">Customer</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 pr-4 text-right">Win %</th>
                    <th className="pb-2 pr-4 text-right">Revenue</th>
                    <th className="pb-2 pr-4 text-right">Cost</th>
                    <th className="pb-2 pr-4 text-right">Margin %</th>
                    <th className="pb-2 text-right">Weighted Rev.</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMoney.map((r) => (
                    <tr key={r.summary.id} className="border-t border-slate-800/60">
                      <td className="py-2 pr-4">
                        <Link
                          to={`/projects/${r.summary.id}`}
                          className="font-medium text-slate-200 hover:text-indigo-400"
                        >
                          {r.summary.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 text-slate-400">{r.summary.company}</td>
                      <td className="py-2 pr-4">
                        <StatusBadge status={r.summary.status} />
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {r.summary.status === 'won'
                          ? '100'
                          : r.summary.status === 'lost'
                            ? '0'
                            : r.summary.win_probability_pct}
                        %
                      </td>
                      <td className="py-2 pr-4 text-right">{formatEuro(r.revenue)}</td>
                      <td className="py-2 pr-4 text-right">{formatEuro(r.cost)}</td>
                      <td
                        className={`py-2 pr-4 text-right ${r.marginPct < 0 ? 'text-rose-400' : ''}`}
                      >
                        {formatNumber(r.marginPct)}%
                      </td>
                      <td className="py-2 text-right">{formatEuro(r.weighted)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Card
        title={`Capacity Heatmap — FTE demand per month${capacity ? ` (${capacity.project_count} projects)` : ''}`}
      >
        {capacity === null ? (
          <Spinner />
        ) : capacity.months.length === 0 ? (
          <EmptyState>No FTE demand for the selected statuses.</EmptyState>
        ) : (
          <CapacityHeatmap capacity={capacity} />
        )}
      </Card>
    </div>
  )
}

function StatTile({ label, value, hint }: { label: string; value: string | null; hint: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-100">{value ?? '…'}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  )
}

function CapacityHeatmap({ capacity }: { capacity: PortfolioCapacity }) {
  const max = Math.max(0.001, ...Object.values(capacity.totals_by_month))

  const yearGroups: [string, number][] = []
  for (const m of capacity.months) {
    const year = m.slice(0, 4)
    const last = yearGroups[yearGroups.length - 1]
    if (last && last[0] === year) last[1] += 1
    else yearGroups.push([year, 1])
  }

  const heat = (value: number) => {
    if (value === 0) return { backgroundColor: 'transparent' }
    const intensity = Math.min(1, value / max)
    return { backgroundColor: `rgba(99, 102, 241, ${0.12 + intensity * 0.55})` }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 border-b border-r border-slate-700 bg-slate-900 px-3 py-2 text-left">
              Location
            </th>
            {yearGroups.map(([year, span]) => (
              <th
                key={year}
                colSpan={span}
                className="border-b border-l border-slate-700 px-2 py-1.5 text-center font-semibold text-indigo-300"
              >
                {year}
              </th>
            ))}
          </tr>
          <tr>
            <th className="sticky left-0 z-10 border-b border-r border-slate-800 bg-slate-900 px-3 py-1"></th>
            {capacity.months.map((m) => (
              <th
                key={m}
                className="border-b border-l border-slate-800 px-1 py-1 text-center font-medium text-slate-400"
              >
                {MONTH_NAMES[Number(m.slice(5)) - 1].slice(0, 3)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {capacity.locations.map((loc) => (
            <tr key={loc}>
              <td className="sticky left-0 z-10 border-r border-t border-slate-800 bg-slate-950 px-3 py-1.5 font-medium">
                {loc}
              </td>
              {capacity.months.map((m) => {
                const value = capacity.cells[m]?.[loc] ?? 0
                return (
                  <td
                    key={m}
                    className="border-l border-t border-slate-800 px-1 py-1.5 text-center"
                    style={heat(value)}
                    title={`${loc} ${m}: ${value.toFixed(1)} FTE`}
                  >
                    {value > 0 ? value.toFixed(1) : ''}
                  </td>
                )
              })}
            </tr>
          ))}
          <tr className="bg-slate-800/80 font-semibold">
            <td className="sticky left-0 z-10 border-r border-t border-slate-700 bg-slate-800 px-3 py-1.5">
              TOTAL
            </td>
            {capacity.months.map((m) => (
              <td key={m} className="border-l border-t border-slate-700 px-1 py-1.5 text-center">
                {(capacity.totals_by_month[m] ?? 0).toFixed(1)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

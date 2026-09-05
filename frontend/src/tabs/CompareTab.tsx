import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import type { Meta, Project, ProjectSummary } from '../types'
import { Button, Card, EmptyState, ErrorBanner, Spinner, StatusBadge } from '../components/ui'
import { formatEuro, formatNumber } from '../utils'
import { useVault } from '../vault/VaultContext'
import { VaultPrompt } from '../vault/VaultGate'
import { computeBudgetPlan, buildBudgetRows, projectMonths } from '../money/engine'
import { emptyMoneyConfig, normalizeMoneyConfig, type MoneyConfig } from '../money/types'

interface ScenarioKpis {
  summary: ProjectSummary
  isBase: boolean
  fteMonths: number
  manHours: number
  revenue: number | null
  cost: number | null
  profit: number | null
  marginPct: number | null
  perYear: { year: string; revenue: number; cost: number; profit: number }[]
}

export default function CompareTab({
  project,
  meta,
  onChanged,
}: {
  project: Project
  meta: Meta
  onChanged: () => void
}) {
  const vault = useVault()
  const navigate = useNavigate()
  const [kpis, setKpis] = useState<ScenarioKpis[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const family = await api.listScenarios(project.id)
      const results: ScenarioKpis[] = []
      for (const summary of family) {
        const full = await api.getProject(summary.id)
        const months = projectMonths(full)
        const emptyMoney = emptyMoneyConfig(meta.locations, meta.levels, meta.ticket_sizes)
        const effortRows = buildBudgetRows(full, emptyMoney, months)
        const fteMonths = effortRows.reduce((s, r) => s + r.ftes, 0)
        const manHours = effortRows.reduce((s, r) => s + r.man_hours, 0)

        let revenue: number | null = null
        let cost: number | null = null
        let profit: number | null = null
        let marginPct: number | null = null
        let perYear: ScenarioKpis['perYear'] = []

        if (vault.status === 'unlocked') {
          const blob = await api.getMoneyBlob(summary.id)
          const money =
            blob.encrypted_money && blob.money_iv
              ? normalizeMoneyConfig(
                  await vault.decrypt<MoneyConfig>({
                    iv: blob.money_iv,
                    ciphertext: blob.encrypted_money,
                  }),
                )
              : emptyMoney
          const rates = await api.getRates(summary.id)
          const plan = computeBudgetPlan(full, money, rates)
          revenue = plan.cost_profit_overall.reduce((s, r) => s + r.selling_price, 0)
          cost = plan.cost_profit_overall.reduce((s, r) => s + r.cost, 0)
          profit = revenue - cost
          marginPct = revenue > 0 ? (profit / revenue) * 100 : 0
          perYear = plan.cost_profit_overall.map((r) => ({
            year: r.year,
            revenue: r.selling_price,
            cost: r.cost,
            profit: r.profit,
          }))
        }

        results.push({
          summary,
          isBase: summary.base_project_id === null,
          fteMonths,
          manHours,
          revenue,
          cost,
          profit,
          marginPct,
          perYear,
        })
      }
      setKpis(results)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [project.id, vault, meta])

  useEffect(() => {
    setKpis(null)
    load()
  }, [load])

  const promote = async (id: number) => {
    try {
      await api.promoteScenario(id)
      await load()
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (error) return <ErrorBanner message={error} />
  if (!kpis) return <Spinner />

  if (kpis.length < 2) {
    return (
      <EmptyState>
        No scenarios yet. Use "New scenario" in the header to clone this project, adjust staffing or
        rates in the copy, then compare them here side by side.
      </EmptyState>
    )
  }

  const bestMargin = Math.max(...kpis.map((k) => k.marginPct ?? -Infinity))
  const years = [...new Set(kpis.flatMap((k) => k.perYear.map((y) => y.year)))].sort()

  return (
    <div className="space-y-6">
      {vault.status !== 'unlocked' && (
        <VaultPrompt>
          Unlock financial data to compare revenue, cost and margins. Effort figures below are
          available without unlocking.
        </VaultPrompt>
      )}

      <Card title="Scenario Comparison">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="pb-3 pr-4">KPI</th>
                {kpis.map((k) => (
                  <th key={k.summary.id} className="pb-3 pr-4 text-right">
                    <button
                      className="font-semibold text-slate-200 hover:text-indigo-400"
                      onClick={() => navigate(`/projects/${k.summary.id}`)}
                      title="Open this scenario"
                    >
                      {k.summary.name}
                    </button>
                    <div className="mt-1 flex items-center justify-end gap-1.5 normal-case">
                      {k.isBase && (
                        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
                          base
                        </span>
                      )}
                      {k.summary.is_winning_scenario && (
                        <span className="rounded-full bg-amber-950 px-2 py-0.5 text-[10px] text-amber-300">
                          👑 winner
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <KpiRow
                label="Status"
                values={kpis.map((k) => (
                  <StatusBadge key={k.summary.id} status={k.summary.status} />
                ))}
              />
              <KpiRow label="FTE-months" values={kpis.map((k) => formatNumber(k.fteMonths, 1))} />
              <KpiRow label="Man-hours" values={kpis.map((k) => formatNumber(k.manHours, 0))} />
              <KpiRow
                label="Revenue"
                values={kpis.map((k) => (k.revenue === null ? '🔒' : formatEuro(k.revenue)))}
              />
              <KpiRow
                label="Cost"
                values={kpis.map((k) => (k.cost === null ? '🔒' : formatEuro(k.cost)))}
              />
              <KpiRow
                label="Profit"
                values={kpis.map((k) => (k.profit === null ? '🔒' : formatEuro(k.profit)))}
              />
              <tr className="border-t border-slate-700 bg-slate-900/80 font-semibold">
                <td className="py-2.5 pr-4">Margin %</td>
                {kpis.map((k) => (
                  <td
                    key={k.summary.id}
                    className={`py-2.5 pr-4 text-right ${
                      k.marginPct !== null && k.marginPct === bestMargin ? 'text-emerald-300' : ''
                    }`}
                  >
                    {k.marginPct === null ? '🔒' : `${formatNumber(k.marginPct)}%`}
                    {k.marginPct !== null && k.marginPct === bestMargin && ' ★'}
                  </td>
                ))}
              </tr>
              <tr className="border-t border-slate-800">
                <td className="py-2.5 pr-4 text-xs text-slate-500">Actions</td>
                {kpis.map((k) => (
                  <td key={k.summary.id} className="py-2.5 pr-4 text-right">
                    {!k.summary.is_winning_scenario && (
                      <Button variant="secondary" onClick={() => promote(k.summary.id)}>
                        Mark as winner
                      </Button>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {vault.status === 'unlocked' && years.length > 0 && (
        <Card title="Profit by Year">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="pb-2 pr-4">Year</th>
                  {kpis.map((k) => (
                    <th key={k.summary.id} className="pb-2 pr-4 text-right">
                      {k.summary.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {years.map((year) => (
                  <tr key={year} className="border-t border-slate-800/60">
                    <td className="py-2 pr-4">{year}</td>
                    {kpis.map((k) => {
                      const y = k.perYear.find((p) => p.year === year)
                      return (
                        <td key={k.summary.id} className="py-2 pr-4 text-right">
                          {y ? formatEuro(y.profit) : '—'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

function KpiRow({ label, values }: { label: string; values: React.ReactNode[] }) {
  return (
    <tr className="border-t border-slate-800/60">
      <td className="py-2.5 pr-4 text-slate-400">{label}</td>
      {values.map((v, i) => (
        <td key={i} className="py-2.5 pr-4 text-right">
          {v}
        </td>
      ))}
    </tr>
  )
}

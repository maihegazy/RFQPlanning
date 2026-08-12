import { useEffect, useState } from 'react'
import { api } from '../api'
import type { BudgetPlan, PivotTable, Project, ResourcePlan } from '../types'
import { Button, Card, ErrorBanner, Spinner } from '../components/ui'
import { formatEuro, formatNumber } from '../utils'

export default function ReportsTab({ project }: { project: Project }) {
  const [budget, setBudget] = useState<BudgetPlan | null>(null)
  const [resources, setResources] = useState<ResourcePlan | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setBudget(null)
    setResources(null)
    setError('')
    Promise.all([api.getBudgetPlan(project.id), api.getResourcePlan(project.id)])
      .then(([b, r]) => {
        setBudget(b)
        setResources(r)
      })
      .catch((e) => setError(e.message))
  }, [project.id])

  if (error) return <ErrorBanner message={error} />
  if (!budget || !resources) return <Spinner />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <a href={api.budgetPlanXlsxUrl(project.id)} download>
          <Button>⬇ Download Budget Plan (Excel)</Button>
        </a>
        <a href={api.resourcePlanXlsxUrl(project.id)} download>
          <Button variant="secondary">⬇ Download Resource Plan (Excel)</Button>
        </a>
      </div>

      <Card title="Cost-Profit Summary by Year and Location">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="pb-2 pr-4">Year</th>
                <th className="pb-2 pr-4">Location</th>
                <th className="pb-2 pr-4 text-right">Man-Hours</th>
                <th className="pb-2 pr-4 text-right">Cost</th>
                <th className="pb-2 pr-4 text-right">Selling Price</th>
                <th className="pb-2 pr-4 text-right">Hourly Cost</th>
                <th className="pb-2 pr-4 text-right">Hourly Rate</th>
                <th className="pb-2 pr-4 text-right">Profit</th>
                <th className="pb-2 text-right">Profit %</th>
              </tr>
            </thead>
            <tbody>
              {budget.cost_profit_overall.map((overall) => (
                <YearGroup
                  key={overall.year}
                  year={overall.year}
                  rows={budget.cost_profit_summary.filter((r) => r.year === overall.year)}
                  overall={overall}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Ticket Analysis">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="pb-2 pr-4">Year</th>
                <th className="pb-2 pr-4">Size</th>
                <th className="pb-2 pr-4 text-right">Story Points</th>
                <th className="pb-2 pr-4 text-right">Hours/Ticket</th>
                <th className="pb-2 pr-4 text-right"># Tickets</th>
                <th className="pb-2 pr-4 text-right">Total Hours</th>
                <th className="pb-2 pr-4 text-right">Hourly Rate</th>
                <th className="pb-2 text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {budget.ticket_overall.map((overall) => {
                const rows = budget.ticket_analysis.filter((r) => r.year === overall.year)
                return (
                  <TicketYearGroup key={overall.year} rows={rows} overall={overall} />
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <PivotSection
        title="Budget Plan — Selling Price by Month"
        pivots={budget.yearly_pivots}
        currency
      />
      <PivotSection
        title="Resource Plan — FTEs by Month"
        pivots={resources.yearly_pivots}
        decimals={1}
      />
    </div>
  )
}

function YearGroup({
  year,
  rows,
  overall,
}: {
  year: string
  rows: BudgetPlan['cost_profit_summary']
  overall: BudgetPlan['cost_profit_overall'][number]
}) {
  return (
    <>
      {rows.map((r, i) => (
        <tr key={`${r.year}-${r.location}`} className="border-t border-slate-800/60">
          <td className="py-2 pr-4">{i === 0 ? year : ''}</td>
          <td className="py-2 pr-4">{r.location}</td>
          <td className="py-2 pr-4 text-right">{formatNumber(r.man_hours)}</td>
          <td className="py-2 pr-4 text-right">{formatEuro(r.cost)}</td>
          <td className="py-2 pr-4 text-right">{formatEuro(r.selling_price)}</td>
          <td className="py-2 pr-4 text-right">{formatEuro(r.hourly_cost)}</td>
          <td className="py-2 pr-4 text-right">{formatEuro(r.hourly_rate)}</td>
          <td className="py-2 pr-4 text-right">{formatEuro(r.profit)}</td>
          <td className="py-2 text-right">{formatNumber(r.profit_pct)}%</td>
        </tr>
      ))}
      <tr className="border-t border-slate-700 bg-emerald-950/40 font-semibold text-emerald-300">
        <td className="py-2 pr-4">Overall</td>
        <td className="py-2 pr-4"></td>
        <td className="py-2 pr-4 text-right">{formatNumber(overall.man_hours)}</td>
        <td className="py-2 pr-4 text-right">{formatEuro(overall.cost)}</td>
        <td className="py-2 pr-4 text-right">{formatEuro(overall.selling_price)}</td>
        <td className="py-2 pr-4 text-right">{formatEuro(overall.hourly_cost)}</td>
        <td className="py-2 pr-4 text-right">{formatEuro(overall.hourly_rate)}</td>
        <td className="py-2 pr-4 text-right">{formatEuro(overall.profit)}</td>
        <td className="py-2 text-right">{formatNumber(overall.profit_pct)}%</td>
      </tr>
    </>
  )
}

function TicketYearGroup({
  rows,
  overall,
}: {
  rows: BudgetPlan['ticket_analysis']
  overall: BudgetPlan['ticket_overall'][number]
}) {
  return (
    <>
      {rows.map((r, i) => (
        <tr key={`${r.year}-${r.size}`} className="border-t border-slate-800/60">
          <td className="py-2 pr-4">{i === 0 ? r.year : ''}</td>
          <td className="py-2 pr-4">{r.size}</td>
          <td className="py-2 pr-4 text-right">{formatNumber(r.story_points, 1)}</td>
          <td className="py-2 pr-4 text-right">{formatNumber(r.hours_per_ticket, 1)}</td>
          <td className="py-2 pr-4 text-right">{formatNumber(r.num_tickets)}</td>
          <td className="py-2 pr-4 text-right">{formatNumber(r.total_hours)}</td>
          <td className="py-2 pr-4 text-right">{formatEuro(r.hourly_rate)}</td>
          <td className="py-2 text-right">{formatEuro(r.revenue)}</td>
        </tr>
      ))}
      <tr className="border-t border-slate-700 bg-emerald-950/40 font-semibold text-emerald-300">
        <td className="py-2 pr-4">Overall</td>
        <td colSpan={6}></td>
        <td className="py-2 text-right">{formatEuro(overall.revenue)}</td>
      </tr>
      <tr className="bg-rose-950/30 font-semibold text-rose-300">
        <td className="py-2 pr-4">Profit (vs. cost)</td>
        <td colSpan={6}></td>
        <td className="py-2 text-right">{formatNumber(overall.profit_pct)}%</td>
      </tr>
    </>
  )
}

function PivotSection({
  title,
  pivots,
  currency = false,
  decimals = 2,
}: {
  title: string
  pivots: PivotTable[]
  currency?: boolean
  decimals?: number
}) {
  const [openYear, setOpenYear] = useState<string | null>(pivots[0]?.year ?? null)

  return (
    <Card title={title}>
      <div className="mb-4 flex gap-1">
        {pivots.map((p) => (
          <button
            key={p.year}
            onClick={() => setOpenYear(p.year)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              openYear === p.year
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {p.year}
          </button>
        ))}
      </div>
      {pivots
        .filter((p) => p.year === openYear)
        .map((pivot) => (
          <div key={pivot.year} className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-xs">
              <thead>
                <tr className="text-left uppercase tracking-wide text-slate-500">
                  {pivot.columns.map((col) => (
                    <th key={col} className="border-b border-slate-700 px-2 py-2">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pivot.rows.map((row, i) => {
                  const isTotal = String(row.Feature).startsWith('TOTAL')
                  return (
                    <tr
                      key={i}
                      className={
                        isTotal
                          ? 'bg-slate-800/80 font-semibold text-slate-100'
                          : 'border-t border-slate-800/60'
                      }
                    >
                      {pivot.columns.map((col, ci) => {
                        const value = row[col]
                        const isNumeric = ci >= 4
                        return (
                          <td key={col} className={`px-2 py-1.5 ${isNumeric ? 'text-right' : ''}`}>
                            {isNumeric
                              ? currency
                                ? formatEuro(Number(value))
                                : formatNumber(value, decimals)
                              : String(value)}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}
    </Card>
  )
}

/**
 * Client-side money engine.
 *
 * Faithful TypeScript port of the original server-side budget calculations
 * (previously backend/app/services/calculations.py, itself ported from the
 * desktop app's BudgetController). Runs entirely in the browser against the
 * decrypted money configuration — the server never sees monetary values.
 */

import type { Project, RateConfig, Role } from '../types'
import { formatMonth, monthRange } from '../utils'
import type {
  BudgetPivot,
  BudgetPlan,
  BudgetRow,
  CostProfitOverall,
  CostProfitRow,
  MoneyConfig,
  TicketAnalysisRow,
  TicketOverall,
} from './types'

export const HOURS_PER_FTE_PER_MONTH = 160

export function roleFtesForMonth(role: Role, month: string): number {
  if (!role.use_advanced_allocation || role.allocations.length === 0) return role.ftes
  let total = 0
  for (const alloc of role.allocations) {
    if (alloc.start_month <= month && month <= alloc.end_month) total += alloc.ftes
  }
  return total
}

export function projectMonths(project: Project): string[] {
  return monthRange(
    formatMonth(project.start_year, project.start_month),
    formatMonth(project.end_year, project.end_month),
  )
}

export function buildBudgetRows(
  project: Project,
  money: MoneyConfig,
  months: string[],
): BudgetRow[] {
  const rows: BudgetRow[] = []
  for (const month of months) {
    for (const feature of project.features) {
      for (const role of feature.roles) {
        const ftes = roleFtesForMonth(role, month)
        const manHours = ftes * HOURS_PER_FTE_PER_MONTH
        const sellRate = money.hourly_rates[role.location] ?? 0
        const costRate = money.cost_rates[role.location]?.[role.level] ?? 0
        rows.push({
          month,
          year: month.slice(0, 4),
          feature: feature.name,
          role: role.name,
          location: role.location,
          level: role.level,
          ftes,
          man_hours: manHours,
          selling_price: manHours * sellRate,
          cost: manHours * costRate,
        })
      }
    }
  }
  return rows
}

export function costProfitSummary(rows: BudgetRow[]): CostProfitRow[] {
  const grouped = new Map<string, { man_hours: number; cost: number; selling_price: number }>()
  for (const row of rows) {
    const key = `${row.year}\u0000${row.location}`
    const g = grouped.get(key) ?? { man_hours: 0, cost: 0, selling_price: 0 }
    g.man_hours += row.man_hours
    g.cost += row.cost
    g.selling_price += row.selling_price
    grouped.set(key, g)
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, g]) => {
      const [year, location] = key.split('\u0000')
      const profit = g.selling_price - g.cost
      return {
        year,
        location,
        man_hours: g.man_hours,
        cost: g.cost,
        selling_price: g.selling_price,
        hourly_cost: g.man_hours !== 0 ? g.cost / g.man_hours : 0,
        hourly_rate: g.man_hours !== 0 ? g.selling_price / g.man_hours : 0,
        profit,
        profit_pct: g.selling_price !== 0 ? (profit / g.selling_price) * 100 : 0,
      }
    })
}

export function costProfitOverall(summary: CostProfitRow[]): CostProfitOverall[] {
  const years = [...new Set(summary.map((r) => r.year))].sort()
  return years.map((year) => {
    const rows = summary.filter((r) => r.year === year)
    const man_hours = rows.reduce((s, r) => s + r.man_hours, 0)
    const cost = rows.reduce((s, r) => s + r.cost, 0)
    const selling = rows.reduce((s, r) => s + r.selling_price, 0)
    const profit = selling - cost
    return {
      year,
      man_hours,
      cost,
      selling_price: selling,
      hourly_cost: man_hours > 0 ? cost / man_hours : 0,
      hourly_rate: man_hours > 0 ? selling / man_hours : 0,
      profit,
      profit_pct: selling > 0 ? (profit / selling) * 100 : 0,
    }
  })
}

const round2 = (v: number) => Math.round(v * 100) / 100

export function ticketAnalysis(
  rows: BudgetRow[],
  money: MoneyConfig,
  rates: RateConfig,
): TicketAnalysisRow[] {
  const riskFactor = rates.risk_factor_pct / 100
  const byYear = new Map<string, { man_hours: number; selling_price: number }>()
  for (const row of rows) {
    const g = byYear.get(row.year) ?? { man_hours: 0, selling_price: 0 }
    g.man_hours += row.man_hours
    g.selling_price += row.selling_price
    byYear.set(row.year, g)
  }

  const result: TicketAnalysisRow[] = []
  for (const year of [...byYear.keys()].sort()) {
    const totals = byYear.get(year)!
    const baseRate = totals.man_hours > 0 ? totals.selling_price / totals.man_hours : 0
    const finalRate = baseRate * (1 + riskFactor) + money.hw_cost_per_hour

    for (const [size, storyPoints] of Object.entries(rates.ticket_story_points)) {
      const hoursPerTicket = storyPoints * rates.sp_to_hours
      const quotaPct = (rates.ticket_quotas[year]?.[size] ?? 0) / 100
      const numTickets = hoursPerTicket > 0 ? (totals.man_hours * quotaPct) / hoursPerTicket : 0
      const totalHours = numTickets * hoursPerTicket
      result.push({
        year,
        size: size.charAt(0).toUpperCase() + size.slice(1),
        story_points: storyPoints,
        hours_per_ticket: hoursPerTicket,
        num_tickets: round2(numTickets),
        total_hours: round2(totalHours),
        hourly_rate: round2(finalRate),
        revenue: round2(totalHours * finalRate),
      })
    }
  }
  return result
}

export function ticketOverall(
  tickets: TicketAnalysisRow[],
  summary: CostProfitRow[],
): TicketOverall[] {
  const years = [...new Set(tickets.map((r) => r.year))].sort()
  return years.map((year) => {
    const revenue = tickets.filter((r) => r.year === year).reduce((s, r) => s + r.revenue, 0)
    const cost = summary.filter((r) => r.year === year).reduce((s, r) => s + r.cost, 0)
    const profit = revenue - cost
    return {
      year,
      revenue,
      cost,
      profit,
      profit_pct: revenue > 0 ? (profit / revenue) * 100 : 0,
    }
  })
}

export function budgetPivots(rows: BudgetRow[]): BudgetPivot[] {
  const years = [...new Set(rows.map((r) => r.year))].sort()
  return years.map((year) => {
    const yearRows = rows.filter((r) => r.year === year)
    const monthCols = [...new Set(yearRows.map((r) => r.month))].sort()

    const grouped = new Map<string, Record<string, number>>()
    for (const r of yearRows) {
      const key = [r.feature, r.role, r.location, r.level].join('\u0000')
      const values = grouped.get(key) ?? Object.fromEntries(monthCols.map((m) => [m, 0]))
      values[r.month] += r.selling_price
      grouped.set(key, values)
    }

    const dataRows: Record<string, string | number>[] = []
    for (const key of [...grouped.keys()].sort()) {
      const [feature, role, location, level] = key.split('\u0000')
      const values = grouped.get(key)!
      const row: Record<string, string | number> = {
        Feature: feature,
        Role: role,
        Location: location,
        Level: level,
      }
      let total = 0
      for (const m of monthCols) {
        row[m] = values[m]
        total += values[m]
      }
      row['Total'] = total
      dataRows.push(row)
    }

    const locations: string[] = []
    for (const row of dataRows) {
      const loc = row['Location'] as string
      if (!locations.includes(loc)) locations.push(loc)
    }

    const subtotals = locations.map((location) => {
      const locRows = dataRows.filter((r) => r['Location'] === location)
      const sub: Record<string, string | number> = {
        Feature: `TOTAL - ${location}`,
        Role: '',
        Location: location,
        Level: '',
      }
      for (const m of [...monthCols, 'Total']) {
        sub[m] = locRows.reduce((s, r) => s + (r[m] as number), 0)
      }
      return sub
    })

    const grand: Record<string, string | number> = {
      Feature: 'TOTAL',
      Role: '',
      Location: '',
      Level: '',
    }
    for (const m of [...monthCols, 'Total']) {
      grand[m] = dataRows.reduce((s, r) => s + (r[m] as number), 0)
    }

    return {
      year,
      columns: ['Feature', 'Role', 'Location', 'Level', ...monthCols, 'Total'],
      rows: [...dataRows, ...subtotals, grand],
    }
  })
}

/** Full budget plan — same shape the server used to return. */
export function computeBudgetPlan(
  project: Project,
  money: MoneyConfig,
  rates: RateConfig,
): BudgetPlan {
  const months = projectMonths(project)
  const rows = buildBudgetRows(project, money, months)
  const summary = costProfitSummary(rows)
  const tickets = ticketAnalysis(rows, money, rates)
  return {
    cost_profit_summary: summary,
    cost_profit_overall: costProfitOverall(summary),
    ticket_analysis: tickets,
    ticket_overall: ticketOverall(tickets, summary),
    yearly_pivots: budgetPivots(rows),
  }
}

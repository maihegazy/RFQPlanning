/** Money configuration stored ONLY inside the encrypted blob. */
export interface MoneyConfig {
  version: 1
  hourly_rates: Record<string, number> // location -> sell rate €/h
  cost_rates: Record<string, Record<string, number>> // location -> level -> cost €/h
  hw_cost_per_hour: number
  ticket_prices: Record<string, number> // size -> €
}

export function emptyMoneyConfig(locations: string[], levels: string[], sizes: string[]): MoneyConfig {
  return {
    version: 1,
    hourly_rates: Object.fromEntries(locations.map((l) => [l, 0])),
    cost_rates: Object.fromEntries(
      locations.map((l) => [l, Object.fromEntries(levels.map((lv) => [lv, 0]))]),
    ),
    hw_cost_per_hour: 0,
    ticket_prices: Object.fromEntries(sizes.map((s) => [s, 0])),
  }
}

export interface BudgetRow {
  month: string
  year: string
  feature: string
  role: string
  location: string
  level: string
  ftes: number
  man_hours: number
  selling_price: number
  cost: number
}

export interface CostProfitRow {
  year: string
  location: string
  man_hours: number
  cost: number
  selling_price: number
  hourly_cost: number
  hourly_rate: number
  profit: number
  profit_pct: number
}

export interface CostProfitOverall {
  year: string
  man_hours: number
  cost: number
  selling_price: number
  hourly_cost: number
  hourly_rate: number
  profit: number
  profit_pct: number
}

export interface TicketAnalysisRow {
  year: string
  size: string
  story_points: number
  hours_per_ticket: number
  num_tickets: number
  total_hours: number
  hourly_rate: number
  revenue: number
}

export interface TicketOverall {
  year: string
  revenue: number
  cost: number
  profit: number
  profit_pct: number
}

export interface BudgetPivot {
  year: string
  columns: string[]
  rows: Record<string, string | number>[]
}

export interface BudgetPlan {
  cost_profit_summary: CostProfitRow[]
  cost_profit_overall: CostProfitOverall[]
  ticket_analysis: TicketAnalysisRow[]
  ticket_overall: TicketOverall[]
  yearly_pivots: BudgetPivot[]
}

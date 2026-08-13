export interface AllocationPeriod {
  id?: number
  start_month: string // YYYY-MM
  end_month: string // YYYY-MM
  ftes: number
}

export interface Role {
  id: number
  feature_id: number
  name: string
  location: string
  level: string
  ftes: number
  use_advanced_allocation: boolean
  allocations: AllocationPeriod[]
}

export interface RoleInput {
  name: string
  location: string
  level: string
  ftes: number
  use_advanced_allocation: boolean
  allocations: AllocationPeriod[]
}

export interface Feature {
  id: number
  project_id: number
  name: string
  roles: Role[]
}

export interface ProjectSummary {
  id: number
  name: string
  company: string
  start_year: number
  start_month: number
  end_year: number
  end_month: number
  created_at: string
  updated_at: string
}

export interface Project extends ProjectSummary {
  features: Feature[]
}

export interface RateConfig {
  hourly_rates: Record<string, number>
  cost_rates: Record<string, Record<string, number>>
  sp_to_hours: number
  hw_cost_per_hour: number
  risk_factor_pct: number
  ticket_story_points: Record<string, number>
  ticket_prices: Record<string, number>
  ticket_quotas: Record<string, Record<string, number>>
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

export interface PivotTable {
  year: string
  columns: string[]
  rows: Record<string, string | number>[]
}

export interface BudgetPlan {
  cost_profit_summary: CostProfitRow[]
  cost_profit_overall: CostProfitOverall[]
  ticket_analysis: TicketAnalysisRow[]
  ticket_overall: TicketOverall[]
  yearly_pivots: PivotTable[]
}

export interface ResourcePlan {
  yearly_pivots: PivotTable[]
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export interface TemplateRole {
  name: string
  location: string
  level: string
  ftes: number
}

export interface TemplateFeature {
  name: string
  roles: TemplateRole[]
}

export interface ProjectTemplate {
  id: string
  name: string
  description: string
  features: TemplateFeature[]
}

export interface Meta {
  locations: string[]
  levels: string[]
  ticket_sizes: string[]
  hours_per_fte_per_month: number
}

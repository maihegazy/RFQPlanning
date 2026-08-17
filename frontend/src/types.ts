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

/** Non-monetary configuration served by the API. Money lives encrypted. */
export interface RateConfig {
  sp_to_hours: number
  risk_factor_pct: number
  ticket_story_points: Record<string, number>
  ticket_quotas: Record<string, Record<string, number>>
}

export interface PivotTable {
  year: string
  columns: string[]
  rows: Record<string, string | number>[]
}

export interface ResourcePlan {
  yearly_pivots: PivotTable[]
}

export interface VaultInfo {
  exists: boolean
  kdf_salt: string
  kdf_iterations: number
  wrapped_dek_passphrase_iv: string
  wrapped_dek_passphrase: string
  wrapped_dek_recovery_iv: string
  wrapped_dek_recovery: string
}

export interface MoneyBlob {
  encrypted_money: string | null
  money_iv: string | null
}

export interface LegacyMoney {
  hourly_rates: Record<string, number>
  cost_rates: Record<string, Record<string, number>>
  hw_cost_per_hour: number
  ticket_prices: Record<string, number>
  has_data: boolean
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

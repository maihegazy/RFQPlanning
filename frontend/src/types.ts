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

export type ProjectStatus = 'draft' | 'quoted' | 'won' | 'lost'

export interface ProjectSummary {
  id: number
  name: string
  company: string
  start_year: number
  start_month: number
  end_year: number
  end_month: number
  status: ProjectStatus
  win_probability_pct: number
  lost_reason: string | null
  base_project_id: number | null
  is_winning_scenario: boolean
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
  custom: boolean
  features: TemplateFeature[]
}

export interface Meta {
  locations: string[]
  levels: string[]
  ticket_sizes: string[]
  project_statuses: ProjectStatus[]
  hours_per_fte_per_month: number
  aspice_processes: string[]
  hardware_billing: HardwareBilling[]
}

export type HardwareBilling = 'yearly' | 'once'

export interface HardwareCatalogItem {
  id: number
  name: string
  aspice: string
  billing: HardwareBilling
  unit_cost: number
  supplier_name: string
  supplier_email: string
  created_at: string
}

export interface HardwareCatalogItemInput {
  name: string
  aspice: string
  billing: HardwareBilling
  unit_cost: number
  supplier_name: string
  supplier_email: string
}

export interface HardwareItemInput {
  catalog_item_id: number | null
  name: string
  aspice: string
  billing: HardwareBilling
  unit_cost: number
  qty: number
  years: number[]
  supplier_name: string
  supplier_email: string
}

export interface HardwareItem extends HardwareItemInput {
  id: number
  project_id: number
  total: number
}

export interface HardwarePlan {
  items: HardwareItem[]
  per_year: Record<string, number>
  grand_total: number
}

export interface PortfolioCapacity {
  months: string[]
  locations: string[]
  cells: Record<string, Record<string, number>>
  totals_by_month: Record<string, number>
  project_count: number
}

/* ---------------------------------------------------------------------------
 * Hardware Management: asset/license registers, depreciation and budget.
 * Its projects are independent of the RFQ `Project` above — purchasing runs on
 * its own project list.
 * ------------------------------------------------------------------------- */

/** Drives depreciation: only Purchase and Leasing produce actual yearly cost. */
export type HwPurchaseType = 'Purchase' | 'Leasing' | 'Planned Purchase' | 'Not Purchased'

/** How a hardware budget was approved: as one number, or split by type. */
export type HwBudgetMode = 'split' | 'overall'

export interface HwProjectInput {
  name: string
  company: string
  description: string
  budget_mode: HwBudgetMode
  /** The approved figure when `budget_mode` is 'overall'; ignored otherwise. */
  budget_total: number
  budget_assets: number
  budget_licenses: number
  /** Reserved for the later link to the company portal's project list. */
  portal_reference: string
}

export interface HwProject extends HwProjectInput {
  id: number
  created_at: string
  updated_at: string
}

export interface HwProjectRollup extends HwProject {
  asset_count: number
  license_count: number
  actual_total: number
  planned_total: number
  /**
   * The *effective* budget, unlike the field it shadows on `HwProjectInput`:
   * the entered overall figure in 'overall' mode, the sum of the two component
   * budgets in 'split' mode.
   */
  budget_total: number
  remaining: number
  licenses_expired: number
  licenses_expiring_90: number
}

export interface HwAssetInput {
  asset_tag: string
  company: string
  name: string
  serial: string
  model: string
  category: string
  status: string
  supplier: string
  /** ISO `YYYY-MM-DD`, or null when the date is unknown. */
  purchase_date: string | null
  purchase_cost: number
  order_number: string
  eol_date: string | null
  assigned_employee: string
  sw_license: string
  purchased_by: string
  purchase_type: HwPurchaseType
  catalog_item_id: number | null
}

export interface HwAsset extends HwAssetInput {
  id: number
  hw_project_id: number
  /** Server-computed depreciation keyed by calendar year, e.g. `{"2025": 1192.89}`. */
  per_year: Record<string, number>
  total: number
}

export interface HwLicenseInput {
  license_tag: string
  company: string
  name: string
  product_key: string
  expiration_date: string | null
  licensed_to_email: string
  category: string
  supplier: string
  manufacturer: string
  quantity: number
  purchase_date: string | null
  termination_date: string | null
  depreciation: HwPurchaseType
  maintained: boolean
  purchase_cost: number
  purchase_order_number: string
  notes: string
  catalog_item_id: number | null
}

export interface HwLicense extends HwLicenseInput {
  id: number
  hw_project_id: number
  per_year: Record<string, number>
  total: number
}

/** "Special Cases Budget": a manual delta added on top of a year's computed cost. */
export interface HwAdjustment {
  year: number
  kind: 'assets' | 'licenses'
  amount: number
  note: string
}

export interface HwYearRow {
  year: number
  actual_assets: number
  actual_licenses: number
  actual_total: number
  planned_assets: number
  planned_licenses: number
  planned_total: number
  grand_total: number
}

export interface HwRenewalRisk {
  expired: number
  in_30_days: number
  in_60_days: number
  in_90_days: number
}

export interface HwPivot {
  statuses: string[]
  rows: { category: string; counts: Record<string, number>; total: number }[]
}

export interface HwLicenseExpiry {
  id: number
  name: string
  manufacturer: string
  expiration_date: string
  /** Negative once the license has expired. */
  days_left: number
  hw_project_id: number
  hw_project_name: string
}

export interface HwDashboard {
  budget_total: number
  budget_assets: number
  budget_licenses: number
  spent_total: number
  planned_total: number
  remaining: number
}

export interface HwSummary {
  years: HwYearRow[]
  totals: HwYearRow
  risk: HwRenewalRisk
  expiring: HwLicenseExpiry[]
  asset_pivot: HwPivot
  license_pivot: HwPivot
  dashboard: HwDashboard
  asset_count: number
  license_count: number
  adjustments: HwAdjustment[]
}

export interface HwOverview {
  projects: HwProjectRollup[]
  years: HwYearRow[]
  totals: HwYearRow
  risk: HwRenewalRisk
  expiring: HwLicenseExpiry[]
  asset_pivot: HwPivot
  dashboard: HwDashboard
  project_count: number
  asset_count: number
  license_count: number
}

/** Result of a `dry_run=true` import: nothing has been written yet. */
export interface HwImportPreview {
  assets: HwAssetInput[]
  licenses: HwLicenseInput[]
  warnings: string[]
  sheets_found: string[]
}

export interface HwImportResult {
  created_assets: number
  created_licenses: number
  warnings: string[]
}

export interface HwMeta {
  purchase_types: HwPurchaseType[]
  asset_statuses: string[]
  asset_categories: string[]
  budget_modes: HwBudgetMode[]
  license_categories: string[]
  leasing_months: number
}

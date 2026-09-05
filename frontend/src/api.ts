import type {
  Feature,
  HardwareCatalogItem,
  HardwareCatalogItemInput,
  HardwareItem,
  HardwareItemInput,
  HardwarePlan,
  HwAdjustment,
  HwAsset,
  HwAssetInput,
  HwImportPreview,
  HwImportResult,
  HwLicense,
  HwLicenseInput,
  HwMeta,
  HwOverview,
  HwProject,
  HwProjectInput,
  HwProjectRollup,
  HwSummary,
  LegacyMoney,
  Meta,
  MoneyBlob,
  PortfolioCapacity,
  Project,
  ProjectSummary,
  ProjectTemplate,
  RateConfig,
  ResourcePlan,
  Role,
  RoleInput,
  ValidationResult,
  VaultInfo,
} from './types'

const BASE = import.meta.env.VITE_API_URL ?? ''

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** The single place a failed Response becomes an ApiError. No-op while `resp.ok`. */
async function throwForStatus(resp: Response): Promise<void> {
  if (resp.ok) return
  let detail = resp.statusText
  try {
    const body: unknown = await resp.json()
    if (body !== null && typeof body === 'object' && 'detail' in body) {
      const raw = body.detail
      if (typeof raw === 'string') detail = raw
      else if (raw) detail = JSON.stringify(raw)
    }
  } catch {
    /* keep statusText */
  }
  throw new ApiError(resp.status, detail)
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  await throwForStatus(resp)
  if (resp.status === 204) return undefined as T
  return resp.json()
}

/* `request()` pins Content-Type to application/json, which would strip the
 * multipart boundary, so the upload talks to fetch directly. */
async function importHwWorkbook(
  projectId: number,
  file: File,
  dryRun: true,
): Promise<HwImportPreview>
async function importHwWorkbook(
  projectId: number,
  file: File,
  dryRun: false,
): Promise<HwImportResult>
async function importHwWorkbook(
  projectId: number,
  file: File,
  dryRun: boolean,
): Promise<HwImportPreview | HwImportResult>
async function importHwWorkbook(
  projectId: number,
  file: File,
  dryRun: boolean,
): Promise<HwImportPreview | HwImportResult> {
  const form = new FormData()
  form.append('file', file)
  const resp = await fetch(
    `${BASE}/api/hw/projects/${projectId}/import?dry_run=${dryRun ? 'true' : 'false'}`,
    { method: 'POST', body: form },
  )
  await throwForStatus(resp)
  return resp.json()
}

export const api = {
  getMeta: () => request<Meta>('/api/meta'),
  listTemplates: () => request<ProjectTemplate[]>('/api/templates'),
  saveAsTemplate: (projectId: number, name: string, description: string) =>
    request<ProjectTemplate>(`/api/projects/${projectId}/save-as-template`, {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),
  deleteTemplate: (templateId: string) =>
    request<void>(`/api/templates/${templateId}`, { method: 'DELETE' }),

  listProjects: (opts?: { status?: string; includeScenarios?: boolean }) => {
    const params = new URLSearchParams()
    if (opts?.status) params.set('status', opts.status)
    if (opts?.includeScenarios) params.set('include_scenarios', 'true')
    const qs = params.toString()
    return request<ProjectSummary[]>(`/api/projects${qs ? `?${qs}` : ''}`)
  },
  cloneProject: (projectId: number, name: string, asScenario: boolean) =>
    request<Project>(`/api/projects/${projectId}/clone`, {
      method: 'POST',
      body: JSON.stringify({ name, as_scenario: asScenario }),
    }),
  listScenarios: (projectId: number) =>
    request<ProjectSummary[]>(`/api/projects/${projectId}/scenarios`),
  promoteScenario: (projectId: number) =>
    request<ProjectSummary>(`/api/projects/${projectId}/promote`, { method: 'POST' }),
  getPortfolioCapacity: (statuses?: string[]) =>
    request<PortfolioCapacity>(
      `/api/portfolio/capacity${statuses?.length ? `?statuses=${statuses.join(',')}` : ''}`,
    ),
  createProject: (data: Partial<ProjectSummary> & { template_id?: string | null }) =>
    request<Project>('/api/projects', { method: 'POST', body: JSON.stringify(data) }),
  getProject: (id: number) => request<Project>(`/api/projects/${id}`),
  updateProject: (id: number, data: Partial<ProjectSummary>) =>
    request<Project>(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProject: (id: number) => request<void>(`/api/projects/${id}`, { method: 'DELETE' }),
  validateProject: (id: number) => request<ValidationResult>(`/api/projects/${id}/validate`),
  exportProject: (id: number) => request<unknown>(`/api/projects/${id}/export`),
  importProject: (data: unknown) =>
    request<Project>('/api/projects/import', { method: 'POST', body: JSON.stringify(data) }),

  createFeature: (projectId: number, name: string) =>
    request<Feature>(`/api/projects/${projectId}/features`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  updateFeature: (featureId: number, name: string) =>
    request<Feature>(`/api/features/${featureId}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }),
  deleteFeature: (featureId: number) =>
    request<void>(`/api/features/${featureId}`, { method: 'DELETE' }),

  createRole: (featureId: number, data: RoleInput) =>
    request<Role>(`/api/features/${featureId}/roles`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateRole: (roleId: number, data: RoleInput) =>
    request<Role>(`/api/roles/${roleId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRole: (roleId: number) => request<void>(`/api/roles/${roleId}`, { method: 'DELETE' }),

  updateResourceGrid: (
    projectId: number,
    roles: { role_id: number; ftes_by_month: Record<string, number> }[],
  ) =>
    request<Project>(`/api/projects/${projectId}/resource-grid`, {
      method: 'PUT',
      body: JSON.stringify({ roles }),
    }),

  getRates: (projectId: number) => request<RateConfig>(`/api/projects/${projectId}/rates`),
  updateRates: (projectId: number, data: Partial<RateConfig>) =>
    request<RateConfig>(`/api/projects/${projectId}/rates`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  getResourcePlan: (projectId: number) =>
    request<ResourcePlan>(`/api/projects/${projectId}/reports/resource-plan`),

  resourcePlanXlsxUrl: (projectId: number) =>
    `${BASE}/api/projects/${projectId}/reports/resource-plan.xlsx`,

  // Hardware planning (plaintext, separate from the encrypted vault)
  listHardwareCatalog: () => request<HardwareCatalogItem[]>('/api/hardware-catalog'),
  createHardwareCatalogItem: (data: HardwareCatalogItemInput) =>
    request<HardwareCatalogItem>('/api/hardware-catalog', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateHardwareCatalogItem: (id: number, data: HardwareCatalogItemInput) =>
    request<HardwareCatalogItem>(`/api/hardware-catalog/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteHardwareCatalogItem: (id: number) =>
    request<void>(`/api/hardware-catalog/${id}`, { method: 'DELETE' }),
  getHardwarePlan: (projectId: number) =>
    request<HardwarePlan>(`/api/projects/${projectId}/hardware`),
  createHardwareItem: (projectId: number, data: HardwareItemInput) =>
    request<HardwareItem>(`/api/projects/${projectId}/hardware`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateHardwareItem: (itemId: number, data: HardwareItemInput) =>
    request<HardwareItem>(`/api/hardware-items/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteHardwareItem: (itemId: number) =>
    request<void>(`/api/hardware-items/${itemId}`, { method: 'DELETE' }),
  hardwarePlanXlsxUrl: (projectId: number) =>
    `${BASE}/api/projects/${projectId}/reports/hardware-plan.xlsx`,

  // Vault & end-to-end encrypted money
  getVault: () => request<VaultInfo>('/api/vault'),
  createVault: (keys: {
    kdf_salt: string
    kdf_iterations: number
    wrapped_dek_passphrase_iv: string
    wrapped_dek_passphrase: string
    wrapped_dek_recovery_iv: string
    wrapped_dek_recovery: string
  }) => request<VaultInfo>('/api/vault', { method: 'POST', body: JSON.stringify(keys) }),
  changeVaultPassphrase: (keys: {
    kdf_salt: string
    kdf_iterations: number
    wrapped_dek_passphrase_iv: string
    wrapped_dek_passphrase: string
  }) =>
    request<VaultInfo>('/api/vault/passphrase', {
      method: 'PUT',
      body: JSON.stringify(keys),
    }),
  getMoneyBlob: (projectId: number) =>
    request<MoneyBlob>(`/api/projects/${projectId}/financial-data`),
  putMoneyBlob: (projectId: number, blob: MoneyBlob) =>
    request<MoneyBlob>(`/api/projects/${projectId}/financial-data`, {
      method: 'PUT',
      body: JSON.stringify(blob),
    }),
  getLegacyMoney: (projectId: number) =>
    request<LegacyMoney>(`/api/projects/${projectId}/financial-data/legacy`),
  purgeLegacyMoney: (projectId: number) =>
    request<void>(`/api/projects/${projectId}/financial-data/purge-plaintext`, { method: 'POST' }),

  // Hardware management: asset/license registers, depreciation and budget
  getHwMeta: () => request<HwMeta>('/api/hw/meta'),
  getHwOverview: () => request<HwOverview>('/api/hw/overview'),

  listHwProjects: () => request<HwProjectRollup[]>('/api/hw/projects'),
  createHwProject: (data: HwProjectInput) =>
    request<HwProject>('/api/hw/projects', { method: 'POST', body: JSON.stringify(data) }),
  getHwProject: (id: number) => request<HwProject>(`/api/hw/projects/${id}`),
  updateHwProject: (id: number, data: HwProjectInput) =>
    request<HwProject>(`/api/hw/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteHwProject: (id: number) => request<void>(`/api/hw/projects/${id}`, { method: 'DELETE' }),
  getHwSummary: (projectId: number) => request<HwSummary>(`/api/hw/projects/${projectId}/summary`),

  listHwAssets: (projectId: number) => request<HwAsset[]>(`/api/hw/projects/${projectId}/assets`),
  createHwAsset: (projectId: number, data: HwAssetInput) =>
    request<HwAsset>(`/api/hw/projects/${projectId}/assets`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  replaceHwAssets: (projectId: number, items: HwAssetInput[]) =>
    request<HwAsset[]>(`/api/hw/projects/${projectId}/assets`, {
      method: 'PUT',
      body: JSON.stringify({ items }),
    }),
  updateHwAsset: (assetId: number, data: HwAssetInput) =>
    request<HwAsset>(`/api/hw/assets/${assetId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteHwAsset: (assetId: number) =>
    request<void>(`/api/hw/assets/${assetId}`, { method: 'DELETE' }),

  listHwLicenses: (projectId: number) =>
    request<HwLicense[]>(`/api/hw/projects/${projectId}/licenses`),
  createHwLicense: (projectId: number, data: HwLicenseInput) =>
    request<HwLicense>(`/api/hw/projects/${projectId}/licenses`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  replaceHwLicenses: (projectId: number, items: HwLicenseInput[]) =>
    request<HwLicense[]>(`/api/hw/projects/${projectId}/licenses`, {
      method: 'PUT',
      body: JSON.stringify({ items }),
    }),
  updateHwLicense: (licenseId: number, data: HwLicenseInput) =>
    request<HwLicense>(`/api/hw/licenses/${licenseId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteHwLicense: (licenseId: number) =>
    request<void>(`/api/hw/licenses/${licenseId}`, { method: 'DELETE' }),

  getHwAdjustments: (projectId: number) =>
    request<HwAdjustment[]>(`/api/hw/projects/${projectId}/adjustments`),
  replaceHwAdjustments: (projectId: number, items: HwAdjustment[]) =>
    request<HwAdjustment[]>(`/api/hw/projects/${projectId}/adjustments`, {
      method: 'PUT',
      body: JSON.stringify({ items }),
    }),

  hwExportXlsxUrl: (projectId: number) => `${BASE}/api/hw/projects/${projectId}/export.xlsx`,
  hwImportTemplateUrl: () => `${BASE}/api/hw/import-template.xlsx`,
  importHwWorkbook,
}

export { ApiError }

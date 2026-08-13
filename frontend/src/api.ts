import type {
  BudgetPlan,
  Feature,
  Meta,
  Project,
  ProjectSummary,
  ProjectTemplate,
  RateConfig,
  ResourcePlan,
  Role,
  RoleInput,
  ValidationResult,
} from './types'

const BASE = import.meta.env.VITE_API_URL ?? ''

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!resp.ok) {
    let detail = resp.statusText
    try {
      const body = await resp.json()
      if (typeof body.detail === 'string') detail = body.detail
      else if (body.detail) detail = JSON.stringify(body.detail)
    } catch {
      /* keep statusText */
    }
    throw new ApiError(resp.status, detail)
  }
  if (resp.status === 204) return undefined as T
  return resp.json()
}

export const api = {
  getMeta: () => request<Meta>('/api/meta'),
  listTemplates: () => request<ProjectTemplate[]>('/api/templates'),

  listProjects: () => request<ProjectSummary[]>('/api/projects'),
  createProject: (data: Partial<ProjectSummary> & { template_id?: string | null }) =>
    request<Project>('/api/projects', { method: 'POST', body: JSON.stringify(data) }),
  getProject: (id: number) => request<Project>(`/api/projects/${id}`),
  updateProject: (id: number, data: Partial<ProjectSummary>) =>
    request<Project>(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProject: (id: number) =>
    request<void>(`/api/projects/${id}`, { method: 'DELETE' }),
  validateProject: (id: number) =>
    request<ValidationResult>(`/api/projects/${id}/validate`),
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
  deleteRole: (roleId: number) =>
    request<void>(`/api/roles/${roleId}`, { method: 'DELETE' }),

  getRates: (projectId: number) =>
    request<RateConfig>(`/api/projects/${projectId}/rates`),
  updateRates: (projectId: number, data: Partial<RateConfig>) =>
    request<RateConfig>(`/api/projects/${projectId}/rates`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  getResourcePlan: (projectId: number) =>
    request<ResourcePlan>(`/api/projects/${projectId}/reports/resource-plan`),
  getBudgetPlan: (projectId: number) =>
    request<BudgetPlan>(`/api/projects/${projectId}/reports/budget-plan`),

  resourcePlanXlsxUrl: (projectId: number) =>
    `${BASE}/api/projects/${projectId}/reports/resource-plan.xlsx`,
  budgetPlanXlsxUrl: (projectId: number) =>
    `${BASE}/api/projects/${projectId}/reports/budget-plan.xlsx`,
}

export { ApiError }

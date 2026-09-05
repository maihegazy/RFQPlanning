// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import HwProjectPage from '../HwProjectPage'
import { BLANK_ASSET } from '../../hardware/registers'
import type { HwAsset, HwProject, HwSummary } from '../../types'

const { apiMock, ApiErrorStub } = vi.hoisted(() => {
  class ApiErrorStub extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  }
  return {
    ApiErrorStub,
    apiMock: {
      getHwProject: vi.fn(),
      getHwSummary: vi.fn(),
      listHwAssets: vi.fn(),
      listHwLicenses: vi.fn(),
      listHardwareCatalog: vi.fn(),
      getHwMeta: vi.fn(),
      replaceHwAssets: vi.fn(),
      hwExportXlsxUrl: (id: number) => `/api/hw/projects/${id}/export.xlsx`,
    },
  }
})
vi.mock('../../api', () => ({
  api: apiMock,
  ApiError: ApiErrorStub,
  isConflict: (e: unknown) => e instanceof ApiErrorStub && e.status === 409,
}))

const project: HwProject = {
  id: 1,
  name: 'Platform HW',
  company: 'Vehiclevo',
  description: '',
  budget_mode: 'overall',
  budget_total: 10000,
  budget_assets: 0,
  budget_licenses: 0,
  start_year: null,
  end_year: null,
  portal_reference: '',
  version: 4,
  created_at: '',
  updated_at: '',
}

const emptyYear = {
  year: 2026,
  actual_assets: 0,
  actual_licenses: 0,
  actual_total: 0,
  planned_assets: 0,
  planned_licenses: 0,
  planned_total: 0,
  grand_total: 0,
}

const summary: HwSummary = {
  years: [emptyYear],
  totals: emptyYear,
  risk: { expired: 0, in_30_days: 0, in_60_days: 0, in_90_days: 0 },
  expiring: [],
  asset_pivot: { statuses: [], rows: [] },
  license_pivot: { statuses: [], rows: [] },
  dashboard: {
    budget_total: 10000,
    budget_assets: 0,
    budget_licenses: 0,
    spent_total: 1234,
    planned_total: 0,
    remaining: 8766,
  },
  asset_count: 1,
  license_count: 0,
  uncounted_rows: 1,
  adjustments: [],
}

const asset: HwAsset = {
  ...BLANK_ASSET,
  id: 11,
  hw_project_id: 1,
  name: 'Trace32',
  purchase_type: 'Purchase',
  purchase_cost: 1234,
  per_year: { '2026': 0 },
  total: 0,
  uncounted_reason: 'no purchase date',
}

function renderPage(tab = '') {
  return render(
    <MemoryRouter initialEntries={[`/hardware/projects/1${tab}`]}>
      <Routes>
        <Route path="/hardware/projects/:hwProjectId" element={<HwProjectPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('HwProjectPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.getHwProject.mockResolvedValue(project)
    apiMock.getHwSummary.mockResolvedValue(summary)
    apiMock.listHwAssets.mockResolvedValue([asset])
    apiMock.listHwLicenses.mockResolvedValue([])
    apiMock.listHardwareCatalog.mockResolvedValue([])
    apiMock.getHwMeta.mockResolvedValue({
      purchase_types: ['Purchase', 'Leasing', 'Planned Purchase', 'Not Purchased'],
      asset_statuses: [],
      asset_categories: [],
      license_categories: [],
      budget_modes: ['split', 'overall'],
      leasing_months: 36,
    })
  })

  it('loads the project, its summary and the uncounted-rows warning', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Platform HW' })).toBeInTheDocument()
    expect(screen.getByText(/1 register row counts towards no year/)).toBeInTheDocument()
    expect(screen.getByText('1 row')).toBeInTheDocument()
  })

  it('saves the assets register with the version it was loaded at', async () => {
    apiMock.replaceHwAssets.mockResolvedValue({
      version: 5,
      items: [{ ...asset, name: 'Trace32 Pro' }],
    })
    renderPage('?tab=assets')
    const nameField = await screen.findByDisplayValue('Trace32')
    fireEvent.change(nameField, { target: { value: 'Trace32 Pro' } })
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() =>
      expect(apiMock.replaceHwAssets).toHaveBeenCalledWith(
        1,
        [expect.objectContaining({ id: 11, name: 'Trace32 Pro' })],
        4,
      ),
    )
    expect(await screen.findByText('Saved 1 asset.')).toBeInTheDocument()
    expect(apiMock.getHwSummary).toHaveBeenCalledTimes(2)
  })

  it('shows a conflict with a reload action when someone else saved first', async () => {
    apiMock.replaceHwAssets.mockRejectedValue(
      new ApiErrorStub(409, 'This hardware project was changed by someone else'),
    )
    renderPage('?tab=assets')
    fireEvent.change(await screen.findByDisplayValue('Trace32'), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/changed by someone else/)).toBeInTheDocument()
    fireEvent.click(within(alert).getByRole('button', { name: /Reload their changes/ }))
    await waitFor(() => expect(apiMock.getHwProject).toHaveBeenCalledTimes(2))
  })

  it('does not save a row that has data but no name', async () => {
    renderPage('?tab=assets')
    fireEvent.change(await screen.findByDisplayValue('Trace32'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    expect(await screen.findByText(/row 1 of the assets register has none/)).toBeInTheDocument()
    expect(apiMock.replaceHwAssets).not.toHaveBeenCalled()
  })
})

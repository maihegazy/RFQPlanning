// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import HwProjectsPage from '../HwProjectsPage'
import type { HwProject, HwProjectRollup } from '../../types'

const apiMock = vi.hoisted(() => ({
  listHwProjects: vi.fn(),
  createHwProject: vi.fn(),
}))
vi.mock('../../api', () => ({ api: apiMock, ApiError: class extends Error {} }))

function rollup(overrides: Partial<HwProjectRollup> = {}): HwProjectRollup {
  return {
    id: 1,
    name: 'Platform HW',
    company: 'Vehiclevo',
    description: '',
    budget_mode: 'overall',
    budget_total: 0,
    budget_assets: 0,
    budget_licenses: 0,
    start_year: null,
    end_year: null,
    portal_reference: '',
    version: 1,
    created_at: '',
    updated_at: '',
    asset_count: 0,
    license_count: 0,
    actual_total: 0,
    planned_total: 0,
    effective_budget: 0,
    remaining: 0,
    licenses_expired: 0,
    licenses_expiring_90: 0,
    ...overrides,
  }
}

const projects = [
  rollup({
    id: 1,
    name: 'Zeta bench',
    company: 'Vehiclevo',
    effective_budget: 1000,
    actual_total: 900,
    remaining: 100,
    asset_count: 4,
  }),
  rollup({
    id: 2,
    name: 'Alpha rig',
    company: 'Partner GmbH',
    effective_budget: 4000,
    actual_total: 400,
    remaining: 3600,
    licenses_expired: 2,
  }),
]

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/hardware/projects']}>
      <Routes>
        <Route path="/hardware/projects" element={<HwProjectsPage />} />
        <Route path="/hardware/projects/:id" element={<p>project workspace</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

/** The project name of each table row, in the order they are rendered. */
function rowNames(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getByRole('link').textContent?.trim() ?? '')
}

describe('HwProjectsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.listHwProjects.mockResolvedValue(projects)
  })

  it('lists what the server returns, with the totals of those projects only', async () => {
    renderPage()
    expect(await screen.findByText('Zeta bench')).toBeInTheDocument()
    expect(apiMock.listHwProjects).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Projects (2)')).toBeInTheDocument()

    // 1000 + 4000 budget, 900 + 400 committed, 100 + 3600 remaining; no single
    // project carries these figures, so finding them proves they were summed
    expect(screen.getByText(/5[,.]000/)).toBeInTheDocument()
    expect(screen.getByText(/1[,.]300/)).toBeInTheDocument()
    expect(screen.getByText(/3[,.]700/)).toBeInTheDocument()

    // Each row opens its own project, and expired licenses are flagged
    expect(screen.getByRole('link', { name: 'Alpha rig' })).toHaveAttribute(
      'href',
      '/hardware/projects/2',
    )
    expect(screen.getByTitle('2 expired license(s)')).toBeInTheDocument()
  })

  it('starts A→Z and re-sorts when a column header is clicked', async () => {
    renderPage()
    await screen.findByText('Zeta bench')
    expect(rowNames()).toEqual(['Alpha rig', 'Zeta bench'])

    // Committed: largest first, then reversed
    fireEvent.click(screen.getByRole('button', { name: /Committed/ }))
    expect(rowNames()).toEqual(['Zeta bench', 'Alpha rig'])
    fireEvent.click(screen.getByRole('button', { name: /Committed/ }))
    expect(rowNames()).toEqual(['Alpha rig', 'Zeta bench'])
  })

  it('filters by name or company and says when nothing matches', async () => {
    renderPage()
    await screen.findByText('Zeta bench')
    const search = screen.getByLabelText('Search projects')

    fireEvent.change(search, { target: { value: 'partner' } })
    expect(rowNames()).toEqual(['Alpha rig'])

    fireEvent.change(search, { target: { value: 'nothing here' } })
    expect(screen.getByText(/No project matches/)).toBeInTheDocument()
  })

  it('creates a project and opens its workspace', async () => {
    const created: HwProject = { ...rollup({ id: 7, name: 'New rig' }) }
    apiMock.createHwProject.mockResolvedValue(created)
    renderPage()
    await screen.findByText('Zeta bench')

    fireEvent.click(screen.getByRole('button', { name: /New Project/ }))
    const dialog = screen.getByRole('dialog', { name: 'New hardware project' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'New rig' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }))

    await waitFor(() =>
      expect(apiMock.createHwProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New rig', budget_mode: 'overall' }),
      ),
    )
    expect(await screen.findByText('project workspace')).toBeInTheDocument()
  })

  it('offers to create the first project when there is none', async () => {
    apiMock.listHwProjects.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('No hardware projects yet.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Search projects')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Create the first project/ }))
    expect(screen.getByRole('dialog', { name: 'New hardware project' })).toBeInTheDocument()
  })

  it('shows a failed load with a way to try again', async () => {
    apiMock.listHwProjects.mockRejectedValueOnce(new Error('Service Unavailable'))
    renderPage()
    expect(await screen.findByText('Service Unavailable')).toBeInTheDocument()

    apiMock.listHwProjects.mockResolvedValue(projects)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Zeta bench')).toBeInTheDocument()
  })
})

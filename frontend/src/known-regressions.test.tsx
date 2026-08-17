import { MemoryRouter } from 'react-router-dom'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import RoleModal from './components/RoleModal'
import ProjectsPage from './pages/ProjectsPage'
import InfoTab from './tabs/InfoTab'
import type { Feature, Meta, Project, Role } from './types'

const apiMock = vi.hoisted(() => ({
  updateProject: vi.fn(),
  validateProject: vi.fn(),
  listProjects: vi.fn(),
  importProject: vi.fn(),
  getMeta: vi.fn(),
  putMoneyBlob: vi.fn(),
}))

vi.mock('./api', () => ({ api: apiMock }))

const vaultMock = vi.hoisted(() => ({
  status: 'locked' as const,
  setup: vi.fn(),
  unlock: vi.fn(),
  unlockWithFile: vi.fn(),
  lock: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
}))

vi.mock('./vault/VaultContext', () => ({ useVault: () => vaultMock }))
vi.mock('./vault/VaultGate', () => ({ VaultStatusButton: () => null }))

const meta: Meta = {
  locations: ['BCC', 'HCC', 'MCC'],
  levels: ['PM/TL', 'FO', 'Principal', 'Senior', 'Standard', 'Junior'],
  ticket_sizes: ['small', 'medium', 'large'],
  project_statuses: ['draft', 'quoted', 'won', 'lost'],
  hours_per_fte_per_month: 160,
}

function project(id: number, name: string): Project {
  return {
    id,
    name,
    company: `Company ${id}`,
    start_year: 2026,
    start_month: 1,
    end_year: 2026,
    end_month: 12,
    status: 'draft',
    win_probability_pct: 50,
    lost_reason: null,
    base_project_id: null,
    is_winning_scenario: false,
    created_at: '',
    updated_at: '',
    features: [],
  }
}

describe('known frontend regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.listProjects.mockResolvedValue([])
  })

  it.fails('refreshes project-info fields when a scenario is switched', () => {
    let renderer!: ReactTestRenderer
    const first = project(1, 'Base scenario')
    const second = project(2, 'Alternative scenario')

    act(() => {
      renderer = create(<InfoTab project={first} onSaved={vi.fn()} />)
    })
    act(() => {
      renderer.update(<InfoTab project={second} onSaved={vi.fn()} />)
    })

    const nameInput = renderer.root.findAllByType('input')[0]
    expect(nameInput.props.value).toBe(second.name)
  })

  it.fails('starts a new allocation period in the month after the previous period', () => {
    const currentProject = project(1, 'Allocation project')
    const feature: Feature = {
      id: 10,
      project_id: currentProject.id,
      name: 'Feature',
      roles: [],
    }
    const role: Role = {
      id: 20,
      feature_id: feature.id,
      name: 'Developer',
      location: 'BCC',
      level: 'Senior',
      ftes: 0,
      use_advanced_allocation: true,
      allocations: [
        { id: 30, start_month: '2026-01', end_month: '2026-03', ftes: 0.5 },
      ],
    }

    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(
        <RoleModal
          project={currentProject}
          meta={meta}
          feature={feature}
          role={role}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />,
      )
    })

    const addPeriod = renderer.root
      .findAllByType('button')
      .find((button) => button.props.children === '+ Add Period')
    expect(addPeriod).toBeDefined()
    act(() => addPeriod!.props.onClick())

    const monthInputs = renderer.root
      .findAllByType('input')
      .filter((input) => input.props.type === 'month')
    expect(monthInputs[2].props.value).toBe('2026-04')
  })

  it.fails('defers a financial import until the vault is unlocked', async () => {
    const imported = project(99, 'Imported project')
    apiMock.importProject.mockResolvedValue(imported)

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(
        <MemoryRouter
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <ProjectsPage />
        </MemoryRouter>,
      )
      await Promise.resolve()
    })

    const fileInput = renderer.root
      .findAllByType('input')
      .find((input) => input.props.type === 'file')
    expect(fileInput).toBeDefined()

    const legacyFile = {
      text: async () => JSON.stringify({
        project_name: 'Imported project',
        company_name: 'Vehiclevo',
        dates: ['2026', '1', '2026', '12'],
        features: [],
        rate_config: { hourly_rates: { BCC: 100 } },
      }),
    }
    const event = { target: { files: [legacyFile], value: 'legacy.json' } }

    await act(async () => {
      fileInput!.props.onChange(event)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(apiMock.importProject).not.toHaveBeenCalled()
  })
})

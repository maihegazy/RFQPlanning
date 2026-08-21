import { describe, expect, it } from 'vitest'
import {
  benchesForUsers,
  buildAutoPlanRows,
  countEngineeringUsers,
  isProjectLead,
  planTotal,
  slotOptions,
} from './autoPlan'
import type { HardwareCatalogItem, Project, Role } from '../types'

function role(over: Partial<Role>): Role {
  return {
    id: 1,
    feature_id: 1,
    name: 'Developer',
    location: 'BCC',
    level: 'Senior',
    ftes: 1,
    use_advanced_allocation: false,
    allocations: [],
    ...over,
  }
}

function project(roles: Role[]): Project {
  return {
    id: 1,
    name: 'P',
    company: 'C',
    start_year: 2026,
    start_month: 1,
    end_year: 2027,
    end_month: 12,
    status: 'draft',
    win_probability_pct: 50,
    lost_reason: null,
    base_project_id: null,
    is_winning_scenario: false,
    created_at: '',
    updated_at: '',
    features: [{ id: 1, project_id: 1, name: 'F', roles }],
  }
}

function catalogItem(over: Partial<HardwareCatalogItem>): HardwareCatalogItem {
  return {
    id: 1,
    name: 'Mini PC',
    aspice: 'MAN.3',
    billing: 'once',
    unit_cost: 700,
    supplier_name: 'Lenovo',
    supplier_email: '',
    created_at: '',
    ...over,
  }
}

describe('project-lead detection', () => {
  it('matches the lead spellings used in the templates', () => {
    expect(isProjectLead({ name: 'Project Lead (PL)' })).toBe(true)
    expect(isProjectLead({ name: 'PL' })).toBe(true)
    expect(isProjectLead({ name: 'Project Manager' })).toBe(true)
  })

  it('leaves other roles alone', () => {
    expect(isProjectLead({ name: 'Technical Lead (TL)' })).toBe(false)
    expect(isProjectLead({ name: 'Integrator' })).toBe(false)
    expect(isProjectLead({ name: 'Developer' })).toBe(false)
  })
})

describe('headcount', () => {
  it('sums FTEs and rounds up, excluding the project lead', () => {
    const head = countEngineeringUsers(
      project([
        role({ id: 1, name: 'Project Lead (PL)', ftes: 1 }),
        role({ id: 2, name: 'Technical Lead (TL)', ftes: 1 }),
        role({ id: 3, name: 'Developer', ftes: 2 }),
        role({ id: 4, name: 'Tester', ftes: 0.5 }),
      ]),
    )
    expect(head.engineerFtes).toBe(3.5)
    expect(head.users).toBe(4) // 3.5 rounded up
    expect(head.leadFtes).toBe(1)
    expect(head.excluded).toEqual(['Project Lead (PL)'])
  })

  it('averages variable allocations across the whole timeline', () => {
    // 24 months; 1.0 FTE for the first 12 → average 0.5
    const head = countEngineeringUsers(
      project([
        role({
          id: 1,
          name: 'Developer',
          use_advanced_allocation: true,
          allocations: [{ start_month: '2026-01', end_month: '2026-12', ftes: 1 }],
        }),
      ]),
    )
    expect(head.engineerFtes).toBe(0.5)
    expect(head.users).toBe(1)
  })

  it('reports zero for a project with only a lead', () => {
    const head = countEngineeringUsers(project([role({ name: 'Project Lead (PL)' })]))
    expect(head.users).toBe(0)
    expect(head.engineerFtes).toBe(0)
  })
})

describe('bench sizing', () => {
  it('gives everyone their own bench by default', () => {
    expect(benchesForUsers(23, 1)).toBe(23)
  })

  it('divides users across shared benches, rounding up', () => {
    expect(benchesForUsers(23, 2)).toBe(12)
    expect(benchesForUsers(23, 3)).toBe(8)
    expect(benchesForUsers(6, 3)).toBe(2)
  })

  it('never divides by zero or a fraction of a user', () => {
    expect(benchesForUsers(10, 0)).toBe(10)
    expect(benchesForUsers(10, -4)).toBe(10)
  })

  it('needs no benches without users', () => {
    expect(benchesForUsers(0, 2)).toBe(0)
  })
})

describe('row generation', () => {
  const catalog: HardwareCatalogItem[] = [
    catalogItem({ id: 1, name: 'Mini PC', unit_cost: 700, billing: 'once' }),
    catalogItem({ id: 2, name: 'PowerSupply VOLTCRAFT PPS-16005', unit_cost: 222, billing: 'once' }),
    catalogItem({ id: 3, name: 'PowerDebug E40', unit_cost: 1860, billing: 'once' }),
    catalogItem({ id: 4, name: 'VN1610 CAN Network Interface', unit_cost: 859, billing: 'once' }),
    catalogItem({ id: 5, name: 'AMTS PowerSupplyBoard (PSB)', unit_cost: 1000, billing: 'once' }),
    catalogItem({
      id: 6,
      name: 'Polyspace Bug Finder (user, subscription)',
      unit_cost: 1925,
      billing: 'yearly',
    }),
  ]

  const config = {
    benches: 3,
    amtsBenches: 1,
    pcId: 1,
    powerId: 2,
    debuggerId: 3,
    vectorBoxId: 4,
    amtsBoardId: 5,
    licenceIds: { polyspace: 6 },
  }

  it('gives every bench one of each part and AMTS benches a board', () => {
    const rows = buildAutoPlanRows(project([]), catalog, config)
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]))
    expect(byName['Mini PC'].qty).toBe(3)
    expect(byName['PowerSupply VOLTCRAFT PPS-16005'].qty).toBe(3)
    expect(byName['PowerDebug E40'].qty).toBe(3)
    expect(byName['VN1610 CAN Network Interface'].qty).toBe(3)
    expect(byName['AMTS PowerSupplyBoard (PSB)'].qty).toBe(1)
    expect(byName['Polyspace Bug Finder (user, subscription)'].qty).toBe(1)
  })

  it('buys hardware up front and runs subscriptions for every year', () => {
    const rows = buildAutoPlanRows(project([]), catalog, config)
    const pc = rows.find((r) => r.name === 'Mini PC')!
    const polyspace = rows.find((r) => r.name.startsWith('Polyspace'))!
    expect(pc.years).toEqual([2026])
    expect(polyspace.years).toEqual([2026, 2027])
  })

  it('totals hardware once and subscriptions per year', () => {
    const rows = buildAutoPlanRows(project([]), catalog, config)
    // 3 × (700 + 222 + 1860 + 859) + 1 × 1000 + 1925 × 2 years
    expect(planTotal(rows)).toBe(3 * 3641 + 1000 + 3850)
  })

  it('never plans more AMTS boards than benches', () => {
    const rows = buildAutoPlanRows(project([]), catalog, { ...config, benches: 2, amtsBenches: 5 })
    expect(rows.find((r) => r.name.startsWith('AMTS'))!.qty).toBe(2)
  })

  it('skips slots left unset and produces nothing for zero benches', () => {
    const rows = buildAutoPlanRows(project([]), catalog, {
      ...config,
      benches: 0,
      amtsBenches: 0,
      licenceIds: {},
    })
    expect(rows).toEqual([])
  })

  it('links rows to their catalog entry so supplier contact stays live', () => {
    const rows = buildAutoPlanRows(project([]), catalog, config)
    expect(rows.every((r) => r.catalog_item_id !== null)).toBe(true)
  })
})

describe('slot options', () => {
  it('keeps preference order and drops deleted catalog entries', () => {
    const catalog = [catalogItem({ id: 9, name: 'PC / workstation' })]
    const options = slotOptions(catalog, ['Mini PC', 'PC / workstation'])
    expect(options.map((o) => o.name)).toEqual(['PC / workstation'])
  })
})

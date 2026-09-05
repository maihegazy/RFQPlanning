import { describe, expect, it } from 'vitest'
import { defaultSortDir, sortValue, visibleProjects } from './projectList'
import type { HwProjectRollup } from '../types'

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
  }),
  rollup({
    id: 2,
    name: 'Alpha rig',
    company: 'Partner GmbH',
    effective_budget: 4000,
    actual_total: 400,
  }),
  rollup({
    id: 3,
    name: 'Middle lab',
    company: 'Vehiclevo',
    effective_budget: 0,
    actual_total: 50,
  }),
]

const names = (rows: HwProjectRollup[]) => rows.map((row) => row.name)

describe('the hardware project list', () => {
  it('sorts by name, by money and by utilisation', () => {
    expect(names(visibleProjects(projects, '', 'name', 'asc'))).toEqual([
      'Alpha rig',
      'Middle lab',
      'Zeta bench',
    ])
    expect(names(visibleProjects(projects, '', 'effective_budget', 'desc'))).toEqual([
      'Alpha rig',
      'Zeta bench',
      'Middle lab',
    ])
    // 90% used, then 10%, and the project without a budget parks at the end
    expect(names(visibleProjects(projects, '', 'utilisation', 'desc'))).toEqual([
      'Zeta bench',
      'Alpha rig',
      'Middle lab',
    ])
    expect(sortValue(projects[2], 'utilisation')).toBe(-1)
  })

  it('searches the name and the company, ignoring case and surrounding space', () => {
    expect(names(visibleProjects(projects, '  rig ', 'name', 'asc'))).toEqual(['Alpha rig'])
    expect(names(visibleProjects(projects, 'vehiclevo', 'name', 'asc'))).toEqual([
      'Middle lab',
      'Zeta bench',
    ])
    expect(visibleProjects(projects, 'nothing here', 'name', 'asc')).toEqual([])
  })

  it('leaves the given array alone', () => {
    const before = names(projects)
    visibleProjects(projects, '', 'name', 'desc')
    expect(names(projects)).toEqual(before)
  })

  it('starts names A→Z and figures largest-first', () => {
    expect(defaultSortDir('name')).toBe('asc')
    expect(defaultSortDir('company')).toBe('asc')
    expect(defaultSortDir('actual_total')).toBe('desc')
    expect(defaultSortDir('utilisation')).toBe('desc')
  })
})

import { describe, expect, it } from 'vitest'
import { buildBudgetWorkbook } from './excelBudget'
import { computeBudgetPlan } from './engine'
import type { MoneyConfig } from './types'
import type { HardwarePlan, Project, RateConfig } from '../types'

const project: Project = {
  id: 1,
  name: 'Gateway ECU',
  company: 'Vehiclevo',
  start_year: 2026,
  start_month: 1,
  end_year: 2026,
  end_month: 12,
  status: 'draft',
  win_probability_pct: 50,
  lost_reason: null,
  base_project_id: null,
  is_winning_scenario: false,
  version: 1,
  created_at: '',
  updated_at: '',
  features: [
    {
      id: 1,
      project_id: 1,
      name: 'Platform',
      roles: [
        {
          id: 1,
          feature_id: 1,
          name: 'Developer',
          location: 'BCC',
          level: 'Senior',
          ftes: 1,
          use_advanced_allocation: false,
          allocations: [],
        },
      ],
    },
  ],
}

const money: MoneyConfig = {
  version: 1,
  hourly_rates: { BCC: 100 },
  cost_rates: { BCC: { Senior: 60 } },
  hw_cost_per_hour: 0,
  ticket_prices: { small: 0, medium: 0, large: 0 },
  rate_escalation_pct: 0,
  cost_items: [],
}

const rates: RateConfig = {
  sp_to_hours: 4,
  risk_factor_pct: 0,
  ticket_story_points: { small: 2, medium: 5, large: 10 },
  ticket_quotas: {},
  hardware_costs_per_year: { '2026': 500 },
  hardware_pass_through: true,
  version: 1,
}

const hardware: HardwarePlan = {
  items: [
    {
      id: 1,
      project_id: 1,
      catalog_item_id: null,
      name: 'Debugger',
      aspice: 'SWE.3',
      billing: 'once',
      unit_cost: 500,
      qty: 1,
      years: [2026],
      supplier_name: 'Lauterbach',
      supplier_email: '',
      total: 500,
    },
  ],
  per_year: { '2026': 500 },
  grand_total: 500,
  warnings: [],
  version: 1,
}

describe('the budget workbook', () => {
  it('carries the config, cost-profit, per-year and hardware sheets with the engine figures', async () => {
    const plan = computeBudgetPlan(project, money, rates)
    const workbook = await buildBudgetWorkbook(project, money, rates, plan, hardware)
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Config',
      'CostProfit',
      '2026',
      'Hardware',
    ])

    const costProfit = workbook.getWorksheet('CostProfit')!
    const cells: unknown[] = []
    costProfit.eachRow((row) => row.eachCell((cell) => cells.push(cell.value)))
    // 1 FTE x 12 months x 160 h = 1920 man-hours at 100 €/h sold, 60 €/h cost
    expect(cells).toContain(1920)
    expect(cells).toContain(192000)
    expect(cells).toContain(115200)
    // The hardware plan is listed among the non-labor costs, billed as a pass-through
    expect(cells).toContain('hardware plan')
    expect(cells.filter((value) => value === 500).length).toBeGreaterThanOrEqual(2)

    const hardwareSheet = workbook.getWorksheet('Hardware')!
    const names: unknown[] = []
    hardwareSheet.eachRow((row) => names.push(row.getCell(2).value))
    expect(names).toContain('Debugger')

    // The file itself is a real xlsx
    const buffer = await workbook.xlsx.writeBuffer()
    expect(new Uint8Array(buffer).slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]))
  })
})

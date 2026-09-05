/**
 * Golden-master tests for the client-side money engine.
 *
 * The expected numbers are the hand-verified values from the original
 * server-side test suite (backend/tests/test_api.py before encryption),
 * guaranteeing the TS port produces identical results to the Python
 * implementation it replaced.
 */

import { describe, expect, it } from 'vitest'
import type { Project, RateConfig } from '../types'
import { computeBudgetPlan } from './engine'
import type { MoneyConfig } from './types'

const project: Project = {
  id: 1,
  name: 'Test RFQ',
  company: 'Vehiclevo',
  start_year: 2026,
  start_month: 1,
  end_year: 2027,
  end_month: 6,
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
      name: 'ADAS',
      roles: [
        {
          id: 1,
          feature_id: 1,
          name: 'Developer',
          location: 'BCC',
          level: 'Senior',
          ftes: 1.0,
          use_advanced_allocation: false,
          allocations: [],
        },
        {
          id: 2,
          feature_id: 1,
          name: 'Architect',
          location: 'HCC',
          level: 'Principal',
          ftes: 0.0,
          use_advanced_allocation: true,
          allocations: [
            { id: 1, start_month: '2026-01', end_month: '2026-06', ftes: 0.5 },
            { id: 2, start_month: '2026-07', end_month: '2027-06', ftes: 1.0 },
          ],
        },
      ],
    },
  ],
}

const money: MoneyConfig = {
  version: 1,
  hourly_rates: { BCC: 100.0, HCC: 80.0, MCC: 0.0 },
  cost_rates: {
    BCC: { Senior: 50.0 },
    HCC: { Principal: 55.0 },
    MCC: {},
  },
  hw_cost_per_hour: 2.0,
  ticket_prices: { small: 500, medium: 1200, large: 2500 },
  rate_escalation_pct: 0,
  cost_items: [],
}

const rates: RateConfig = {
  sp_to_hours: 4.0,
  risk_factor_pct: 10.0,
  version: 1,
  ticket_story_points: { small: 2, medium: 5, large: 10 },
  ticket_quotas: {
    '2026': { small: 20, medium: 30, large: 10 },
    '2027': { small: 15, medium: 25, large: 20 },
  },
}

describe('money engine (golden master vs. original Python implementation)', () => {
  const plan = computeBudgetPlan(project, money, rates)

  it('cost-profit summary matches', () => {
    const bcc2026 = plan.cost_profit_summary.find((r) => r.year === '2026' && r.location === 'BCC')!
    // Developer 1.0 FTE x 12 months x 160h = 1920h
    expect(bcc2026.man_hours).toBeCloseTo(1920)
    expect(bcc2026.selling_price).toBeCloseTo(1920 * 100.0)
    expect(bcc2026.cost).toBeCloseTo(1920 * 50.0)
    expect(bcc2026.profit_pct).toBeCloseTo(50.0)

    // Architect: (6*0.5 + 6*1.0) * 160 = 1440h
    const hcc2026 = plan.cost_profit_summary.find((r) => r.year === '2026' && r.location === 'HCC')!
    expect(hcc2026.man_hours).toBeCloseTo(1440)
  })

  it('overall rows match', () => {
    const overall2026 = plan.cost_profit_overall.find((r) => r.year === '2026')!
    expect(overall2026.man_hours).toBeCloseTo(3360)
    expect(overall2026.selling_price).toBeCloseTo(1920 * 100 + 1440 * 80)
  })

  it('ticket analysis matches', () => {
    const totalHours = 1920 + 1440
    const avgRate = (1920 * 100.0 + 1440 * 80.0) / totalHours
    const finalRate = avgRate * 1.1 + 2.0

    const small = plan.ticket_analysis.find((r) => r.year === '2026' && r.size === 'Small')!
    expect(small.hours_per_ticket).toBeCloseTo(8.0) // 2 SP * 4 h/SP
    expect(small.num_tickets).toBeCloseTo(Math.round(((totalHours * 0.2) / 8.0) * 100) / 100)
    expect(small.hourly_rate).toBeCloseTo(Math.round(finalRate * 100) / 100)
  })

  it('ticket overall profit vs cost matches', () => {
    const overall2026 = plan.ticket_overall.find((r) => r.year === '2026')!
    const cost2026 = plan.cost_profit_summary
      .filter((r) => r.year === '2026')
      .reduce((s, r) => s + r.cost, 0)
    expect(overall2026.cost).toBeCloseTo(cost2026)
    expect(overall2026.profit).toBeCloseTo(overall2026.revenue - cost2026)
  })

  it('pivot includes location subtotals and grand total', () => {
    const pivot2026 = plan.yearly_pivots.find((p) => p.year === '2026')!
    const features = pivot2026.rows.map((r) => r['Feature'])
    expect(features).toContain('TOTAL - BCC')
    expect(features).toContain('TOTAL - HCC')
    expect(features).toContain('TOTAL')
    const grand = pivot2026.rows.find((r) => r['Feature'] === 'TOTAL')!
    expect(grand['Total'] as number).toBeCloseTo(1920 * 100.0 + 1440 * 80.0)
  })

  it('pivot year split is correct', () => {
    expect(plan.yearly_pivots.map((p) => p.year)).toEqual(['2026', '2027'])
    // 2027: Jan-Jun, Dev 6*160h*100 + Architect 6*160h*80
    const grand2027 = plan.yearly_pivots[1].rows.find((r) => r['Feature'] === 'TOTAL')!
    expect(grand2027['Total'] as number).toBeCloseTo(6 * 160 * 100 + 6 * 160 * 80)
  })

  it('yearly rate escalation compounds from the start year', () => {
    const escalated = computeBudgetPlan(project, { ...money, rate_escalation_pct: 10 }, rates)
    const y2026 = escalated.cost_profit_overall.find((r) => r.year === '2026')!
    const y2027 = escalated.cost_profit_overall.find((r) => r.year === '2027')!
    // Year 1 unchanged; year 2 rates are exactly 1.1x
    expect(y2026.selling_price).toBeCloseTo(1920 * 100 + 1440 * 80)
    // 2027 Jan-Jun: Dev 6*160h*100*1.1 + Architect 6*160h*80*1.1
    expect(y2027.selling_price).toBeCloseTo((6 * 160 * 100 + 6 * 160 * 80) * 1.1)
  })

  it('cost items: one-time, recurring clipping and pass-through', () => {
    const withItems = computeBudgetPlan(
      project,
      {
        ...money,
        cost_items: [
          // one-time inside the project
          {
            name: 'HIL bench',
            category: 'hardware',
            amount: 50000,
            is_recurring: false,
            start_month: '2026-03',
            end_month: null,
            pass_through: false,
          },
          // one-time OUTSIDE the project range -> ignored
          {
            name: 'Stale',
            category: 'other',
            amount: 99999,
            is_recurring: false,
            start_month: '2030-01',
            end_month: null,
            pass_through: false,
          },
          // recurring license clipped to 2027 (Jan-Jun = 6 months)
          {
            name: 'Tool license',
            category: 'license',
            amount: 1000,
            is_recurring: true,
            start_month: '2027-01',
            end_month: '2027-12',
            pass_through: true,
          },
        ],
      },
      rates,
    )
    const nl2026 = withItems.non_labor_summary.filter((r) => r.year === '2026')
    const nl2027 = withItems.non_labor_summary.filter((r) => r.year === '2027')
    expect(nl2026).toEqual([{ year: '2026', category: 'hardware', cost: 50000, billed: 0 }])
    // Project ends 2027-06 -> only 6 monthly occurrences
    expect(nl2027).toEqual([{ year: '2027', category: 'license', cost: 6000, billed: 6000 }])

    // Overall rows include non-labor: 2026 cost +50000, revenue unchanged;
    // 2027 cost +6000 and revenue +6000 (pass-through)
    const base = computeBudgetPlan(project, money, rates)
    const b2026 = base.cost_profit_overall.find((r) => r.year === '2026')!
    const w2026 = withItems.cost_profit_overall.find((r) => r.year === '2026')!
    expect(w2026.cost).toBeCloseTo(b2026.cost + 50000)
    expect(w2026.selling_price).toBeCloseTo(b2026.selling_price)
    const b2027 = base.cost_profit_overall.find((r) => r.year === '2027')!
    const w2027 = withItems.cost_profit_overall.find((r) => r.year === '2027')!
    expect(w2027.cost).toBeCloseTo(b2027.cost + 6000)
    expect(w2027.selling_price).toBeCloseTo(b2027.selling_price + 6000)

    // Ticket overall profit also carries the non-labor cost
    const bt = base.ticket_overall.find((r) => r.year === '2026')!
    const wt = withItems.ticket_overall.find((r) => r.year === '2026')!
    expect(wt.cost).toBeCloseTo(bt.cost + 50000)
  })

  it('zero-rate config produces zero money but correct hours', () => {
    const zeroPlan = computeBudgetPlan(
      project,
      { ...money, hourly_rates: {}, cost_rates: {}, hw_cost_per_hour: 0 },
      rates,
    )
    const overall = zeroPlan.cost_profit_overall.find((r) => r.year === '2026')!
    expect(overall.man_hours).toBeCloseTo(3360)
    expect(overall.selling_price).toBe(0)
    expect(overall.cost).toBe(0)
  })
})

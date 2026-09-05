import { describe, expect, it } from 'vitest'
import { containsFinancialData, moneyFromImport, withFinancialData } from './portable'
import { emptyMoneyConfig, type MoneyConfig } from './types'

const base = () => emptyMoneyConfig(['BCC', 'HCC'], ['Senior', 'Junior'], ['small', 'large'])

function fullConfig(): MoneyConfig {
  return {
    ...base(),
    hourly_rates: { BCC: 100, HCC: 80 },
    cost_rates: { BCC: { Senior: 60, Junior: 40 }, HCC: { Senior: 50, Junior: 30 } },
    hw_cost_per_hour: 2.5,
    ticket_prices: { small: 300, large: 900 },
    rate_escalation_pct: 3,
    cost_items: [
      {
        name: 'Test bench',
        category: 'other',
        amount: 1200,
        is_recurring: false,
        start_month: '2026-03',
        end_month: null,
        pass_through: true,
      },
    ],
  }
}

describe('the money half of the project file', () => {
  it('round-trips the whole configuration, escalation and cost items included', () => {
    const money = fullConfig()
    const file = withFinancialData({ project_name: 'X', rate_config: { sp_to_hours: 4 } }, money)
    expect(file.rate_config).toMatchObject({ sp_to_hours: 4, hourly_rates: { BCC: 100 } })
    expect(containsFinancialData(file)).toBe(true)

    const reread = moneyFromImport(JSON.parse(JSON.stringify(file)), base())
    expect(reread).toEqual(money)
  })

  it('prefers financial_data over the legacy keys when both are present', () => {
    const money = fullConfig()
    const file = withFinancialData({}, money)
    ;(file.rate_config as Record<string, unknown>).hourly_rates = { BCC: 1 }
    expect(moneyFromImport(file, base()).hourly_rates).toEqual({ BCC: 100, HCC: 80 })
  })

  it('still reads a desktop-app file that only has the legacy keys', () => {
    const file = {
      rate_config: {
        hourly_rates: { BCC: 120 },
        cost_rates: { BCC: { Senior: 70 } },
        ticket_price: { small: 250 },
        hw_cost_per_hour: 1,
      },
    }
    expect(containsFinancialData(file)).toBe(true)
    const money = moneyFromImport(file, base())
    expect(money.hourly_rates).toEqual({ BCC: 120, HCC: 0 })
    expect(money.cost_rates.BCC).toEqual({ Senior: 70, Junior: 0 })
    expect(money.cost_rates.HCC).toEqual({ Senior: 0, Junior: 0 })
    expect(money.ticket_prices).toEqual({ small: 250, large: 0 })
    expect(money.hw_cost_per_hour).toBe(1)
    expect(money.rate_escalation_pct).toBe(0)
    expect(money.cost_items).toEqual([])
  })

  it('knows a file without money when it sees one', () => {
    expect(containsFinancialData({ rate_config: { sp_to_hours: 4 } })).toBe(false)
    expect(containsFinancialData({})).toBe(false)
  })
})

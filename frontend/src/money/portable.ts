/**
 * The money half of the JSON project file.
 *
 * The server exports and imports everything that is not money; the browser
 * merges the decrypted configuration into the file on the way out and encrypts
 * it again on the way in. A file written by this app carries the whole
 * configuration under `financial_data`; a file from the desktop app only has
 * the four legacy money keys inside `rate_config`.
 */
import { normalizeMoneyConfig, type MoneyConfig } from './types'

export type LegacyImport = {
  rate_config?: Record<string, unknown>
  financial_data?: Partial<MoneyConfig>
  [key: string]: unknown
}

export function containsFinancialData(data: LegacyImport): boolean {
  if (data.financial_data && typeof data.financial_data === 'object') return true
  const rates = data.rate_config ?? {}
  return Boolean(
    rates.hourly_rates || rates.cost_rates || rates.ticket_price || rates.hw_cost_per_hour,
  )
}

type RateMaps = Pick<MoneyConfig, 'hourly_rates' | 'cost_rates' | 'ticket_prices'>

/** The file's rate maps on top of the defaults, so a missing location or size
 *  still has a value. */
function mergeRates(
  base: MoneyConfig,
  hourly: object | undefined,
  cost: Record<string, object> | undefined,
  tickets: object | undefined,
): RateMaps {
  return {
    hourly_rates: { ...base.hourly_rates, ...(hourly ?? {}) },
    cost_rates: Object.fromEntries(
      Object.keys(base.cost_rates).map((location) => [
        location,
        { ...base.cost_rates[location], ...(cost?.[location] ?? {}) },
      ]),
    ),
    ticket_prices: { ...base.ticket_prices, ...(tickets ?? {}) },
  }
}

/** The money configuration an import file carries, `financial_data` first. */
export function moneyFromImport(data: LegacyImport, base: MoneyConfig): MoneyConfig {
  const full = data.financial_data
  if (full && typeof full === 'object') {
    return normalizeMoneyConfig({
      ...base,
      ...mergeRates(
        base,
        full.hourly_rates,
        full.cost_rates as Record<string, object> | undefined,
        full.ticket_prices,
      ),
      hw_cost_per_hour: Number(full.hw_cost_per_hour ?? 0),
      rate_escalation_pct: Number(full.rate_escalation_pct ?? 0),
      cost_items: Array.isArray(full.cost_items) ? full.cost_items : [],
      version: 1,
    })
  }

  const rates = data.rate_config ?? {}
  return {
    ...base,
    ...mergeRates(
      base,
      rates.hourly_rates as object | undefined,
      rates.cost_rates as Record<string, object> | undefined,
      rates.ticket_price as object | undefined,
    ),
    hw_cost_per_hour: Number(rates.hw_cost_per_hour ?? 0),
  }
}

/**
 * Put the decrypted money into an export. The legacy keys keep the file
 * readable by the desktop app; the whole configuration (escalation, cost
 * items) travels under `financial_data`.
 */
export function withFinancialData(data: LegacyImport, money: MoneyConfig): LegacyImport {
  data.rate_config = {
    ...(data.rate_config ?? {}),
    hourly_rates: money.hourly_rates,
    cost_rates: money.cost_rates,
    hw_cost_per_hour: money.hw_cost_per_hour,
    ticket_price: money.ticket_prices,
  }
  data.financial_data = money
  return data
}

/**
 * Hardware depreciation engine — the TypeScript mirror of the server's
 * `app/services/hw_depreciation.py`.
 *
 * The register grids need per-year costs while the user is still typing, so the
 * rule the working document encodes lives on both sides of the wire. The server
 * stays the source of truth for the stored summary and the export; this module
 * only has to agree with it to the cent.
 *
 * Two rules, straight out of the sheet:
 *   - Leasing amortises over a fixed 36 months and is billed for every month the
 *     lease touches inside the year, counting both the first and the last.
 *   - A purchase lands whole in its purchase year; everything else costs nothing
 *     until it is actually bought.
 */

/** The working document amortises every lease over 36 months, whatever its term. */
export const LEASING_MONTHS = 36

/** Widest year span `yearSpan` will report, so one mistyped date cannot render
 *  a thousand columns. */
export const MAX_SPAN_YEARS = 40

/**
 * A date as the module accepts it: a real `Date`, an ISO `YYYY-MM-DD` string
 * (what the API and `<input type="date">` both produce), or nothing.
 */
export type DateInput = Date | string | null | undefined

/** Asset fields the engine reads. `HwAssetInput` and `HwAsset` both satisfy it. */
export interface DepreciableAsset {
  purchase_type: string
  purchase_date: string | null
  eol_date: string | null
  purchase_cost: number
}

/** License fields the engine reads. `HwLicenseInput` and `HwLicense` both satisfy it. */
export interface DepreciableLicense {
  depreciation: string
  purchase_date: string | null
  termination_date: string | null
  purchase_cost: number
}

/** Any register row `yearSpan` can take a year from — assets and licenses mix freely. */
export interface DepreciationRow {
  purchase_date?: string | null
  eol_date?: string | null
  termination_date?: string | null
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/

/**
 * Parse `YYYY-MM-DD` into a local midnight `Date`, or null when there is no
 * usable date.
 *
 * Deliberately hand-rolled: `new Date('2025-07-02')` is parsed as UTC midnight
 * and reads back as July 1st for anyone west of Greenwich, which would shift a
 * lease by a whole month at a year boundary. Building the date from its parts
 * keeps every field the user typed intact in every timezone. A leading date
 * followed by a time (`2025-07-02T00:00:00`) is accepted too, since a datetime
 * column can reach the client that way.
 */
export function parseIsoDate(value: string | null): Date | null {
  if (value === null) return null
  const match = ISO_DATE.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  // Out-of-range parts roll over silently (Feb 30th becomes March 2nd), and
  // years under 100 are remapped into the 1900s. Reject rather than drift.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return date
}

function toDate(value: DateInput): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  return parseIsoDate(value ?? null)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Whole months from `a` to `b`, rolling back when `b` falls earlier in the
 * month than `a` — Jan 31 to Feb 28 is zero complete months, not one.
 */
export function completeMonths(a: Date, b: Date): number {
  return (
    (b.getFullYear() - a.getFullYear()) * 12 +
    (b.getMonth() - a.getMonth()) -
    (b.getDate() < a.getDate() ? 1 : 0)
  )
}

/**
 * Cost that a row charges to one calendar year.
 *
 * `kind` is the row's Purchase Type / Depreciation, matched case-insensitively.
 * The returned value is unrounded so it can be summed before being presented;
 * `perYear` rounds what it hands to the UI.
 */
export function yearCost(
  year: number,
  kind: string,
  purchaseDate: DateInput,
  endDate: DateInput,
  cost: number,
): number {
  const purchase = toDate(purchaseDate)
  switch (kind.trim().toUpperCase()) {
    case 'LEASING': {
      const end = toDate(endDate)
      if (!purchase || !end) return 0
      const janFirst = new Date(year, 0, 1)
      const decLast = new Date(year, 11, 31)
      const start = purchase > janFirst ? purchase : janFirst
      const stop = end < decLast ? end : decLast
      if (start > stop) return 0
      // Both the opening and the closing month are billed, hence the +1.
      return (cost / LEASING_MONTHS) * (completeMonths(start, stop) + 1)
    }
    case 'PURCHASE':
      return purchase !== null && purchase.getFullYear() === year ? cost : 0
    default:
      // Planned Purchase and Not Purchased have not cost anything yet.
      return 0
  }
}

/**
 * Cost per year for one row, keyed by year as a string to match the
 * `per_year` maps the API returns.
 *
 * Values are rounded to cents exactly as the server rounds them, so a saved row
 * shows the same figures it showed while being edited.
 */
export function perYear(
  kind: string,
  purchaseDate: DateInput,
  endDate: DateInput,
  cost: number,
  years: number[],
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const year of years) {
    result[String(year)] = round2(yearCost(year, kind, purchaseDate, endDate, cost))
  }
  return result
}

/**
 * The contiguous run of years the given rows touch, from the earliest to the
 * latest purchase, end-of-life or termination date. Falls back to the current
 * year when the rows carry no dates at all; `extraYears` forces a project's own
 * start/end years into the span.
 */
export function yearSpan(rows: DepreciationRow[], extraYears: number[] = []): number[] {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  const note = (year: number) => {
    if (year < min) min = year
    if (year > max) max = year
  }
  for (const row of rows) {
    for (const value of [row.purchase_date, row.eol_date, row.termination_date]) {
      const date = parseIsoDate(value ?? null)
      if (date !== null) note(date.getFullYear())
    }
  }
  for (const year of extraYears) {
    if (Number.isFinite(year)) note(Math.trunc(year))
  }

  if (min === Number.POSITIVE_INFINITY) return [new Date().getFullYear()]
  const length = Math.min(max - min + 1, MAX_SPAN_YEARS)
  return Array.from({ length }, (_, index) => min + index)
}

/** Cost an asset charges to `year`; its lease runs until its end-of-life date. */
export function assetYearCost(asset: DepreciableAsset, year: number): number {
  return yearCost(
    year,
    asset.purchase_type,
    asset.purchase_date,
    asset.eol_date,
    asset.purchase_cost,
  )
}

/** Cost a license charges to `year`; its lease runs until its termination date
 *  (the expiration date drives renewal risk, not depreciation). */
export function licenseYearCost(license: DepreciableLicense, year: number): number {
  return yearCost(
    year,
    license.depreciation,
    license.purchase_date,
    license.termination_date,
    license.purchase_cost,
  )
}

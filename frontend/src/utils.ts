export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function formatMonth(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}

export function monthRange(start: string, end: string): string[] {
  const [sy, sm] = start.split('-').map(Number)
  const [ey, em] = end.split('-').map(Number)
  const months: string[] = []
  let y = sy
  let m = sm
  while (y < ey || (y === ey && m <= em)) {
    months.push(formatMonth(y, m))
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return months
}

export function nextMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return monthNumber === 12 ? formatMonth(year + 1, 1) : formatMonth(year, monthNumber + 1)
}

/**
 * Numbers follow the browser's locale: a German-speaking user reads
 * "1.234,56", an English-speaking one "1,234.56". Excel exports carry number
 * formats rather than these strings, so they are unaffected.
 */
export function formatNumber(value: unknown, decimals = 2): string {
  if (typeof value !== 'number') return String(value ?? '')
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

const euro = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatEuro(value: number): string {
  return euro.format(value)
}

export function projectYears(startYear: number, endYear: number): number[] {
  const years: number[] = []
  for (let y = startYear; y <= endYear; y++) years.push(y)
  return years
}

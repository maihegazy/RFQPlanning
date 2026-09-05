import { describe, expect, it } from 'vitest'
import {
  assetUncountedReason,
  assetYearCost,
  completeMonths,
  FIRST_YEAR,
  LAST_YEAR,
  licenseUncountedReason,
  licenseYearCost,
  MAX_SPAN_YEARS,
  parseIsoDate,
  perYear,
  uncountedReason,
  yearCost,
  yearSpan,
  type DepreciableAsset,
  type DepreciableLicense,
} from './depreciation'

/** Rows lifted straight out of the customer's workbook (Licenses sheet). These
 *  are the numbers the sheet shows today; the engine has to reproduce them. */
const GOLDEN = [
  {
    purchase: '2025-07-02',
    end: '2028-07-02',
    cost: 7157.35,
    kind: 'Leasing',
    year: 2025,
    expected: 1192.8916666666669,
  },
  {
    purchase: '2025-07-02',
    end: '2028-07-02',
    cost: 7157.35,
    kind: 'Leasing',
    year: 2026,
    expected: 2385.7833333333338,
  },
  {
    purchase: '2025-07-02',
    end: '2028-07-02',
    cost: 7157.35,
    kind: 'Leasing',
    year: 2028,
    expected: 1391.7069444444446,
  },
  {
    purchase: '2025-09-01',
    end: '2026-02-07',
    cost: 564.57,
    kind: 'Leasing',
    year: 2025,
    expected: 62.730000000000004,
  },
  {
    purchase: '2025-09-01',
    end: '2026-02-07',
    cost: 564.57,
    kind: 'Leasing',
    year: 2026,
    expected: 31.365000000000002,
  },
  {
    purchase: '2023-08-03',
    end: '2026-08-03',
    cost: 12550.89,
    kind: 'Leasing',
    year: 2023,
    expected: 1743.1791666666666,
  },
  {
    purchase: '2023-08-03',
    end: '2026-08-03',
    cost: 12550.89,
    kind: 'Leasing',
    year: 2026,
    expected: 2789.0866666666666,
  },
  {
    purchase: '2023-12-20',
    end: '2026-12-20',
    cost: 4689.71,
    kind: 'Leasing',
    year: 2023,
    expected: 130.2697222222222,
  },
  {
    purchase: '2025-07-02',
    end: '2026-07-09',
    cost: 9877,
    kind: 'Purchase',
    year: 2025,
    expected: 9877,
  },
  {
    purchase: '2025-07-02',
    end: '2026-07-09',
    cost: 9877,
    kind: 'Purchase',
    year: 2026,
    expected: 0,
  },
]

function asset(over: Partial<DepreciableAsset>): DepreciableAsset {
  return {
    purchase_type: 'Purchase',
    purchase_date: null,
    eol_date: null,
    purchase_cost: 0,
    ...over,
  }
}

function license(over: Partial<DepreciableLicense>): DepreciableLicense {
  return {
    depreciation: 'Purchase',
    purchase_date: null,
    termination_date: null,
    purchase_cost: 0,
    ...over,
  }
}

describe('golden cases from the working document', () => {
  for (const row of GOLDEN) {
    it(`${row.kind} ${row.purchase}..${row.end} charges ${row.expected} to ${row.year}`, () => {
      const actual = yearCost(row.year, row.kind, row.purchase, row.end, row.cost)
      expect(Math.abs(actual - row.expected)).toBeLessThan(1e-6)
    })
  }

  it('gives the same answer for parsed Dates as for ISO strings', () => {
    for (const row of GOLDEN) {
      const fromDates = yearCost(
        row.year,
        row.kind,
        parseIsoDate(row.purchase),
        parseIsoDate(row.end),
        row.cost,
      )
      expect(fromDates).toBe(yearCost(row.year, row.kind, row.purchase, row.end, row.cost))
    }
  })

  it('spreads the full lease across its years without inventing cost', () => {
    // 2025-07-02..2028-07-02 is 37 billed months over a 36-month amortisation.
    const total = [2025, 2026, 2027, 2028].reduce(
      (sum, year) => sum + yearCost(year, 'Leasing', '2025-07-02', '2028-07-02', 7157.35),
      0,
    )
    expect(total).toBeCloseTo((7157.35 / 36) * 37, 9)
  })
})

describe('parseIsoDate', () => {
  it('keeps the day the user typed in every timezone', () => {
    const date = parseIsoDate('2025-07-02')
    expect(date).not.toBeNull()
    // Local getters, because a UTC-parsed ISO string reads back a day early
    // anywhere west of Greenwich.
    expect(date?.getFullYear()).toBe(2025)
    expect(date?.getMonth()).toBe(6)
    expect(date?.getDate()).toBe(2)
    expect(date?.getHours()).toBe(0)
  })

  it('accepts a datetime by taking its date part', () => {
    const date = parseIsoDate('2023-12-20T00:00:00')
    expect(date?.getDate()).toBe(20)
    expect(date?.getMonth()).toBe(11)
  })

  it('returns null for anything unusable', () => {
    expect(parseIsoDate(null)).toBeNull()
    expect(parseIsoDate('')).toBeNull()
    expect(parseIsoDate('   ')).toBeNull()
    expect(parseIsoDate('02.07.2025')).toBeNull()
    expect(parseIsoDate('not a date')).toBeNull()
  })

  it('rejects impossible dates instead of rolling them over', () => {
    expect(parseIsoDate('2025-02-30')).toBeNull()
    expect(parseIsoDate('2025-13-01')).toBeNull()
    expect(parseIsoDate('2025-00-10')).toBeNull()
    expect(parseIsoDate('0099-01-01')).toBeNull()
    expect(parseIsoDate('2024-02-29')?.getDate()).toBe(29) // real leap day survives
  })
})

describe('completeMonths', () => {
  it('rolls back when the end day is earlier in the month than the start day', () => {
    expect(completeMonths(new Date(2025, 0, 31), new Date(2025, 1, 28))).toBe(0)
    expect(completeMonths(new Date(2025, 2, 31), new Date(2025, 5, 30))).toBe(2)
    expect(completeMonths(new Date(2025, 0, 15), new Date(2025, 1, 14))).toBe(0)
    expect(completeMonths(new Date(2025, 0, 15), new Date(2025, 1, 15))).toBe(1)
  })

  it('is zero inside a single month', () => {
    expect(completeMonths(new Date(2025, 2, 5), new Date(2025, 2, 20))).toBe(0)
    expect(completeMonths(new Date(2025, 2, 5), new Date(2025, 2, 5))).toBe(0)
  })

  it('counts across years', () => {
    expect(completeMonths(new Date(2023, 7, 3), new Date(2026, 7, 3))).toBe(36)
    expect(completeMonths(new Date(2025, 6, 2), new Date(2025, 11, 31))).toBe(5)
  })
})

describe('missing dates', () => {
  it('charges nothing for a lease without a purchase or an end date', () => {
    expect(yearCost(2025, 'Leasing', null, '2028-07-02', 7157.35)).toBe(0)
    expect(yearCost(2025, 'Leasing', '2025-07-02', null, 7157.35)).toBe(0)
    expect(yearCost(2025, 'Leasing', null, null, 7157.35)).toBe(0)
    expect(yearCost(2025, 'Leasing', '', '', 7157.35)).toBe(0)
  })

  it('charges nothing for a purchase without a purchase date', () => {
    expect(yearCost(2025, 'Purchase', null, '2026-07-09', 9877)).toBe(0)
    expect(yearCost(2025, 'Purchase', '', null, 9877)).toBe(0)
  })
})

describe('years outside the row', () => {
  it('charges a purchase to no year but its own', () => {
    expect(yearCost(2024, 'Purchase', '2025-07-02', '2026-07-09', 9877)).toBe(0)
    expect(yearCost(2027, 'Purchase', '2025-07-02', '2026-07-09', 9877)).toBe(0)
    expect(yearCost(2025, 'Purchase', '2025-07-02', '2026-07-09', 9877)).toBe(9877)
  })

  it('charges a lease nothing for a year it does not overlap', () => {
    expect(yearCost(2024, 'Leasing', '2025-07-02', '2028-07-02', 7157.35)).toBe(0)
    expect(yearCost(2029, 'Leasing', '2025-07-02', '2028-07-02', 7157.35)).toBe(0)
  })

  it('bills the single month of a lease that starts and ends inside one month', () => {
    expect(yearCost(2025, 'Leasing', '2025-03-05', '2025-03-20', 3600)).toBeCloseTo(100, 9)
  })
})

describe('purchase types that have not cost anything yet', () => {
  it('returns 0 for Planned Purchase and Not Purchased', () => {
    for (const kind of ['Planned Purchase', 'Not Purchased']) {
      expect(yearCost(2025, kind, '2025-07-02', '2028-07-02', 7157.35)).toBe(0)
      expect(yearCost(2025, kind, '2025-07-02', null, 9877)).toBe(0)
    }
  })

  it('returns 0 for an empty or unknown type', () => {
    expect(yearCost(2025, '', '2025-07-02', '2028-07-02', 7157.35)).toBe(0)
    expect(yearCost(2025, 'Rented', '2025-07-02', '2028-07-02', 7157.35)).toBe(0)
  })

  it('matches the type case- and whitespace-insensitively', () => {
    expect(yearCost(2025, '  leasing ', '2025-07-02', '2028-07-02', 7157.35)).toBeCloseTo(
      1192.891666666667,
      6,
    )
    expect(yearCost(2025, 'PURCHASE', '2025-07-02', null, 9877)).toBe(9877)
  })
})

describe('perYear', () => {
  it('keys costs by year as a string and rounds to cents', () => {
    expect(perYear('Leasing', '2025-07-02', '2028-07-02', 7157.35, [2024, 2025, 2026])).toEqual({
      '2024': 0,
      '2025': 1192.89,
      '2026': 2385.78,
    })
  })

  it('returns an empty map for no years', () => {
    expect(perYear('Purchase', '2025-07-02', null, 9877, [])).toEqual({})
  })
})

describe('yearSpan', () => {
  it('runs from the earliest to the latest date on any row', () => {
    expect(
      yearSpan([
        { purchase_date: '2025-07-02', eol_date: '2027-01-10' },
        { purchase_date: '2023-08-03', termination_date: '2026-08-03' },
      ]),
    ).toEqual([2023, 2024, 2025, 2026, 2027])
  })

  it('ignores unusable dates and falls back to this year with nothing to go on', () => {
    const thisYear = new Date().getFullYear()
    expect(yearSpan([])).toEqual([thisYear])
    expect(yearSpan([{ purchase_date: null, eol_date: '' }])).toEqual([thisYear])
  })

  it('always covers the years it is handed explicitly', () => {
    expect(yearSpan([{ purchase_date: '2025-07-02' }], [2024, 2026])).toEqual([2024, 2025, 2026])
    expect(yearSpan([], [2030])).toEqual([2030])
  })

  it('caps a run of real years at a sane number of columns', () => {
    const span = yearSpan([{ purchase_date: '2025-07-02', eol_date: '2099-07-02' }])
    expect(span).toHaveLength(MAX_SPAN_YEARS)
    expect(span[0]).toBe(2025)
  })

  it('leaves a mistyped date out of the span instead of widening it', () => {
    expect(
      yearSpan([
        { purchase_date: '0225-07-02', eol_date: '2028-07-02' },
        { purchase_date: '2025-07-02', termination_date: '2925-07-02' },
      ]),
    ).toEqual([2025, 2026, 2027, 2028])
    expect(yearSpan([], [1, 2026, 99999])).toEqual([2026])
    expect(FIRST_YEAR).toBe(1990)
    expect(LAST_YEAR).toBe(2100)
  })
})

describe('the date window', () => {
  it('charges nothing for a row whose date is a typo', () => {
    expect(yearCost(2025, 'Leasing', '0225-07-02', '2028-07-02', 7157.35)).toBe(0)
    expect(yearCost(2026, 'Leasing', '2025-07-02', '2205-07-02', 7157.35)).toBe(0)
    expect(yearCost(225, 'Purchase', '0225-07-02', null, 9877)).toBe(0)
    // ... but a date on the edge of the window is still data
    expect(yearCost(2100, 'Purchase', '2100-12-31', null, 9877)).toBe(9877)
    expect(yearCost(1990, 'Leasing', '1990-01-01', '1992-12-31', 3600)).toBeCloseTo(1200, 6)
  })
})

describe('uncountedReason', () => {
  it("names the reason a row contributes nothing, in the server's words", () => {
    expect(uncountedReason('', null, null, 100)).toBe('no purchase type')
    expect(uncountedReason('Rental', '2026-01-01', null, 100)).toBe(
      "unknown purchase type 'Rental'",
    )
    expect(uncountedReason('Purchase', null, null, 100)).toBe('no purchase date')
    expect(uncountedReason('Purchase', '0225-01-01', null, 100)).toBe(
      'purchase date outside 1990-2100',
    )
    expect(uncountedReason('Leasing', '2026-01-01', null, 100)).toBe('no end date')
    expect(uncountedReason('Leasing', '2026-01-01', '2205-01-01', 100)).toBe(
      'end date outside 1990-2100',
    )
    expect(uncountedReason('Leasing', '2026-01-01', '2025-01-01', 100)).toBe(
      'end date before purchase date',
    )
  })

  it('does not flag rows that are deliberately free of cost', () => {
    expect(uncountedReason('Not Purchased', null, null, 100)).toBeNull()
    expect(uncountedReason('Purchase', null, null, 0)).toBeNull()
    expect(uncountedReason('Planned Purchase', '2026-01-01', null, 100)).toBeNull()
    expect(uncountedReason('Purchase', '2026-01-01', null, 100)).toBeNull()
    expect(uncountedReason('Leasing', '2026-01-01', '2029-01-01', 100)).toBeNull()
  })

  it('reads the right dates off assets and licenses', () => {
    const asset: DepreciableAsset = {
      purchase_type: 'Leasing',
      purchase_date: '2026-01-01',
      eol_date: null,
      purchase_cost: 100,
    }
    expect(assetUncountedReason(asset)).toBe('no end date')
    const license: DepreciableLicense = {
      depreciation: 'Leasing',
      purchase_date: '2026-01-01',
      termination_date: '2029-01-01',
      purchase_cost: 100,
    }
    expect(licenseUncountedReason(license)).toBeNull()
  })
})

describe('row wrappers', () => {
  it('depreciates an asset over its end-of-life date', () => {
    const leased = asset({
      purchase_type: 'Leasing',
      purchase_date: '2023-08-03',
      eol_date: '2026-08-03',
      purchase_cost: 12550.89,
    })
    expect(assetYearCost(leased, 2023)).toBeCloseTo(1743.1791666666666, 6)
    expect(assetYearCost(leased, 2026)).toBeCloseTo(2789.0866666666666, 6)
    expect(assetYearCost(leased, 2022)).toBe(0)
  })

  it('books an asset purchase in its purchase year only', () => {
    const bought = asset({ purchase_date: '2025-07-02', purchase_cost: 9877 })
    expect(assetYearCost(bought, 2025)).toBe(9877)
    expect(assetYearCost(bought, 2026)).toBe(0)
  })

  it('depreciates a license over its termination date, not its expiration date', () => {
    const leased = license({
      depreciation: 'Leasing',
      purchase_date: '2025-09-01',
      termination_date: '2026-02-07',
      purchase_cost: 564.57,
    })
    expect(licenseYearCost(leased, 2025)).toBeCloseTo(62.730000000000004, 6)
    expect(licenseYearCost(leased, 2026)).toBeCloseTo(31.365000000000002, 6)
  })

  it('charges nothing for a license that is only planned', () => {
    const planned = license({
      depreciation: 'Planned Purchase',
      purchase_date: '2026-01-15',
      purchase_cost: 4200,
    })
    expect(licenseYearCost(planned, 2026)).toBe(0)
  })
})

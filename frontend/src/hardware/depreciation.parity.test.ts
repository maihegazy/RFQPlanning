import { describe, expect, it } from 'vitest'
import { perYear } from './depreciation'

/**
 * The depreciation rule exists twice — here for live feedback while a register
 * is being edited, and in `app/services/hw_depreciation.py` for the summaries
 * and the export. If the two ever drift, a grid would show one number and the
 * saved row another.
 *
 * `python` below is the literal output of the Python engine for the same input.
 * Regenerate it by running per_year() over these cases; do not hand-edit it.
 */
const CASES = [
  {
    kind: 'Leasing',
    purchase: '2025-07-02',
    end: '2028-07-02',
    cost: 7157.35,
    python: { '2025': 1192.89, '2026': 2385.78, '2027': 2385.78, '2028': 1391.71 },
  },
  {
    kind: 'Leasing',
    purchase: '2025-09-01',
    end: '2026-02-07',
    cost: 564.57,
    python: { '2025': 62.73, '2026': 31.37 },
  },
  {
    kind: 'Leasing',
    purchase: '2023-08-03',
    end: '2026-08-03',
    cost: 12550.89,
    python: { '2023': 1743.18, '2024': 4183.63, '2025': 4183.63, '2026': 2789.09 },
  },
  {
    kind: 'Leasing',
    purchase: '2023-12-20',
    end: '2026-12-20',
    cost: 4689.71,
    python: { '2023': 130.27, '2024': 1563.24, '2025': 1563.24, '2026': 1563.24 },
  },
  {
    kind: 'Purchase',
    purchase: '2025-07-02',
    end: '2026-07-09',
    cost: 9877,
    python: { '2025': 9877.0 },
  },
  {
    kind: 'Leasing',
    purchase: '2026-01-31',
    end: '2026-03-30',
    cost: 1000,
    python: { '2026': 55.56 },
  },
  {
    kind: 'Leasing',
    purchase: '2024-02-29',
    end: '2027-02-28',
    cost: 3333.33,
    python: { '2024': 1018.52, '2025': 1111.11, '2026': 1111.11, '2027': 185.19 },
  },
  {
    kind: 'Leasing',
    purchase: '2025-12-31',
    end: '2026-01-01',
    cost: 99.99,
    python: { '2025': 2.78, '2026': 2.78 },
  },
  {
    kind: 'Planned Purchase',
    purchase: '2026-07-01',
    end: null,
    cost: 2147.16,
    python: {},
  },
  {
    kind: 'Not Purchased',
    purchase: null,
    end: null,
    cost: 500,
    python: {},
  },
  {
    kind: 'Leasing',
    purchase: '2025-01-01',
    end: '2025-01-01',
    cost: 120,
    python: { '2025': 3.33 },
  },
  {
    kind: 'Purchase',
    purchase: '2026-12-31',
    end: null,
    cost: 0.01,
    python: { '2026': 0.01 },
  },
]

const YEARS = Array.from({ length: 9 }, (_, i) => 2022 + i)

describe('the TypeScript engine matches the Python engine', () => {
  for (const { kind, purchase, end, cost, python } of CASES) {
    it(`${kind} ${purchase ?? 'no date'} to ${end ?? 'no date'} at ${cost}`, () => {
      const actual = perYear(kind, purchase, end, cost, YEARS)
      // Only the paying years are pinned; the rest must be exactly zero.
      for (const [year, value] of Object.entries(python)) {
        expect(actual[year]).toBe(value)
      }
      const paying = Object.keys(python)
      for (const year of YEARS.map(String)) {
        if (!paying.includes(year)) expect(actual[year]).toBe(0)
      }
    })
  }
})

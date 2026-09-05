/**
 * Helpers shared by the hardware registers (the Assets and Licenses grids, the
 * project page that saves them, and the import dialog).
 */
import type { HwAssetInput, HwLicenseInput } from '../types'
import { parseIsoDate } from './depreciation'

export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * `<input type="date">` renders blank for anything that is not exactly
 * `YYYY-MM-DD`, and the register was imported from a workbook that can hand us
 * a full datetime. Normalising here keeps a stored date visible instead of
 * silently looking empty (and being wiped by the next edit).
 */
export function dateInputValue(value: string | null): string {
  const parsed = parseIsoDate(value)
  if (parsed === null) return ''
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`
}

/**
 * The vocabulary plus the row's own value when the workbook holds free text the
 * dropdown does not know — picking another option must be a deliberate act, not
 * a side effect of opening the list.
 */
export function withCurrent(options: readonly string[], current: string): string[] {
  return current !== '' && !options.includes(current) ? [...options, current] : [...options]
}

export function isPlanned(purchaseType: string): boolean {
  return purchaseType.trim().toUpperCase() === 'PLANNED PURCHASE'
}

/** A fresh asset line: nothing bought, nothing known yet. */
export const BLANK_ASSET: HwAssetInput = {
  asset_tag: '',
  company: '',
  name: '',
  serial: '',
  model: '',
  category: '',
  status: '',
  supplier: '',
  purchase_date: null,
  purchase_cost: 0,
  order_number: '',
  eol_date: null,
  assigned_employee: '',
  sw_license: '',
  purchased_by: '',
  purchase_type: 'Not Purchased',
  catalog_item_id: null,
}

/** A fresh license line: one seat, nothing bought, nothing known yet. */
export const BLANK_LICENSE: HwLicenseInput = {
  license_tag: '',
  company: '',
  name: '',
  product_key: '',
  expiration_date: null,
  licensed_to_email: '',
  category: '',
  supplier: '',
  manufacturer: '',
  quantity: 1,
  purchase_date: null,
  termination_date: null,
  depreciation: 'Not Purchased',
  maintained: false,
  purchase_cost: 0,
  purchase_order_number: '',
  notes: '',
  catalog_item_id: null,
}

function isBlank<T extends object>(row: T, blank: T): boolean {
  return (Object.keys(blank) as (keyof T)[]).every((key) => {
    const value = row[key]
    return typeof value === 'string' ? value.trim() === '' : value === blank[key]
  })
}

/** An "Add Item" line nobody typed into: dropped on save rather than refused. */
export function isBlankAsset(row: HwAssetInput): boolean {
  return isBlank(row, BLANK_ASSET)
}

export function isBlankLicense(row: HwLicenseInput): boolean {
  return isBlank(row, BLANK_LICENSE)
}

export interface SavePlan<T> {
  /** The rows worth saving: untouched blank lines are left out. */
  rows: T[]
  /** 1-based positions of rows that carry data but no name — the server refuses those. */
  unnamed: number[]
}

/**
 * What a bulk save should send. The API requires a name on every row, so a row
 * with data but no name is reported (by its position in the grid) instead of
 * turning the whole save into a validation error.
 */
export function planSave<T extends { name: string }>(
  rows: T[],
  isBlankRow: (row: T) => boolean,
): SavePlan<T> {
  const kept: T[] = []
  const unnamed: number[] = []
  rows.forEach((row, index) => {
    if (isBlankRow(row)) return
    if (row.name.trim() === '') unnamed.push(index + 1)
    kept.push(row)
  })
  return { rows: kept, unnamed }
}

/** "row 3", "rows 2 and 5", "rows 1, 4 and 6" */
export function describeRows(positions: number[]): string {
  if (positions.length === 1) return `row ${positions[0]}`
  const head = positions.slice(0, -1).join(', ')
  return `rows ${head} and ${positions[positions.length - 1]}`
}

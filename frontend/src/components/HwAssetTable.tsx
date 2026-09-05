import { useMemo, useState } from 'react'
import { Check, Ellipsis, Plus, Trash2, X } from 'lucide-react'
import type { HardwareCatalogItem, HwAssetInput, HwMeta, HwPurchaseType } from '../types'
import { assetYearCost, parseIsoDate } from '../hardware/depreciation'
import { formatEuro } from '../utils'
import { Button, EmptyState, Input, Label, Modal, Select } from './ui'

/** A fresh register line: nothing bought, nothing known yet. */
const BLANK_ASSET: HwAssetInput = {
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

/** Inline-editable columns before the computed per-year block, so the footer
 *  label knows how far to span. */
const EDITABLE_COLUMNS = 7

/**
 * The register is wider than any screen once the year columns are in, so the
 * name column is pinned — the frozen first column the working document used,
 * in CSS. A pinned cell needs an opaque background or the scrolling columns
 * show through it.
 */
const PINNED_LEFT = 'sticky left-0 z-20 border-r border-slate-800 bg-slate-900'

function round2(value: number): number {
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
function dateInputValue(value: string | null): string {
  const parsed = parseIsoDate(value)
  if (parsed === null) return ''
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`
}

/**
 * The vocabulary plus the row's own value when the workbook holds free text the
 * dropdown does not know — picking another option must be a deliberate act, not
 * a side effect of opening the list.
 */
function withCurrent(options: readonly string[], current: string): string[] {
  return current !== '' && !options.includes(current) ? [...options, current] : [...options]
}

function isPlanned(purchaseType: string): boolean {
  return purchaseType.trim().toUpperCase() === 'PLANNED PURCHASE'
}

function PlannedPill() {
  return (
    <span className="ml-2 rounded-full border border-amber-800 bg-amber-950 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-amber-300">
      planned
    </span>
  )
}

/** One computed money cell. Planned money is muted: it is not committed spend. */
function CostCell({ value, planned }: { value: number; planned: boolean }) {
  if (value === 0) return <span className="text-slate-600">—</span>
  return (
    <span className={planned ? 'italic text-slate-500' : 'text-slate-200'}>
      {formatEuro(value)}
    </span>
  )
}

function TextField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        aria-label={label}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

/** Every asset field that does not fit the register grid. */
function AssetDetailModal({
  row,
  catalog,
  onPatch,
  onClose,
}: {
  row: HwAssetInput
  catalog: HardwareCatalogItem[]
  onPatch: (patch: Partial<HwAssetInput>) => void
  onClose: () => void
}) {
  const linked = catalog.find((item) => item.id === row.catalog_item_id) ?? null

  const linkCatalogItem = (value: string) => {
    const item = value === '' ? null : catalog.find((c) => String(c.id) === value)
    if (!item) {
      onPatch({ catalog_item_id: null })
      return
    }
    // The workbook priced hardware from its "HW Catalogue" sheet, so linking an
    // entry fills the fields that are still empty and never overwrites typing.
    onPatch({
      catalog_item_id: item.id,
      name: row.name.trim() === '' ? item.name : row.name,
      supplier: row.supplier.trim() === '' ? item.supplier_name : row.supplier,
      purchase_cost: row.purchase_cost === 0 ? item.unit_cost : row.purchase_cost,
    })
  }

  return (
    <Modal title={row.name.trim() || 'Asset details'} size="lg" onClose={onClose}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField
          label="Asset tag"
          value={row.asset_tag}
          placeholder="Sheet ID, e.g. HW-0042"
          onChange={(asset_tag) => onPatch({ asset_tag })}
        />
        <TextField
          label="Company"
          value={row.company}
          onChange={(company) => onPatch({ company })}
        />
        <TextField
          label="Serial number"
          value={row.serial}
          onChange={(serial) => onPatch({ serial })}
        />
        <TextField label="Model" value={row.model} onChange={(model) => onPatch({ model })} />
        <TextField
          label="Supplier"
          value={row.supplier}
          onChange={(supplier) => onPatch({ supplier })}
        />
        <TextField
          label="Order number"
          value={row.order_number}
          onChange={(order_number) => onPatch({ order_number })}
        />
        <TextField
          label="Assigned employee"
          value={row.assigned_employee}
          onChange={(assigned_employee) => onPatch({ assigned_employee })}
        />
        <TextField
          label="SW license"
          value={row.sw_license}
          onChange={(sw_license) => onPatch({ sw_license })}
        />
        <TextField
          label="Purchased by"
          value={row.purchased_by}
          onChange={(purchased_by) => onPatch({ purchased_by })}
        />
        <div>
          <Label>Catalog item</Label>
          <Select
            value={row.catalog_item_id === null ? '' : String(row.catalog_item_id)}
            onChange={(e) => linkCatalogItem(e.target.value)}
          >
            <option value="">Not linked</option>
            {catalog.map((item) => (
              <option key={item.id} value={String(item.id)}>
                {item.name}
                {item.supplier_name ? ` — ${item.supplier_name}` : ''}
              </option>
            ))}
            {row.catalog_item_id !== null && linked === null && (
              <option value={String(row.catalog_item_id)}>
                Item #{row.catalog_item_id} (removed from catalog)
              </option>
            )}
          </Select>
          {linked !== null && (
            <p className="mt-1 text-xs text-slate-500">
              Catalog price {formatEuro(linked.unit_cost)}
              {linked.supplier_email ? (
                <>
                  {' · '}
                  <a
                    href={`mailto:${linked.supplier_email}`}
                    className="text-indigo-400 hover:underline"
                  >
                    {linked.supplier_email}
                  </a>
                </>
              ) : null}
            </p>
          )}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          Changes apply immediately; save the register to keep them.
        </p>
        <Button onClick={onClose}>Done</Button>
      </div>
    </Modal>
  )
}

export interface HwAssetTableProps {
  rows: HwAssetInput[]
  years: number[]
  meta: HwMeta
  catalog: HardwareCatalogItem[]
  onChange: (next: HwAssetInput[]) => void
}

/**
 * The Assets register: the workbook's "Assets" sheet, editable in place with
 * live per-year depreciation. Fully controlled — every edit leaves through
 * `onChange`; fetching and saving belong to the page.
 */
export function HwAssetTable({ rows, years, meta, catalog, onChange }: HwAssetTableProps) {
  const [detailIndex, setDetailIndex] = useState<number | null>(null)
  const [confirmIndex, setConfirmIndex] = useState<number | null>(null)

  const totals = useMemo(() => {
    const perRow = rows.map((row) => {
      const planned = isPlanned(row.purchase_type)
      const purchaseYear = parseIsoDate(row.purchase_date)?.getFullYear() ?? null
      // A planned row costs nothing yet, so the engine returns zeros for it; the
      // planned figure is instead shown against the year it is planned for.
      const cells = years.map((year) =>
        planned
          ? purchaseYear === year
            ? round2(row.purchase_cost)
            : 0
          : round2(assetYearCost(row, year)),
      )
      return {
        planned,
        cells,
        // A planned row's total is its whole planned cost even when the purchase
        // year falls outside the shown span, so the Total column always adds up.
        total: planned
          ? round2(row.purchase_cost)
          : round2(cells.reduce((sum, value) => sum + value, 0)),
      }
    })
    const sumYear = (index: number, planned: boolean) =>
      round2(
        perRow.reduce(
          (sum, entry) => (entry.planned === planned ? sum + entry.cells[index] : sum),
          0,
        ),
      )
    const sumTotal = (planned: boolean) =>
      round2(
        perRow.reduce((sum, entry) => (entry.planned === planned ? sum + entry.total : sum), 0),
      )
    return {
      perRow,
      actualByYear: years.map((_, index) => sumYear(index, false)),
      plannedByYear: years.map((_, index) => sumYear(index, true)),
      actualTotal: sumTotal(false),
      plannedTotal: sumTotal(true),
      hasPlanned: perRow.some((entry) => entry.planned),
    }
  }, [rows, years])

  const patch = (index: number, changes: Partial<HwAssetInput>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...changes } : row)))
  }

  const addRow = () => onChange([...rows, { ...BLANK_ASSET }])

  const removeRow = (index: number) => {
    setConfirmIndex(null)
    setDetailIndex(null)
    onChange(rows.filter((_, i) => i !== index))
  }

  const detailRow = detailIndex === null ? null : (rows[detailIndex] ?? null)

  if (rows.length === 0) {
    return (
      <EmptyState>
        <p>No assets in this register yet.</p>
        <div className="mt-3 flex justify-center">
          <Button variant="secondary" onClick={addRow}>
            <span className="flex items-center gap-1.5">
              <Plus className="h-4 w-4" />
              Add asset
            </span>
          </Button>
        </div>
      </EmptyState>
    )
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px] text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-left text-xs uppercase tracking-wide text-slate-400">
              <th scope="col" className={`py-2 pr-2 ${PINNED_LEFT}`}>
                Asset Name
              </th>
              <th scope="col" className="py-2 pr-2">
                Category
              </th>
              <th scope="col" className="py-2 pr-2">
                Status
              </th>
              <th scope="col" className="py-2 pr-2">
                Purchase Type
              </th>
              <th scope="col" className="py-2 pr-2">
                Purchase Date
              </th>
              <th scope="col" className="py-2 pr-2">
                EOL Date
              </th>
              <th scope="col" className="py-2 pr-2 text-right">
                Cost (€)
              </th>
              {years.map((year, index) => (
                <th
                  key={year}
                  scope="col"
                  className={`py-2 pr-2 pl-2 text-right ${
                    index === 0 ? 'border-l border-slate-800' : ''
                  }`}
                >
                  {year}
                </th>
              ))}
              <th scope="col" className="py-2 pr-2 pl-2 text-right">
                Total
              </th>
              <th scope="col" className="py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const computed = totals.perRow[index]
              return (
                <tr
                  key={index}
                  className="border-b border-slate-800 align-top hover:bg-slate-800/30"
                >
                  <td className={`py-2 pr-2 ${PINNED_LEFT}`}>
                    <div className="w-52">
                      <Input
                        aria-label="Asset name"
                        placeholder="e.g. Lauterbach debugger"
                        value={row.name}
                        onChange={(e) => patch(index, { name: e.target.value })}
                      />
                    </div>
                  </td>
                  <td className="py-2 pr-2">
                    <div className="w-44">
                      <Select
                        aria-label="Category"
                        value={row.category}
                        onChange={(e) => patch(index, { category: e.target.value })}
                      >
                        <option value="">—</option>
                        {withCurrent(meta.asset_categories, row.category).map((category) => (
                          <option key={category}>{category}</option>
                        ))}
                      </Select>
                    </div>
                  </td>
                  <td className="py-2 pr-2">
                    <div className="w-40">
                      <Select
                        aria-label="Status"
                        value={row.status}
                        onChange={(e) => patch(index, { status: e.target.value })}
                      >
                        <option value="">—</option>
                        {withCurrent(meta.asset_statuses, row.status).map((status) => (
                          <option key={status}>{status}</option>
                        ))}
                      </Select>
                    </div>
                  </td>
                  <td className="py-2 pr-2">
                    <div className="w-40">
                      <Select
                        aria-label="Purchase type"
                        value={row.purchase_type}
                        onChange={(e) =>
                          patch(index, { purchase_type: e.target.value as HwPurchaseType })
                        }
                      >
                        {withCurrent(meta.purchase_types, row.purchase_type).map((type) => (
                          <option key={type}>{type}</option>
                        ))}
                      </Select>
                    </div>
                  </td>
                  <td className="py-2 pr-2">
                    <div className="w-36">
                      <Input
                        type="date"
                        aria-label="Purchase date"
                        value={dateInputValue(row.purchase_date)}
                        onChange={(e) => patch(index, { purchase_date: e.target.value || null })}
                      />
                    </div>
                  </td>
                  <td className="py-2 pr-2">
                    <div className="w-36">
                      <Input
                        type="date"
                        aria-label="End of life date"
                        value={dateInputValue(row.eol_date)}
                        onChange={(e) => patch(index, { eol_date: e.target.value || null })}
                      />
                    </div>
                  </td>
                  <td className="py-2 pr-2">
                    <div className="w-28">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        aria-label="Purchase cost"
                        className="text-right"
                        value={row.purchase_cost}
                        onChange={(e) => patch(index, { purchase_cost: Number(e.target.value) })}
                      />
                    </div>
                  </td>
                  {years.map((year, yearIndex) => (
                    <td
                      key={year}
                      className={`py-2 pr-2 pl-2 pt-4 text-right tabular-nums whitespace-nowrap ${
                        yearIndex === 0 ? 'border-l border-slate-800' : ''
                      }`}
                    >
                      <CostCell value={computed.cells[yearIndex]} planned={computed.planned} />
                    </td>
                  ))}
                  <td className="py-2 pr-2 pl-2 pt-4 text-right font-medium tabular-nums whitespace-nowrap">
                    <CostCell value={computed.total} planned={computed.planned} />
                    {computed.planned && <PlannedPill />}
                  </td>
                  <td className="py-2 pt-3.5 text-right whitespace-nowrap">
                    {confirmIndex === index ? (
                      <span className="flex items-center justify-end gap-1">
                        <span className="text-xs text-rose-300">Delete?</span>
                        <Button
                          variant="danger"
                          className="px-2 py-1.5"
                          aria-label="Confirm delete"
                          onClick={() => removeRow(index)}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          className="px-2 py-1.5"
                          aria-label="Cancel delete"
                          onClick={() => setConfirmIndex(null)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </span>
                    ) : (
                      <span className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          className="px-2 py-1.5"
                          aria-label="All asset fields"
                          title="All fields"
                          onClick={() => setDetailIndex(index)}
                        >
                          <Ellipsis className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          className="px-2 py-1.5"
                          aria-label="Delete asset"
                          title="Delete"
                          onClick={() => setConfirmIndex(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-700 text-sm font-semibold text-slate-200">
              <td className={`py-3 pr-2 ${PINNED_LEFT}`}>Total actual</td>
              <td colSpan={EDITABLE_COLUMNS - 1} />
              {totals.actualByYear.map((value, index) => (
                <td
                  key={years[index]}
                  className={`py-3 pr-2 pl-2 text-right tabular-nums whitespace-nowrap ${
                    index === 0 ? 'border-l border-slate-800' : ''
                  }`}
                >
                  <CostCell value={value} planned={false} />
                </td>
              ))}
              <td className="py-3 pr-2 pl-2 text-right tabular-nums whitespace-nowrap">
                <CostCell value={totals.actualTotal} planned={false} />
              </td>
              <td className="py-3" />
            </tr>
            {totals.hasPlanned && (
              <tr className="text-sm text-slate-400">
                <td className={`pb-3 pr-2 ${PINNED_LEFT}`}>Planned</td>
                <td colSpan={EDITABLE_COLUMNS - 1} />
                {totals.plannedByYear.map((value, index) => (
                  <td
                    key={years[index]}
                    className={`pb-3 pr-2 pl-2 text-right tabular-nums whitespace-nowrap ${
                      index === 0 ? 'border-l border-slate-800' : ''
                    }`}
                  >
                    <CostCell value={value} planned />
                  </td>
                ))}
                <td className="pb-3 pr-2 pl-2 text-right tabular-nums whitespace-nowrap">
                  <CostCell value={totals.plannedTotal} planned />
                </td>
                <td className="pb-3" />
              </tr>
            )}
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" onClick={addRow}>
          <span className="flex items-center gap-1.5">
            <Plus className="h-4 w-4" />
            Add asset
          </span>
        </Button>
        <p className="max-w-xl text-right text-xs text-slate-500">
          Yearly cost follows the working document: a purchase lands whole in its purchase year, a
          lease spreads over {meta.leasing_months} months. Planned purchases are shown muted and
          totalled separately — they are not committed spend.
        </p>
      </div>

      {detailRow !== null && detailIndex !== null && (
        <AssetDetailModal
          row={detailRow}
          catalog={catalog}
          onPatch={(changes) => patch(detailIndex, changes)}
          onClose={() => setDetailIndex(null)}
        />
      )}
    </div>
  )
}

export default HwAssetTable

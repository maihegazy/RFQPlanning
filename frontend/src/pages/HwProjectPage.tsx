import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Download, Pencil, Plus, Search, TriangleAlert, Upload } from 'lucide-react'
import { api } from '../api'
import type {
  HardwareBilling,
  HardwareCatalogItem,
  HwAdjustment,
  HwAsset,
  HwAssetInput,
  HwImportResult,
  HwLicense,
  HwLicenseInput,
  HwMeta,
  HwPivot,
  HwProject,
  HwPurchaseType,
  HwRenewalRisk,
  HwSummary,
  HwYearRow,
} from '../types'
import { FIRST_YEAR, LAST_YEAR, yearSpan } from '../hardware/depreciation'
import {
  BLANK_ASSET,
  BLANK_LICENSE,
  describeRows,
  isBlankAsset,
  isBlankLicense,
  planSave,
} from '../hardware/registers'
import { formatEuro, formatNumber } from '../utils'
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Input,
  Label,
  Modal,
  Spinner,
} from '../components/ui'
import HwAssetTable from '../components/HwAssetTable'
import HwLicenseTable from '../components/HwLicenseTable'
import HwImportDialog from '../components/HwImportDialog'
import HwBudgetFields from '../components/HwBudgetFields'
import {
  budgetBreakdown,
  budgetPayload,
  draftFromProject,
  type BudgetDraft,
} from '../hardware/budget'

type TabKey = 'summary' | 'assets' | 'licenses'
type RegisterKey = 'assets' | 'licenses'
type DialogKey = 'catalog' | 'import' | 'edit'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'summary', label: 'Summary' },
  { key: 'assets', label: 'Assets' },
  { key: 'licenses', label: 'Licenses' },
]

/** `Button` renders a <button>; the export has to be a real link so the browser
 *  performs the download itself instead of buffering the workbook through fetch.
 *  Same classes as the secondary button variant. */
const LINK_BUTTON =
  'inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700'

/** A catalog item priced per year is the working document's Leasing; a one-off
 *  price is a Purchase. Dates stay empty — only the buyer knows them. */
function purchaseTypeForBilling(billing: HardwareBilling): HwPurchaseType {
  return billing === 'yearly' ? 'Leasing' : 'Purchase'
}

function assetFromCatalog(item: HardwareCatalogItem): HwAssetInput {
  return {
    ...BLANK_ASSET,
    name: item.name,
    supplier: item.supplier_name,
    purchase_cost: item.unit_cost,
    purchase_type: purchaseTypeForBilling(item.billing),
    catalog_item_id: item.id,
  }
}

function licenseFromCatalog(item: HardwareCatalogItem): HwLicenseInput {
  return {
    ...BLANK_LICENSE,
    name: item.name,
    supplier: item.supplier_name,
    purchase_cost: item.unit_cost,
    depreciation: purchaseTypeForBilling(item.billing),
    catalog_item_id: item.id,
  }
}

/** The register is edited and saved as `…Input` rows; the server-computed
 *  fields are re-read from the save response. */
function toAssetInput(asset: HwAsset): HwAssetInput {
  const { id, hw_project_id, per_year, total, ...input } = asset
  return input
}

function toLicenseInput(license: HwLicense): HwLicenseInput {
  const { id, hw_project_id, per_year, total, ...input } = license
  return input
}

function adjustmentKey(year: number, kind: RegisterKey): string {
  return `${year}:${kind}`
}

type AdjustmentMap = Record<string, HwAdjustment>

function adjustmentsToMap(items: HwAdjustment[]): AdjustmentMap {
  const map: AdjustmentMap = {}
  for (const item of items) map[adjustmentKey(item.year, item.kind)] = item
  return map
}

/** The payload the API stores: empty cells are not adjustments. Fields are
 *  rebuilt in a fixed order so the serialised form can drive dirty tracking. */
function adjustmentList(map: AdjustmentMap): HwAdjustment[] {
  return Object.values(map)
    .filter((item) => item.amount !== 0 || item.note.trim() !== '')
    .sort((a, b) => a.year - b.year || a.kind.localeCompare(b.kind))
    .map((item) => ({ year: item.year, kind: item.kind, amount: item.amount, note: item.note }))
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** "Imported 3 assets and 2 licenses, replacing 5 assets." */
function describeImport(result: HwImportResult): string {
  const replaced = [
    result.replaced_assets > 0 ? plural(result.replaced_assets, 'asset') : '',
    result.replaced_licenses > 0 ? plural(result.replaced_licenses, 'license') : '',
  ].filter((part) => part !== '')
  const base = `Imported ${plural(result.created_assets, 'asset')} and ${plural(
    result.created_licenses,
    'license',
  )}`
  return replaced.length > 0 ? `${base}, replacing ${replaced.join(' and ')}.` : `${base}.`
}

function Money({ value, muted = false }: { value: number; muted?: boolean }) {
  if (value === 0) return <span className="text-slate-600">—</span>
  return <span className={muted ? 'text-slate-400' : 'text-slate-200'}>{formatEuro(value)}</span>
}

function KpiTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  hint: string
  tone?: 'default' | 'warning'
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-1 text-xl font-bold ${
          tone === 'warning' ? 'text-rose-300' : 'text-slate-100'
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  )
}

function UtilisationBar({
  budget,
  committed,
  planned,
  remaining,
}: {
  budget: number
  committed: number
  planned: number
  remaining: number
}) {
  if (budget <= 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-400">
        No budget set for this project yet — use “Edit project” to add the assets and licenses
        budgets, and this bar will track them.
      </div>
    )
  }
  const committedPct = (committed / budget) * 100
  const plannedPct = (planned / budget) * 100
  const committedWidth = Math.min(100, Math.max(0, committedPct))
  const plannedWidth = Math.max(0, Math.min(100 - committedWidth, plannedPct))
  const over = remaining < 0

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-slate-500">Budget utilisation</p>
        <p className={`text-xs ${over ? 'text-rose-300' : 'text-slate-400'}`}>
          {formatNumber(committedPct, 0)}% committed · {formatNumber(plannedPct, 0)}% planned
        </p>
      </div>
      <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className={over ? 'bg-rose-500' : 'bg-indigo-500'}
          style={{ width: `${committedWidth}%` }}
        />
        <div className="bg-amber-500" style={{ width: `${plannedWidth}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${over ? 'bg-rose-500' : 'bg-indigo-500'}`} />
          Committed {formatEuro(committed)}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          Planned {formatEuro(planned)}
        </span>
        <span>Budget {formatEuro(budget)}</span>
        {over && (
          <span className="flex items-center gap-1.5 text-rose-300">
            <TriangleAlert className="h-4 w-4" />
            Over budget by {formatEuro(Math.abs(remaining))}
          </span>
        )}
      </div>
    </div>
  )
}

const RISK_TILES: { key: keyof HwRenewalRisk; label: string; tone: string }[] = [
  { key: 'expired', label: 'Expired', tone: 'border-rose-800 bg-rose-950/40 text-rose-300' },
  {
    key: 'in_30_days',
    label: 'Within 30 days',
    tone: 'border-rose-800 bg-rose-950/40 text-rose-300',
  },
  {
    key: 'in_60_days',
    label: '31 – 60 days',
    tone: 'border-amber-800 bg-amber-950/40 text-amber-300',
  },
  {
    key: 'in_90_days',
    label: '61 – 90 days',
    tone: 'border-sky-800 bg-sky-950/40 text-sky-300',
  },
]

function RenewalRisk({ risk }: { risk: HwRenewalRisk }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {RISK_TILES.map((tile) => (
        <div key={tile.key} className={`rounded-lg border px-3 py-2.5 ${tile.tone}`}>
          <p className="text-2xl font-bold tabular-nums">{risk[tile.key]}</p>
          <p className="mt-0.5 text-xs">{tile.label}</p>
        </div>
      ))}
    </div>
  )
}

function PivotCard({ title, pivot, empty }: { title: string; pivot: HwPivot; empty: string }) {
  const columnTotal = (status: string) =>
    pivot.rows.reduce((sum, row) => sum + (row.counts[status] ?? 0), 0)
  const grandTotal = pivot.rows.reduce((sum, row) => sum + row.total, 0)

  return (
    <Card title={title}>
      {pivot.rows.length === 0 ? (
        <EmptyState>{empty}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left text-xs uppercase tracking-wide text-slate-400">
                <th scope="col" className="py-2 pr-3">
                  Category
                </th>
                {pivot.statuses.map((status) => (
                  <th key={status} scope="col" className="py-2 pr-3 text-right">
                    {status}
                  </th>
                ))}
                <th scope="col" className="py-2 text-right">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {pivot.rows.map((row) => (
                <tr key={row.category} className="border-b border-slate-800">
                  <td className="py-2 pr-3 text-slate-300">{row.category}</td>
                  {pivot.statuses.map((status) => {
                    const count = row.counts[status] ?? 0
                    return (
                      <td
                        key={status}
                        className={`py-2 pr-3 text-right tabular-nums ${
                          count === 0 ? 'text-slate-600' : 'text-slate-200'
                        }`}
                      >
                        {count === 0 ? '—' : count}
                      </td>
                    )
                  })}
                  <td className="py-2 text-right font-medium tabular-nums text-slate-200">
                    {row.total}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-700 text-sm font-semibold text-slate-200">
                <td className="py-2 pr-3">Total</td>
                {pivot.statuses.map((status) => (
                  <td key={status} className="py-2 pr-3 text-right tabular-nums">
                    {columnTotal(status)}
                  </td>
                ))}
                <td className="py-2 text-right tabular-nums">{grandTotal}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  )
}

function SummaryYearTable({
  rows,
  totals,
  adjustmentOf,
  onAdjust,
}: {
  rows: HwYearRow[]
  totals: HwYearRow
  adjustmentOf: (year: number, kind: RegisterKey) => number
  onAdjust: (year: number, kind: RegisterKey, amount: number) => void
}) {
  const adjustmentTotal = (kind: RegisterKey) =>
    rows.reduce((sum, row) => sum + adjustmentOf(row.year, kind), 0)

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1120px] text-sm">
        <thead>
          <tr className="border-b border-slate-700 text-left text-xs uppercase tracking-wide text-slate-400">
            <th scope="col" className="py-2 pr-3">
              Year
            </th>
            <th scope="col" className="py-2 pr-3 text-right">
              Total
            </th>
            <th scope="col" className="py-2 pr-3 text-right">
              Actual
            </th>
            <th scope="col" className="py-2 pr-3 text-right">
              Actual assets
            </th>
            <th scope="col" className="py-2 pr-3 text-right">
              Actual licenses
            </th>
            <th scope="col" className="py-2 pr-3 text-right">
              Planned
            </th>
            <th scope="col" className="py-2 pr-3 text-right">
              Planned assets
            </th>
            <th scope="col" className="py-2 pr-3 text-right">
              Planned licenses
            </th>
            <th scope="col" className="border-l border-slate-800 py-2 pl-3 pr-3 text-right">
              Special cases assets
            </th>
            <th scope="col" className="py-2 text-right">
              Special cases licenses
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.year} className="border-b border-slate-800 hover:bg-slate-800/30">
              <td className="py-2 pr-3 font-medium text-slate-200">{row.year}</td>
              <td className="py-2 pr-3 text-right font-medium tabular-nums whitespace-nowrap">
                <Money value={row.grand_total} />
              </td>
              <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                <Money value={row.actual_total} />
              </td>
              <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                <Money value={row.actual_assets} muted />
              </td>
              <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                <Money value={row.actual_licenses} muted />
              </td>
              <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                <Money value={row.planned_total} />
              </td>
              <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                <Money value={row.planned_assets} muted />
              </td>
              <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                <Money value={row.planned_licenses} muted />
              </td>
              <td className="border-l border-slate-800 py-1.5 pl-3 pr-3">
                <div className="ml-auto w-32">
                  <Input
                    type="number"
                    step="0.01"
                    className="text-right"
                    aria-label={`Special cases assets ${row.year}`}
                    value={adjustmentOf(row.year, 'assets')}
                    onChange={(e) => onAdjust(row.year, 'assets', Number(e.target.value))}
                  />
                </div>
              </td>
              <td className="py-1.5">
                <div className="ml-auto w-32">
                  <Input
                    type="number"
                    step="0.01"
                    className="text-right"
                    aria-label={`Special cases licenses ${row.year}`}
                    value={adjustmentOf(row.year, 'licenses')}
                    onChange={(e) => onAdjust(row.year, 'licenses', Number(e.target.value))}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-700 text-sm font-semibold text-slate-200">
            <td className="py-3 pr-3">Total</td>
            <td className="py-3 pr-3 text-right tabular-nums whitespace-nowrap">
              <Money value={totals.grand_total} />
            </td>
            <td className="py-3 pr-3 text-right tabular-nums whitespace-nowrap">
              <Money value={totals.actual_total} />
            </td>
            <td className="py-3 pr-3 text-right tabular-nums whitespace-nowrap">
              <Money value={totals.actual_assets} />
            </td>
            <td className="py-3 pr-3 text-right tabular-nums whitespace-nowrap">
              <Money value={totals.actual_licenses} />
            </td>
            <td className="py-3 pr-3 text-right tabular-nums whitespace-nowrap">
              <Money value={totals.planned_total} />
            </td>
            <td className="py-3 pr-3 text-right tabular-nums whitespace-nowrap">
              <Money value={totals.planned_assets} />
            </td>
            <td className="py-3 pr-3 text-right tabular-nums whitespace-nowrap">
              <Money value={totals.planned_licenses} />
            </td>
            <td className="border-l border-slate-800 py-3 pl-3 pr-3 text-right tabular-nums whitespace-nowrap">
              <Money value={adjustmentTotal('assets')} />
            </td>
            <td className="py-3 text-right tabular-nums whitespace-nowrap">
              <Money value={adjustmentTotal('licenses')} />
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function ExpiringList({ rows }: { rows: HwSummary['expiring'] }) {
  if (rows.length === 0) {
    return <EmptyState>No license expires within the next 90 days.</EmptyState>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700 text-left text-xs uppercase tracking-wide text-slate-400">
            <th scope="col" className="py-2 pr-3">
              License
            </th>
            <th scope="col" className="py-2 pr-3">
              Manufacturer
            </th>
            <th scope="col" className="py-2 pr-3">
              Expires
            </th>
            <th scope="col" className="py-2 text-right">
              Days left
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-slate-800">
              <td className="py-2 pr-3 text-slate-200">{row.name}</td>
              <td className="py-2 pr-3 text-slate-400">{row.manufacturer || '—'}</td>
              <td className="py-2 pr-3 text-slate-400 tabular-nums">{row.expiration_date}</td>
              <td
                className={`py-2 text-right tabular-nums whitespace-nowrap ${
                  row.days_left < 0
                    ? 'text-rose-300'
                    : row.days_left <= 30
                      ? 'text-amber-300'
                      : 'text-slate-300'
                }`}
              >
                {row.days_left < 0
                  ? `expired ${Math.abs(row.days_left)}d ago`
                  : `${row.days_left}d`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CatalogPickerModal({
  catalog,
  target,
  addedCount,
  onPick,
  onClose,
}: {
  catalog: HardwareCatalogItem[]
  target: RegisterKey
  addedCount: number
  onPick: (item: HardwareCatalogItem) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      needle === ''
        ? catalog
        : catalog.filter((item) =>
            `${item.name} ${item.supplier_name} ${item.aspice}`.toLowerCase().includes(needle),
          ),
    [catalog, needle],
  )
  const registerLabel = target === 'assets' ? 'Assets' : 'Licenses'

  return (
    <Modal title="Add from hardware catalog" size="lg" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-400">
          Picking an item appends a prefilled row to the <strong>{registerLabel}</strong> register —
          name, supplier and cost come from the catalog, the dates are yours to fill in. Nothing is
          written until you save the register.
        </p>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <Input
            className="pl-9"
            placeholder="Search by name, supplier or ASPICE process…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        {catalog.length === 0 ? (
          <EmptyState>
            The shared catalog is empty.{' '}
            <Link to="/hardware-catalog" className="text-indigo-400 hover:underline">
              Add items to the catalog
            </Link>{' '}
            first.
          </EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState>No catalog item matches “{query.trim()}”.</EmptyState>
        ) : (
          <ul className="max-h-96 divide-y divide-slate-800 overflow-y-auto rounded-lg border border-slate-800">
            {filtered.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-4 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-200">{item.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {item.supplier_name || 'No supplier'}
                    {item.aspice ? ` · ${item.aspice}` : ''} · becomes a{' '}
                    {purchaseTypeForBilling(item.billing)} row
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm tabular-nums text-slate-300">
                    {formatEuro(item.unit_cost)}
                  </span>
                  <Button variant="secondary" onClick={() => onPick(item)}>
                    <span className="flex items-center gap-1.5">
                      <Plus className="h-4 w-4" />
                      Add
                    </span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            {addedCount === 0
              ? 'Nothing added yet.'
              : `Added ${plural(addedCount, 'row')} to the ${registerLabel} register — still unsaved.`}
          </p>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  )
}

function EditProjectModal({
  project,
  onSaved,
  onClose,
}: {
  project: HwProject
  onSaved: (updated: HwProject) => void
  onClose: () => void
}) {
  const [form, setForm] = useState({
    name: project.name,
    company: project.company,
    description: project.description,
    portal_reference: project.portal_reference,
  })
  const [budget, setBudget] = useState<BudgetDraft>(() => draftFromProject(project))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const patch = (changes: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...changes }))

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const updated = await api.updateHwProject(project.id, {
        ...form,
        name: form.name.trim(),
        ...budgetPayload(budget),
      })
      onSaved(updated)
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title="Edit hardware project" size="lg" onClose={onClose}>
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label>Project name</Label>
            <Input
              aria-label="Project name"
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
              autoFocus
            />
          </div>
          <div>
            <Label>Company</Label>
            <Input
              aria-label="Company"
              value={form.company}
              onChange={(e) => patch({ company: e.target.value })}
            />
          </div>
        </div>

        <div>
          <Label>Description</Label>
          <textarea
            aria-label="Description"
            rows={3}
            value={form.description}
            onChange={(e) => patch({ description: e.target.value })}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            placeholder="What this purchasing file covers"
          />
        </div>

        <HwBudgetFields draft={budget} onChange={setBudget} />

        <div>
          <Label>Portal reference</Label>
          <Input
            aria-label="Portal reference"
            value={form.portal_reference}
            onChange={(e) => patch({ portal_reference: e.target.value })}
            placeholder="Reserved for the company portal's project id"
          />
        </div>

        <div className="flex items-center justify-end gap-3">
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || form.name.trim() === ''}>
              {saving ? 'Saving…' : 'Save project'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/** The dirty pill, the saved notice and the two register buttons. */
function RegisterActions({
  dirty,
  saving,
  notice,
  onAdd,
  onDiscard,
  onSave,
}: {
  dirty: boolean
  saving: boolean
  notice: string
  onAdd: () => void
  onDiscard: () => void
  onSave: () => void
}) {
  return (
    <>
      {dirty ? (
        <span className="self-center rounded-full border border-amber-800 bg-amber-950 px-2.5 py-0.5 text-xs font-medium text-amber-300">
          Unsaved changes
        </span>
      ) : notice !== '' ? (
        <span className="self-center text-xs text-emerald-300">{notice}</span>
      ) : null}
      {dirty && (
        <Button variant="ghost" onClick={onDiscard} disabled={saving}>
          Discard
        </Button>
      )}
      <Button variant="secondary" onClick={onAdd} disabled={saving}>
        <span className="flex items-center gap-1.5">
          <Plus className="h-4 w-4" />
          Add Item
        </span>
      </Button>
      <Button onClick={onSave} disabled={!dirty || saving}>
        {saving ? 'Saving…' : 'Save Changes'}
      </Button>
    </>
  )
}

/**
 * One hardware purchasing project: the working document's Dashboard, Summary,
 * Assets and Licenses sheets for a single file.
 *
 * Both registers are saved with a bulk replace, so the page holds an unsaved
 * working copy next to the last saved baseline and compares the two for its
 * dirty state. Nothing autosaves — a spreadsheet never did either — and the tab
 * lives in the query string so a reload, a bookmark or a shared link all land on
 * the same view.
 */
export default function HwProjectPage() {
  const { hwProjectId } = useParams()
  const id = Number(hwProjectId)
  const [searchParams, setSearchParams] = useSearchParams()

  const [project, setProject] = useState<HwProject | null>(null)
  const [summary, setSummary] = useState<HwSummary | null>(null)
  const [meta, setMeta] = useState<HwMeta | null>(null)
  const [catalog, setCatalog] = useState<HardwareCatalogItem[]>([])
  const [assets, setAssets] = useState<HwAssetInput[]>([])
  const [licenses, setLicenses] = useState<HwLicenseInput[]>([])
  const [assetBaseline, setAssetBaseline] = useState('[]')
  const [licenseBaseline, setLicenseBaseline] = useState('[]')
  const [adjustments, setAdjustments] = useState<AdjustmentMap>({})
  const [adjustmentBaseline, setAdjustmentBaseline] = useState('[]')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState<'assets' | 'licenses' | 'adjustments' | null>(null)
  /* A save confirmation belongs to the tab it was earned on, so switching tabs
   * never shows "Saved 3 assets." next to the licenses grid. */
  const [notice, setNotice] = useState<{ scope: TabKey; text: string } | null>(null)
  const [dialog, setDialog] = useState<DialogKey | null>(null)
  const [catalogAdded, setCatalogAdded] = useState(0)

  /* A second load (id change, or React's double-invoked effect) must win over
   * whatever is still in flight, or a stale response resets the registers. */
  const loadSeq = useRef(0)

  /** `keepEdits` protects special-case cells the user is still editing when the
   *  summary is re-read for another reason (a register save, a budget change). */
  const applySummary = useCallback((next: HwSummary, keepEdits: boolean) => {
    setSummary(next)
    if (keepEdits) return
    const map = adjustmentsToMap(next.adjustments)
    setAdjustments(map)
    setAdjustmentBaseline(JSON.stringify(adjustmentList(map)))
  }, [])

  const load = useCallback(async () => {
    const seq = loadSeq.current + 1
    loadSeq.current = seq
    setLoading(true)
    try {
      const [nextProject, nextSummary, nextAssets, nextLicenses, nextCatalog, nextMeta] =
        await Promise.all([
          api.getHwProject(id),
          api.getHwSummary(id),
          api.listHwAssets(id),
          api.listHwLicenses(id),
          api.listHardwareCatalog(),
          api.getHwMeta(),
        ])
      if (seq !== loadSeq.current) return
      const assetRows = nextAssets.map(toAssetInput)
      const licenseRows = nextLicenses.map(toLicenseInput)
      setProject(nextProject)
      applySummary(nextSummary, false)
      setAssets(assetRows)
      setAssetBaseline(JSON.stringify(assetRows))
      setLicenses(licenseRows)
      setLicenseBaseline(JSON.stringify(licenseRows))
      setCatalog(nextCatalog)
      setMeta(nextMeta)
      setError('')
    } catch (e) {
      if (seq !== loadSeq.current) return
      setError((e as Error).message)
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [applySummary, id])

  useEffect(() => {
    if (!Number.isInteger(id)) {
      setError('Unknown hardware project.')
      setLoading(false)
      return
    }
    load()
  }, [id, load])

  const tabParam = searchParams.get('tab')
  const tab: TabKey = tabParam === 'assets' || tabParam === 'licenses' ? tabParam : 'summary'

  const selectTab = (next: TabKey) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev)
        if (next === 'summary') params.delete('tab')
        else params.set('tab', next)
        return params
      },
      { replace: true },
    )
  }

  const assetsDirty = JSON.stringify(assets) !== assetBaseline
  const licensesDirty = JSON.stringify(licenses) !== licenseBaseline
  const adjustmentsDirty = JSON.stringify(adjustmentList(adjustments)) !== adjustmentBaseline
  const registersDirty = assetsDirty || licensesDirty
  const dirtyByTab: Record<TabKey, boolean> = {
    summary: adjustmentsDirty,
    assets: assetsDirty,
    licenses: licensesDirty,
  }

  /* The grids show live per-year costs while the user types, so the columns have
   * to cover dates that are not saved yet — not just the server's span. */
  const years = useMemo(
    () => yearSpan([...assets, ...licenses], summary?.years.map((row) => row.year) ?? []),
    [assets, licenses, summary],
  )

  const changeAssets = (next: HwAssetInput[]) => {
    setNotice(null)
    setAssets(next)
  }

  const changeLicenses = (next: HwLicenseInput[]) => {
    setNotice(null)
    setLicenses(next)
  }

  const adjustmentOf = (year: number, kind: RegisterKey) =>
    adjustments[adjustmentKey(year, kind)]?.amount ?? 0

  const setAdjustment = (year: number, kind: RegisterKey, amount: number) => {
    setNotice(null)
    setAdjustments((prev) => {
      const key = adjustmentKey(year, kind)
      const existing = prev[key]
      return { ...prev, [key]: { year, kind, amount, note: existing?.note ?? '' } }
    })
  }

  const refreshSummary = async (keepAdjustmentEdits: boolean) => {
    const next = await api.getHwSummary(id)
    applySummary(next, keepAdjustmentEdits)
  }

  const saveAssets = async () => {
    const plan = planSave(assets, isBlankAsset)
    if (plan.unnamed.length > 0) {
      setError(
        `Every asset needs a name before the register can be saved: ${describeRows(
          plan.unnamed,
        )} of the assets register ${plan.unnamed.length === 1 ? 'has' : 'have'} none.`,
      )
      return
    }
    setSaving('assets')
    setError('')
    try {
      const saved = await api.replaceHwAssets(id, plan.rows)
      const rows = saved.map(toAssetInput)
      setAssets(rows)
      setAssetBaseline(JSON.stringify(rows))
      await refreshSummary(adjustmentsDirty)
      setNotice({ scope: 'assets', text: `Saved ${plural(rows.length, 'asset')}.` })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(null)
    }
  }

  const saveLicenses = async () => {
    const plan = planSave(licenses, isBlankLicense)
    if (plan.unnamed.length > 0) {
      setError(
        `Every license needs a name before the register can be saved: ${describeRows(
          plan.unnamed,
        )} of the licenses register ${plan.unnamed.length === 1 ? 'has' : 'have'} none.`,
      )
      return
    }
    setSaving('licenses')
    setError('')
    try {
      const saved = await api.replaceHwLicenses(id, plan.rows)
      const rows = saved.map(toLicenseInput)
      setLicenses(rows)
      setLicenseBaseline(JSON.stringify(rows))
      await refreshSummary(adjustmentsDirty)
      setNotice({ scope: 'licenses', text: `Saved ${plural(rows.length, 'license')}.` })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(null)
    }
  }

  const saveAdjustments = async () => {
    setSaving('adjustments')
    setError('')
    try {
      await api.replaceHwAdjustments(id, adjustmentList(adjustments))
      // The server folds the adjustments into the actual columns, so the whole
      // summary has to come back rather than being patched in place.
      await refreshSummary(false)
      setNotice({ scope: 'summary', text: 'Special cases saved.' })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(null)
    }
  }

  const noticeFor = (scope: TabKey) =>
    notice !== null && notice.scope === scope ? notice.text : ''

  const discardAssets = () => {
    setNotice(null)
    setAssets(JSON.parse(assetBaseline) as HwAssetInput[])
  }

  const discardLicenses = () => {
    setNotice(null)
    setLicenses(JSON.parse(licenseBaseline) as HwLicenseInput[])
  }

  const discardAdjustments = () => {
    setNotice(null)
    setAdjustments(adjustmentsToMap(JSON.parse(adjustmentBaseline) as HwAdjustment[]))
  }

  /* "Add from catalog" fills the register the user is looking at; from the
   * Summary tab the assets register is the sensible default. */
  const catalogTarget: RegisterKey = tab === 'licenses' ? 'licenses' : 'assets'

  const addFromCatalog = (item: HardwareCatalogItem) => {
    setNotice(null)
    setCatalogAdded((count) => count + 1)
    if (catalogTarget === 'licenses') setLicenses((prev) => [...prev, licenseFromCatalog(item)])
    else setAssets((prev) => [...prev, assetFromCatalog(item)])
  }

  const closeCatalog = () => {
    setDialog(null)
    // Land on the register that just grew, so the new rows are not invisible.
    if (catalogAdded > 0) selectTab(catalogTarget)
  }

  if (loading) return <Spinner />

  if (project === null || summary === null || meta === null) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <ErrorBanner message={error || 'This hardware project could not be loaded.'} />
        <Link
          to="/hardware"
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-indigo-400 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Hardware Management
        </Link>
      </div>
    )
  }

  const dashboard = summary.dashboard

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <Link
        to="/hardware"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-indigo-400"
      >
        <ArrowLeft className="h-4 w-4" />
        Hardware Management
      </Link>

      <header className="mb-6 mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
          <p className="mt-1 text-sm text-slate-400">
            {project.company || 'No company set'}
            {project.portal_reference !== '' && (
              <span className="text-slate-500"> · Portal ref {project.portal_reference}</span>
            )}
          </p>
          {project.description !== '' && (
            <p className="mt-2 max-w-3xl text-sm text-slate-500">{project.description}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setCatalogAdded(0)
              setDialog('catalog')
            }}
          >
            <span className="flex items-center gap-1.5">
              <Plus className="h-4 w-4" />
              Add from catalog
            </span>
          </Button>
          {/* An import appends rows server-side, and the next bulk save would then
              overwrite them with the stale working copy — so it waits for a clean
              register. The wrapper carries the tooltip because a disabled button
              fires no mouse events of its own. */}
          <span
            title={
              registersDirty
                ? 'Save or discard the unsaved register changes first — an import writes rows on the server.'
                : undefined
            }
          >
            <Button
              variant="secondary"
              onClick={() => setDialog('import')}
              disabled={registersDirty}
            >
              <span className="flex items-center gap-1.5">
                <Upload className="h-4 w-4" />
                Import Excel
              </span>
            </Button>
          </span>
          <a href={api.hwExportXlsxUrl(id)} download className={LINK_BUTTON}>
            <Download className="h-4 w-4" />
            Export Excel
          </a>
          <Button onClick={() => setDialog('edit')}>
            <span className="flex items-center gap-1.5">
              <Pencil className="h-4 w-4" />
              Edit project
            </span>
          </Button>
        </div>
      </header>

      {error !== '' && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Budget"
          value={formatEuro(dashboard.budget_total)}
          hint={budgetBreakdown(dashboard) ?? 'Approved as one overall figure'}
        />
        <KpiTile
          label="Committed"
          value={formatEuro(dashboard.spent_total)}
          hint="Purchases and leasing charged so far"
        />
        <KpiTile
          label="Planned"
          value={formatEuro(dashboard.planned_total)}
          hint="Planned purchases, not yet committed"
        />
        <KpiTile
          label="Remaining"
          value={formatEuro(dashboard.remaining)}
          hint="Budget less committed spend"
          tone={dashboard.remaining < 0 ? 'warning' : 'default'}
        />
      </div>

      <div className="mb-6">
        <UtilisationBar
          budget={dashboard.budget_total}
          committed={dashboard.spent_total}
          planned={dashboard.planned_total}
          remaining={dashboard.remaining}
        />
      </div>

      <nav className="mb-6 flex gap-1 border-b border-slate-800">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            onClick={() => selectTab(entry.key)}
            className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === entry.key
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {entry.label}
            {dirtyByTab[entry.key] && (
              <span
                className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle"
                title="Unsaved changes"
              />
            )}
          </button>
        ))}
      </nav>

      {tab === 'summary' && (
        <div className="space-y-6">
          {noticeFor('summary') !== '' && !adjustmentsDirty && (
            <div className="rounded-lg border border-emerald-800 bg-emerald-950/50 px-4 py-2 text-sm text-emerald-300">
              {noticeFor('summary')}
            </div>
          )}
          {summary.uncounted_rows > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                {plural(summary.uncounted_rows, 'register row')}{' '}
                {summary.uncounted_rows === 1 ? 'counts' : 'count'} towards no year — a missing
                purchase or end date, an unknown purchase type, or a date outside {FIRST_YEAR}–
                {LAST_YEAR}. Such rows carry a <span className="font-medium">not counted</span> mark
                in the registers; fix them there so the totals above include them.
              </p>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <button
              onClick={() => selectTab('assets')}
              className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-left transition-colors hover:border-indigo-800"
            >
              <p className="text-xs uppercase tracking-wide text-slate-500">Assets</p>
              <p className="mt-1 text-xl font-bold text-slate-100">
                {plural(summary.asset_count, 'row')}
              </p>
              <p className="mt-1 text-xs text-slate-500">Open the assets register</p>
            </button>
            <button
              onClick={() => selectTab('licenses')}
              className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-left transition-colors hover:border-indigo-800"
            >
              <p className="text-xs uppercase tracking-wide text-slate-500">Licenses</p>
              <p className="mt-1 text-xl font-bold text-slate-100">
                {plural(summary.license_count, 'row')}
              </p>
              <p className="mt-1 text-xs text-slate-500">Open the licenses register</p>
            </button>
          </div>

          <Card
            title="Budget by year"
            actions={
              <>
                {adjustmentsDirty ? (
                  <span className="self-center rounded-full border border-amber-800 bg-amber-950 px-2.5 py-0.5 text-xs font-medium text-amber-300">
                    Unsaved changes
                  </span>
                ) : null}
                {adjustmentsDirty && (
                  <Button
                    variant="ghost"
                    onClick={discardAdjustments}
                    disabled={saving === 'adjustments'}
                  >
                    Discard
                  </Button>
                )}
                <Button
                  onClick={saveAdjustments}
                  disabled={!adjustmentsDirty || saving === 'adjustments'}
                >
                  {saving === 'adjustments' ? 'Saving…' : 'Save special cases'}
                </Button>
              </>
            }
          >
            <SummaryYearTable
              rows={summary.years}
              totals={summary.totals}
              adjustmentOf={adjustmentOf}
              onAdjust={setAdjustment}
            />
            <p className="mt-3 max-w-4xl text-xs text-slate-500">
              Special cases are the working document's manual budget deltas. The actual columns
              already include the saved values; a change here only reaches them once it is saved.
            </p>
          </Card>

          <Card title="License renewal risk">
            <RenewalRisk risk={summary.risk} />
            <div className="mt-5">
              <ExpiringList rows={summary.expiring} />
            </div>
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <PivotCard
              title="Assets by category and status"
              pivot={summary.asset_pivot}
              empty="No assets in this register yet."
            />
            <PivotCard
              title="Licenses by category"
              pivot={summary.license_pivot}
              empty="No licenses in this register yet."
            />
          </div>
        </div>
      )}

      {tab === 'assets' && (
        <Card
          title={`Assets register · ${plural(assets.length, 'row')}`}
          actions={
            <RegisterActions
              dirty={assetsDirty}
              saving={saving === 'assets'}
              notice={noticeFor('assets')}
              onAdd={() => changeAssets([...assets, { ...BLANK_ASSET }])}
              onDiscard={discardAssets}
              onSave={saveAssets}
            />
          }
        >
          <HwAssetTable
            rows={assets}
            years={years}
            meta={meta}
            catalog={catalog}
            onChange={changeAssets}
          />
        </Card>
      )}

      {tab === 'licenses' && (
        <Card
          title={`Licenses register · ${plural(licenses.length, 'row')}`}
          actions={
            <RegisterActions
              dirty={licensesDirty}
              saving={saving === 'licenses'}
              notice={noticeFor('licenses')}
              onAdd={() => changeLicenses([...licenses, { ...BLANK_LICENSE }])}
              onDiscard={discardLicenses}
              onSave={saveLicenses}
            />
          }
        >
          <HwLicenseTable
            rows={licenses}
            years={years}
            meta={meta}
            catalog={catalog}
            onChange={changeLicenses}
          />
        </Card>
      )}

      {dialog === 'catalog' && (
        <CatalogPickerModal
          catalog={catalog}
          target={catalogTarget}
          addedCount={catalogAdded}
          onPick={addFromCatalog}
          onClose={closeCatalog}
        />
      )}

      {dialog === 'import' && (
        <HwImportDialog
          projectId={id}
          onClose={() => setDialog(null)}
          onImported={(result) => {
            setNotice({ scope: 'summary', text: describeImport(result) })
            load()
          }}
        />
      )}

      {dialog === 'edit' && (
        <EditProjectModal
          project={project}
          onSaved={(updated) => {
            setProject(updated)
            // The budgets drive every tile above, so the dashboard has to be re-read.
            refreshSummary(adjustmentsDirty).catch((e) => setError((e as Error).message))
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

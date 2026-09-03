import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Loader2,
  Minus,
  TriangleAlert,
  Upload,
} from 'lucide-react'
import { api } from '../api'
import type { HwAssetInput, HwImportPreview, HwLicenseInput } from '../types'
import { Button, EmptyState, ErrorBanner, Modal, Spinner } from './ui'
import { formatEuro } from '../utils'

/** Rows shown per register in the dry-run preview; the import itself takes all of them. */
const PREVIEW_LIMIT = 25
/** Warnings shown before the list collapses behind a toggle. */
const WARNING_LIMIT = 5
const EXPECTED_SHEETS = ['Assets', 'Licenses']

interface PreviewColumn<T> {
  key: string
  label: string
  right?: boolean
  render: (row: T) => ReactNode
}

function text(value: string): ReactNode {
  const trimmed = value.trim()
  return trimmed === '' ? <span className="text-slate-600">—</span> : trimmed
}

function date(value: string | null): ReactNode {
  return value ? value : <span className="text-slate-600">—</span>
}

const ASSET_COLUMNS: PreviewColumn<HwAssetInput>[] = [
  { key: 'tag', label: 'ID', render: (r) => text(r.asset_tag) },
  { key: 'name', label: 'Asset name', render: (r) => <span className="text-slate-200">{text(r.name)}</span> },
  { key: 'category', label: 'Category', render: (r) => text(r.category) },
  { key: 'status', label: 'Status', render: (r) => text(r.status) },
  { key: 'supplier', label: 'Supplier', render: (r) => text(r.supplier) },
  { key: 'purchase_date', label: 'Purchase date', render: (r) => date(r.purchase_date) },
  { key: 'cost', label: 'Cost', right: true, render: (r) => formatEuro(r.purchase_cost) },
  { key: 'type', label: 'Purchase type', render: (r) => text(r.purchase_type) },
]

const LICENSE_COLUMNS: PreviewColumn<HwLicenseInput>[] = [
  { key: 'tag', label: 'ID', render: (r) => text(r.license_tag) },
  { key: 'name', label: 'Name', render: (r) => <span className="text-slate-200">{text(r.name)}</span> },
  { key: 'category', label: 'Category', render: (r) => text(r.category) },
  { key: 'manufacturer', label: 'Manufacturer', render: (r) => text(r.manufacturer) },
  { key: 'quantity', label: 'Total', right: true, render: (r) => r.quantity },
  { key: 'purchase_date', label: 'Purchase date', render: (r) => date(r.purchase_date) },
  { key: 'expiration', label: 'Expiration', render: (r) => date(r.expiration_date) },
  { key: 'cost', label: 'Cost', right: true, render: (r) => formatEuro(r.purchase_cost) },
  { key: 'depreciation', label: 'Depreciation', render: (r) => text(r.depreciation) },
]

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'The workbook could not be processed.'
}

function PreviewTable<T>({
  rows,
  columns,
  keyOf,
}: {
  rows: T[]
  columns: PreviewColumn<T>[]
  keyOf: (row: T, index: number) => string
}) {
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-slate-800">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
          <tr className="border-b border-slate-800">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`whitespace-nowrap px-3 py-2 font-medium ${c.right ? 'text-right' : ''}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-slate-400">
          {rows.map((row, index) => (
            <tr key={keyOf(row, index)} className="border-b border-slate-800/60 last:border-0">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`whitespace-nowrap px-3 py-1.5 ${c.right ? 'text-right tabular-nums' : ''}`}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CountTile({ label, count, total }: { label: string; count: number; total: number }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-100">
        {count} <span className="text-sm font-normal text-slate-400">row{count === 1 ? '' : 's'}</span>
      </div>
      <div className="text-xs text-slate-500">{formatEuro(total)} total cost</div>
    </div>
  )
}

function SheetChip({ name, found }: { name: string; found: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        found
          ? 'border-emerald-800 bg-emerald-950/50 text-emerald-300'
          : 'border-slate-700 bg-slate-800/60 text-slate-500'
      }`}
    >
      {found ? <CheckCircle2 className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
      {name}
      {!found && ' — not in file'}
    </span>
  )
}

/**
 * Excel upload for one hardware project: the file is always dry-run first, so the
 * confirm step commits rows the user has already seen mapped into the register.
 */
export default function HwImportDialog({
  projectId,
  onClose,
  onImported,
}: {
  projectId: number
  onClose: () => void
  onImported: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<HwImportPreview | null>(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [showAllWarnings, setShowAllWarnings] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  /* Picking a second file while the first is still parsing must not let the slower
   * response overwrite the newer preview. */
  const dryRunSeq = useRef(0)

  const assetCount = preview?.assets.length ?? 0
  const licenseCount = preview?.licenses.length ?? 0
  const parsedCount = assetCount + licenseCount
  const warnings = preview?.warnings ?? []
  const busy = parsing || importing

  async function selectFile(picked: File | null | undefined) {
    if (!picked || importing) return
    setShowAllWarnings(false)
    // Bumped before any early return so an in-flight dry run for the previous file
    // can no longer land on top of this selection.
    const seq = dryRunSeq.current + 1
    dryRunSeq.current = seq
    if (!picked.name.toLowerCase().endsWith('.xlsx')) {
      setFile(null)
      setPreview(null)
      setParsing(false)
      setError(`"${picked.name}" is not an .xlsx workbook. Export the sheet as .xlsx and try again.`)
      return
    }
    setFile(picked)
    setPreview(null)
    setError('')
    setParsing(true)
    try {
      const result = await api.importHwWorkbook(projectId, picked, true)
      if (dryRunSeq.current !== seq) return
      setPreview(result)
    } catch (err) {
      if (dryRunSeq.current !== seq) return
      setError(errorMessage(err))
    } finally {
      if (dryRunSeq.current === seq) setParsing(false)
    }
  }

  async function confirmImport() {
    if (!file || busy || parsedCount === 0) return
    setImporting(true)
    setError('')
    try {
      await api.importHwWorkbook(projectId, file, false)
      onImported()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
      setImporting(false)
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    void selectFile(e.dataTransfer.files[0])
  }

  const visibleWarnings = showAllWarnings ? warnings : warnings.slice(0, WARNING_LIMIT)

  return (
    <Modal title="Import assets and licenses from Excel" onClose={onClose} size="xl">
      <div className="space-y-5">
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-400">
          <p>
            Upload an <span className="font-medium text-slate-200">.xlsx</span> workbook with an{' '}
            <span className="font-medium text-slate-200">Assets</span> sheet, a{' '}
            <span className="font-medium text-slate-200">Licenses</span> sheet, or both, carrying the
            working document&apos;s headers. Columns are matched by header name, extra columns are
            reported as warnings and per-year columns are ignored — depreciation is recomputed here.
            Imported rows are added to this project; nothing existing is overwritten.
          </p>
          <a
            href={api.hwImportTemplateUrl()}
            download
            className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-indigo-300 hover:text-indigo-200"
          >
            <Download className="h-4 w-4" />
            Download template
          </a>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault()
            if (!busy) setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`rounded-xl border border-dashed px-6 py-8 text-center transition-colors ${
            dragging ? 'border-indigo-800 bg-indigo-950/60' : 'border-slate-700 bg-slate-900/40'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              void selectFile(e.target.files?.[0])
              // Lets the same file be re-selected after a failed parse.
              e.target.value = ''
            }}
          />
          <Upload className="mx-auto h-6 w-6 text-slate-500" />
          <p className="mt-2 text-sm text-slate-400">
            Drag the workbook here, or pick it from your computer.
          </p>
          <div className="mt-3">
            <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
              Choose file
            </Button>
          </div>
          {file && (
            <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-sm text-slate-300">
              <FileSpreadsheet className="h-4 w-4 text-slate-400" />
              <span className="font-medium text-slate-200">{file.name}</span>
              <span className="text-xs text-slate-500">{formatSize(file.size)}</span>
            </div>
          )}
        </div>

        {error && <ErrorBanner message={error} />}

        {parsing && (
          <div>
            <Spinner />
            <p className="text-center text-sm text-slate-500">Parsing the workbook…</p>
          </div>
        )}

        {preview && !parsing && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-slate-500">Sheets</span>
              {EXPECTED_SHEETS.map((name) => (
                <SheetChip
                  key={name}
                  name={name}
                  found={preview.sheets_found.some((s) => s.trim().toLowerCase() === name.toLowerCase())}
                />
              ))}
              {preview.sheets_found
                .filter((s) => !EXPECTED_SHEETS.some((e) => e.toLowerCase() === s.trim().toLowerCase()))
                .map((s) => (
                  <SheetChip key={s} name={s} found />
                ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <CountTile
                label="Assets parsed"
                count={assetCount}
                total={preview.assets.reduce((sum, a) => sum + a.purchase_cost, 0)}
              />
              <CountTile
                label="Licenses parsed"
                count={licenseCount}
                total={preview.licenses.reduce((sum, l) => sum + l.purchase_cost, 0)}
              />
            </div>

            {warnings.length > 0 && (
              <div className="rounded-lg border border-amber-800 bg-amber-950/30 px-4 py-3">
                <div className="flex items-start gap-2 text-sm text-amber-200">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <span className="font-medium">
                      {warnings.length} warning{warnings.length === 1 ? '' : 's'}
                    </span>{' '}
                    — informational only. The import is not blocked; every row listed below as parsed
                    will still be created.
                  </div>
                </div>
                <ul className="mt-2 space-y-1 pl-6 text-sm text-amber-200/90">
                  {visibleWarnings.map((w, i) => (
                    <li key={`${i}-${w}`} className="list-disc">
                      {w}
                    </li>
                  ))}
                </ul>
                {warnings.length > WARNING_LIMIT && (
                  <button
                    onClick={() => setShowAllWarnings((v) => !v)}
                    className="mt-2 inline-flex items-center gap-1 pl-6 text-xs font-medium text-amber-300 hover:text-amber-200"
                  >
                    {showAllWarnings ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                    {showAllWarnings
                      ? 'Show fewer'
                      : `Show all ${warnings.length} warnings`}
                  </button>
                )}
              </div>
            )}

            {parsedCount === 0 ? (
              <EmptyState>
                No rows were parsed from this workbook. Check that the sheets are named Assets and
                Licenses and that the header row matches the template.
              </EmptyState>
            ) : (
              <div className="space-y-4">
                {assetCount > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-slate-200">
                      Assets preview
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        {assetCount > PREVIEW_LIMIT
                          ? `first ${PREVIEW_LIMIT} of ${assetCount} rows`
                          : `all ${assetCount} row${assetCount === 1 ? '' : 's'}`}
                      </span>
                    </h4>
                    <PreviewTable
                      rows={preview.assets.slice(0, PREVIEW_LIMIT)}
                      columns={ASSET_COLUMNS}
                      keyOf={(_row, i) => String(i)}
                    />
                  </div>
                )}
                {licenseCount > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-slate-200">
                      Licenses preview
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        {licenseCount > PREVIEW_LIMIT
                          ? `first ${PREVIEW_LIMIT} of ${licenseCount} rows`
                          : `all ${licenseCount} row${licenseCount === 1 ? '' : 's'}`}
                      </span>
                    </h4>
                    <PreviewTable
                      rows={preview.licenses.slice(0, PREVIEW_LIMIT)}
                      columns={LICENSE_COLUMNS}
                      keyOf={(_row, i) => String(i)}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-4">
          <span className="mr-auto text-xs text-slate-500">
            {parsedCount > 0
              ? `${assetCount} asset${assetCount === 1 ? '' : 's'} and ${licenseCount} license${
                  licenseCount === 1 ? '' : 's'
                } will be added to this project.`
              : 'Choose a workbook to preview what would be imported.'}
          </span>
          <Button variant="secondary" onClick={onClose} disabled={importing}>
            Cancel
          </Button>
          <Button onClick={() => void confirmImport()} disabled={busy || parsedCount === 0}>
            {importing ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Importing…
              </span>
            ) : parsedCount > 0 ? (
              `Import ${parsedCount} row${parsedCount === 1 ? '' : 's'}`
            ) : (
              'Import'
            )}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

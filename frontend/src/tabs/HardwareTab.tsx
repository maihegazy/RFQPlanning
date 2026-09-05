import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type {
  HardwareBilling,
  HardwareCatalogItem,
  HardwareItemInput,
  Meta,
  Project,
} from '../types'
import { Button, Card, EmptyState, ErrorBanner, Input, Select, Spinner } from '../components/ui'
import HardwareCatalogModal from '../components/HardwareCatalogModal'
import HardwareWizardModal from '../components/HardwareWizardModal'
import { downloadBlob } from '../download'
import { formatEuro, projectYears } from '../utils'

/** One editable table row; `id` is null for rows not yet saved. */
interface EditRow extends HardwareItemInput {
  key: number
  id: number | null
  dirty: boolean
}

let nextKey = 1

function rowTotal(row: HardwareItemInput): number {
  const occurrences = row.billing === 'once' ? 1 : row.years.length
  return row.unit_cost * row.qty * occurrences
}

/** Cost a row contributes to each year (once → its single/first year). */
function rowYearCosts(row: HardwareItemInput, startYear: number): Record<number, number> {
  const perOccurrence = row.unit_cost * row.qty
  if (row.billing === 'once') {
    return { [row.years[0] ?? startYear]: perOccurrence }
  }
  const costs: Record<number, number> = {}
  for (const year of row.years) costs[year] = perOccurrence
  return costs
}

export default function HardwareTab({ project, meta }: { project: Project; meta: Meta }) {
  const years = projectYears(project.start_year, project.end_year)
  const [rows, setRows] = useState<EditRow[] | null>(null)
  const [deletedIds, setDeletedIds] = useState<number[]>([])
  const [catalog, setCatalog] = useState<HardwareCatalogItem[]>([])
  const [showCatalog, setShowCatalog] = useState(false)
  const [showWizard, setShowWizard] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const reload = useCallback(() => {
    api
      .getHardwarePlan(project.id)
      .then((plan) => {
        setRows(
          plan.items.map((item) => ({
            key: nextKey++,
            id: item.id,
            catalog_item_id: item.catalog_item_id,
            name: item.name,
            aspice: item.aspice,
            billing: item.billing,
            unit_cost: item.unit_cost,
            qty: item.qty,
            years: item.years,
            supplier_name: item.supplier_name,
            supplier_email: item.supplier_email,
            dirty: false,
          })),
        )
        setDeletedIds([])
      })
      .catch((e) => setError(e.message))
  }, [project.id])

  const reloadCatalog = useCallback(() => {
    api
      .listHardwareCatalog()
      .then(setCatalog)
      .catch(() => setCatalog([]))
  }, [])

  useEffect(() => {
    reload()
    reloadCatalog()
  }, [reload, reloadCatalog])

  const updateRow = (key: number, patch: Partial<EditRow>) => {
    setRows(
      (prev) =>
        prev?.map((row) => (row.key === key ? { ...row, ...patch, dirty: true } : row)) ?? prev,
    )
  }

  const toggleYear = (row: EditRow, year: number) => {
    let selected: number[]
    if (row.years.includes(year)) {
      selected = row.years.filter((y) => y !== year)
    } else if (row.billing === 'once') {
      // A one-time purchase has exactly one purchase year
      selected = [year]
    } else {
      selected = [...row.years, year].sort((a, b) => a - b)
    }
    updateRow(row.key, { years: selected })
  }

  const addBlankRow = () => {
    setRows((prev) => [
      ...(prev ?? []),
      {
        key: nextKey++,
        id: null,
        catalog_item_id: null,
        name: '',
        aspice: 'SWE.3',
        billing: 'yearly',
        unit_cost: 0,
        qty: 1,
        years: [...years],
        supplier_name: '',
        supplier_email: '',
        dirty: true,
      },
    ])
  }

  const addFromCatalog = (catalogId: number) => {
    const item = catalog.find((c) => c.id === catalogId)
    if (!item) return
    setRows((prev) => [
      ...(prev ?? []),
      {
        key: nextKey++,
        id: null,
        catalog_item_id: item.id,
        name: item.name,
        aspice: item.aspice,
        billing: item.billing,
        unit_cost: item.unit_cost,
        qty: 1,
        years: item.billing === 'once' ? [years[0]] : [...years],
        supplier_name: item.supplier_name,
        supplier_email: item.supplier_email,
        dirty: true,
      },
    ])
  }

  const removeRow = (row: EditRow) => {
    if (row.id !== null) setDeletedIds((prev) => [...prev, row.id as number])
    setRows((prev) => prev?.filter((r) => r.key !== row.key) ?? prev)
  }

  const hasChanges = deletedIds.length > 0 || (rows?.some((row) => row.dirty) ?? false)

  const save = async () => {
    if (!rows) return
    setSaving(true)
    setError('')
    try {
      for (const id of deletedIds) {
        await api.deleteHardwareItem(id)
      }
      for (const row of rows) {
        if (!row.dirty) continue
        const payload: HardwareItemInput = {
          catalog_item_id: row.catalog_item_id,
          name: row.name.trim() || 'Hardware item',
          aspice: row.aspice,
          billing: row.billing,
          unit_cost: row.unit_cost,
          qty: row.qty,
          years: row.years,
          supplier_name: row.supplier_name,
          supplier_email: row.supplier_email,
        }
        if (row.id === null) {
          await api.createHardwareItem(project.id, payload)
        } else {
          await api.updateHardwareItem(row.id, payload)
        }
      }
      setSavedAt(Date.now())
      reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const downloadExcel = async () => {
    setError('')
    try {
      const resp = await fetch(api.hardwarePlanXlsxUrl(project.id))
      if (!resp.ok) {
        const body = await resp.json().catch(() => null)
        throw new Error(body?.detail ?? 'Export failed')
      }
      downloadBlob(await resp.blob(), `${project.name} - Hardware Plan.xlsx`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  /** Catalog grouped by supplier so the picker stays navigable. */
  const catalogBySupplier = useMemo(() => {
    const groups = new Map<string, HardwareCatalogItem[]>()
    for (const item of catalog) {
      const supplier = item.supplier_name.trim() || 'Other'
      const group = groups.get(supplier)
      if (group) group.push(item)
      else groups.set(supplier, [item])
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [catalog])

  const totals = useMemo(() => {
    const perYear: Record<number, number> = {}
    let grand = 0
    for (const row of rows ?? []) {
      grand += rowTotal(row)
      const costs = rowYearCosts(row, project.start_year)
      for (const [year, cost] of Object.entries(costs)) {
        perYear[Number(year)] = (perYear[Number(year)] ?? 0) + cost
      }
    }
    return { perYear, grand }
  }, [rows, project.start_year])

  if (!rows) return error ? <ErrorBanner message={error} /> : <Spinner />

  return (
    <div className="space-y-6">
      <Card
        title="Hardware & Tools Plan"
        actions={
          <>
            <div className="w-64">
              <Select
                value=""
                onChange={(e) => {
                  if (e.target.value) addFromCatalog(Number(e.target.value))
                }}
              >
                <option value="">+ Add from catalog…</option>
                <option value="">+ Add from catalog…</option>
                {catalogBySupplier.map(([supplier, supplierItems]) => (
                  <optgroup key={supplier} label={supplier}>
                    {supplierItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} — {formatEuro(item.unit_cost)}
                        {item.billing === 'yearly' ? '/yr' : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </div>
            <Button variant="secondary" onClick={() => setShowWizard(true)}>
              ✨ Generate Plan
            </Button>
            <Button variant="secondary" onClick={addBlankRow}>
              + Add Item
            </Button>
            <Button variant="secondary" onClick={() => setShowCatalog(true)}>
              Manage Catalog
            </Button>
            <Button variant="secondary" onClick={downloadExcel} disabled={rows.length === 0}>
              Download Excel
            </Button>
            <Button onClick={save} disabled={!hasChanges || saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </>
        }
      >
        {error && (
          <div className="mb-4">
            <ErrorBanner message={error} />
          </div>
        )}
        {savedAt !== null && !hasChanges && !error && (
          <div className="mb-4 rounded-lg border border-emerald-800 bg-emerald-950/50 px-4 py-2 text-sm text-emerald-300">
            ✓ Hardware plan saved.
          </div>
        )}
        <p className="mb-4 text-sm text-slate-400">
          Plan the hardware and tools this quotation needs. Yearly items are paid for every selected
          year; one-time purchases land in their single purchase year. Alternatives can be captured
          with quantity 0.
        </p>

        {rows.length === 0 ? (
          <EmptyState>
            No hardware planned yet. Add an item or pick one from the catalog.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-2">ASPICE</th>
                  <th className="py-2 pr-2">Item</th>
                  <th className="py-2 pr-2">Billing</th>
                  <th className="py-2 pr-2">Unit Cost (€)</th>
                  <th className="py-2 pr-2">Qty</th>
                  {years.map((year) => (
                    <th key={year} className="py-2 pr-2 text-center">
                      {year}
                    </th>
                  ))}
                  <th className="py-2 pr-6 text-right">Total</th>
                  <th className="py-2 pr-2">Supplier</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-b border-slate-800 align-top">
                    <td className="py-2 pr-2">
                      <Select
                        className="min-w-24 px-2"
                        value={row.aspice}
                        onChange={(e) => updateRow(row.key, { aspice: e.target.value })}
                      >
                        {meta.aspice_processes.map((p) => (
                          <option key={p}>{p}</option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-2 pr-2">
                      <Input
                        className="min-w-40"
                        value={row.name}
                        placeholder="e.g. Vector CANoe license"
                        onChange={(e) => updateRow(row.key, { name: e.target.value })}
                      />
                      {row.qty === 0 && (
                        <span className="mt-1 block text-xs text-slate-500">
                          alternative (qty 0)
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      <Select
                        className="min-w-24 px-2"
                        value={row.billing}
                        onChange={(e) => {
                          const billing = e.target.value as HardwareBilling
                          updateRow(row.key, {
                            billing,
                            years:
                              billing === 'once' && row.years.length > 1
                                ? [row.years[0]]
                                : row.years,
                          })
                        }}
                      >
                        {meta.hardware_billing.map((b) => (
                          <option key={b} value={b}>
                            {b === 'yearly' ? 'Yearly' : 'Once'}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-2 pr-2">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        className="w-28 text-right"
                        value={row.unit_cost}
                        onChange={(e) => updateRow(row.key, { unit_cost: Number(e.target.value) })}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <Input
                        type="number"
                        min={0}
                        step="1"
                        className="w-16 text-right"
                        value={row.qty}
                        onChange={(e) =>
                          updateRow(row.key, {
                            qty: Math.max(0, Math.floor(Number(e.target.value))),
                          })
                        }
                      />
                    </td>
                    {years.map((year) => (
                      <td key={year} className="py-2 pr-2 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer accent-indigo-500"
                          checked={row.years.includes(year)}
                          onChange={() => toggleYear(row, year)}
                          aria-label={`${row.name || 'item'} in ${year}`}
                        />
                      </td>
                    ))}
                    <td className="py-2 pr-6 text-right font-medium whitespace-nowrap">
                      {formatEuro(rowTotal(row))}
                    </td>
                    <td className="py-2 pr-2">
                      {row.catalog_item_id !== null ? (
                        // Catalog-linked row: the vendor entry owns the contact
                        <div className="min-w-36 py-2">
                          <div className="whitespace-nowrap text-slate-200">
                            {row.supplier_name || '—'}
                          </div>
                          {row.supplier_email ? (
                            <a
                              href={`mailto:${row.supplier_email}`}
                              className="text-xs text-indigo-400 hover:underline"
                            >
                              {row.supplier_email}
                            </a>
                          ) : (
                            <button
                              onClick={() => setShowCatalog(true)}
                              className="text-xs text-slate-500 hover:text-indigo-400"
                            >
                              + add email in catalog
                            </button>
                          )}
                        </div>
                      ) : (
                        <>
                          <Input
                            className="min-w-36"
                            value={row.supplier_name}
                            placeholder="Supplier"
                            onChange={(e) => updateRow(row.key, { supplier_name: e.target.value })}
                          />
                          <span className="mt-1 block text-xs text-slate-500">
                            contact from catalog
                          </span>
                        </>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <Button variant="ghost" onClick={() => removeRow(row)} title="Remove">
                        ✕
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-800/50 font-semibold">
                  <td className="py-2.5 pr-2" colSpan={5}>
                    TOTAL
                  </td>
                  {years.map((year) => (
                    <td key={year} className="py-2.5 pr-2 text-center whitespace-nowrap">
                      {formatEuro(totals.perYear[year] ?? 0)}
                    </td>
                  ))}
                  <td className="py-2.5 pr-6 text-right whitespace-nowrap">
                    {formatEuro(totals.grand)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {showWizard && (
        <HardwareWizardModal
          project={project}
          existingCount={rows.length}
          onClose={() => setShowWizard(false)}
          onGenerated={() => {
            setSavedAt(null)
            reload()
          }}
        />
      )}

      {showCatalog && (
        <HardwareCatalogModal
          onClose={() => setShowCatalog(false)}
          onChanged={() => {
            reloadCatalog()
            reload()
          }}
        />
      )}
    </div>
  )
}

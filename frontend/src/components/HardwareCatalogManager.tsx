import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import type { HardwareBilling, HardwareCatalogItem, HardwareCatalogItemInput, Meta } from '../types'
import { Button, EmptyState, ErrorBanner, Input, Label, Select, Spinner, Stat } from './ui'
import { formatEuro } from '../utils'

const EMPTY_FORM: HardwareCatalogItemInput = {
  name: '',
  aspice: 'SWE.3',
  billing: 'yearly',
  unit_cost: 0,
  supplier_name: '',
  supplier_email: '',
}

type SortKey = 'name' | 'supplier_name' | 'unit_cost'

function Pill({ tone, children }: { tone: 'sky' | 'amber' | 'slate'; children: React.ReactNode }) {
  const tones = {
    sky: 'bg-sky-950 text-sky-300 border-sky-800',
    amber: 'bg-amber-950 text-amber-300 border-amber-800',
    slate: 'bg-slate-800 text-slate-300 border-slate-700',
  }
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

/**
 * Master hardware/tool catalog editor. Rendered both as a standalone portal
 * page and inside a modal opened from the Hardware planning tab. Supplier
 * contact details live here only — project hardware rows read the email from
 * the vendor's catalog entry.
 */
export default function HardwareCatalogManager({ onChanged }: { onChanged?: () => void }) {
  const [items, setItems] = useState<HardwareCatalogItem[] | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const [search, setSearch] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [billingFilter, setBillingFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortAsc, setSortAsc] = useState(true)

  const [form, setForm] = useState<HardwareCatalogItemInput>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const formRef = useRef<HTMLDivElement>(null)

  const reload = useCallback(
    (notify = false) => {
      api
        .listHardwareCatalog()
        .then((data) => {
          setItems(data)
          if (notify) onChanged?.()
        })
        .catch((e) => setError(e.message))
    },
    [onChanged],
  )

  useEffect(() => {
    reload()
    api
      .getMeta()
      .then(setMeta)
      .catch((e) => setError(e.message))
  }, [reload])

  const suppliers = useMemo(
    () => [...new Set((items ?? []).map((i) => i.supplier_name.trim() || 'Other'))].sort(),
    [items],
  )

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = (items ?? []).filter((item) => {
      const supplier = item.supplier_name.trim() || 'Other'
      if (supplierFilter && supplier !== supplierFilter) return false
      if (billingFilter && item.billing !== billingFilter) return false
      if (!query) return true
      return (
        item.name.toLowerCase().includes(query) ||
        item.supplier_name.toLowerCase().includes(query) ||
        item.aspice.toLowerCase().includes(query)
      )
    })
    return [...filtered].sort((a, b) => {
      const dir = sortAsc ? 1 : -1
      if (sortKey === 'unit_cost') return (a.unit_cost - b.unit_cost) * dir
      const av = String(a[sortKey]).toLowerCase()
      const bv = String(b[sortKey]).toLowerCase()
      return av.localeCompare(bv) * dir
    })
  }, [items, search, supplierFilter, billingFilter, sortKey, sortAsc])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortAsc(!sortAsc)
    else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  const sortArrow = (key: SortKey) => (key === sortKey ? (sortAsc ? ' ↑' : ' ↓') : '')
  const ariaSort = (key: SortKey) =>
    key === sortKey ? (sortAsc ? ('ascending' as const) : ('descending' as const)) : undefined
  /** A sortable header is a real button, so the keyboard and screen readers get it too. */
  const sortHeader = (key: SortKey, label: string, right = false) => (
    <th
      scope="col"
      aria-sort={ariaSort(key)}
      className={`px-3 py-2.5 ${right ? 'text-right' : ''}`}
    >
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className="cursor-pointer uppercase tracking-wide hover:text-slate-200"
      >
        {label}
        {sortArrow(key)}
      </button>
    </th>
  )

  const startEdit = (item: HardwareCatalogItem) => {
    setEditingId(item.id)
    setForm({
      name: item.name,
      aspice: item.aspice,
      billing: item.billing,
      unit_cost: item.unit_cost,
      supplier_name: item.supplier_name,
      supplier_email: item.supplier_email,
    })
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      if (editingId === null) await api.createHardwareCatalogItem(form)
      else await api.updateHardwareCatalogItem(editingId, form)
      cancelEdit()
      reload(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: number) => {
    setError('')
    try {
      await api.deleteHardwareCatalogItem(id)
      setConfirmDeleteId(null)
      if (editingId === id) cancelEdit()
      reload(true)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const yearlyCount = (items ?? []).filter((i) => i.billing === 'yearly').length
  const filtersActive = Boolean(search.trim() || supplierFilter || billingFilter)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-400">
          Shared master list of hardware and tools. Adding an item to a project copies its price and
          billing mode, so later catalog changes never alter an existing quotation — supplier
          contact details stay here and are always read from the vendor's entry.
        </p>
        {items && (
          <div className="flex gap-2">
            <Stat size="sm" label="items" value={items.length} />
            <Stat size="sm" label="suppliers" value={suppliers.length} />
            <Stat
              label="yearly / one-time"
              value={`${yearlyCount} / ${items.length - yearlyCount}`}
            />
          </div>
        )}
      </div>

      {error && <ErrorBanner message={error} />}

      {items !== null && items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <div className="min-w-56 flex-1">
            <Input
              placeholder="Search item, supplier or ASPICE…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="w-48">
            <Select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
              <option value="">All suppliers</option>
              {suppliers.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </div>
          <div className="w-40">
            <Select value={billingFilter} onChange={(e) => setBillingFilter(e.target.value)}>
              <option value="">All billing</option>
              <option value="yearly">Yearly</option>
              <option value="once">One-time</option>
            </Select>
          </div>
          {filtersActive && (
            <Button
              variant="secondary"
              onClick={() => {
                setSearch('')
                setSupplierFilter('')
                setBillingFilter('')
              }}
            >
              Clear
            </Button>
          )}
        </div>
      )}

      {items === null ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState>No catalog items yet. Add the first one below.</EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState>No items match the current filters.</EmptyState>
      ) : (
        <>
          <div className="max-h-[45vh] overflow-auto rounded-lg border border-slate-800">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-900">
                <tr className="border-b border-slate-700 text-left text-xs uppercase tracking-wide text-slate-400">
                  {sortHeader('name', 'Item')}
                  <th scope="col" className="px-3 py-2.5">
                    ASPICE
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    Billing
                  </th>
                  {sortHeader('unit_cost', 'Unit Cost', true)}
                  {sortHeader('supplier_name', 'Supplier')}
                  <th scope="col" className="px-3 py-2.5">
                    Contact
                  </th>
                  <th scope="col" className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr
                    key={item.id}
                    className={`border-b border-slate-800 last:border-0 hover:bg-slate-800/40 ${
                      editingId === item.id ? 'bg-indigo-950/40' : ''
                    }`}
                  >
                    <td className="px-3 py-2.5 font-medium text-slate-100">{item.name}</td>
                    <td className="px-3 py-2.5">
                      <Pill tone="slate">{item.aspice}</Pill>
                    </td>
                    <td className="px-3 py-2.5">
                      <Pill tone={item.billing === 'yearly' ? 'sky' : 'amber'}>
                        {item.billing === 'yearly' ? 'Yearly' : 'One-time'}
                      </Pill>
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">
                      {formatEuro(item.unit_cost)}
                      {item.billing === 'yearly' && (
                        <span className="text-xs text-slate-500">/yr</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{item.supplier_name || '—'}</td>
                    <td className="px-3 py-2.5">
                      {item.supplier_email ? (
                        <a
                          href={`mailto:${item.supplier_email}`}
                          className="text-indigo-400 hover:underline"
                        >
                          {item.supplier_email}
                        </a>
                      ) : (
                        <button
                          onClick={() => startEdit(item)}
                          className="text-xs text-slate-500 hover:text-indigo-400"
                        >
                          + add email
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {confirmDeleteId === item.id ? (
                        <>
                          <span className="mr-1 text-xs text-rose-300">Delete?</span>
                          <Button variant="danger" onClick={() => remove(item.id)}>
                            Yes
                          </Button>
                          <Button variant="ghost" onClick={() => setConfirmDeleteId(null)}>
                            No
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button variant="ghost" onClick={() => startEdit(item)}>
                            Edit
                          </Button>
                          <Button variant="ghost" onClick={() => setConfirmDeleteId(item.id)}>
                            Delete
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            Showing {visible.length} of {items.length} items. Deleting a catalog item keeps it on
            projects that already use it.
          </p>
        </>
      )}

      <div
        ref={formRef}
        className={`rounded-lg border p-4 ${
          editingId === null
            ? 'border-slate-800 bg-slate-900/60'
            : 'border-indigo-800 bg-indigo-950/30'
        }`}
      >
        <h4 className="mb-3 text-sm font-semibold text-slate-200">
          {editingId === null ? 'Add catalog item' : `Edit “${form.name}”`}
        </h4>
        {meta === null ? (
          <Spinner />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <Label>Item name</Label>
                <Input
                  placeholder="e.g. CANoe PRO (perpetual)"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <Label>Unit cost (€)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  className="text-right"
                  value={form.unit_cost}
                  onChange={(e) => setForm({ ...form, unit_cost: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>ASPICE process</Label>
                <Select
                  value={form.aspice}
                  onChange={(e) => setForm({ ...form, aspice: e.target.value })}
                >
                  {meta.aspice_processes.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Billing</Label>
                <Select
                  value={form.billing}
                  onChange={(e) => setForm({ ...form, billing: e.target.value as HardwareBilling })}
                >
                  {meta.hardware_billing.map((b) => (
                    <option key={b} value={b}>
                      {b === 'yearly' ? 'Yearly (per project year)' : 'One-time purchase'}
                    </option>
                  ))}
                </Select>
              </div>
              <div />
              <div>
                <Label>Supplier</Label>
                <Input
                  placeholder="e.g. Vector"
                  value={form.supplier_name}
                  onChange={(e) => setForm({ ...form, supplier_name: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <Label>Supplier email</Label>
                <Input
                  type="email"
                  placeholder="orders@supplier.com"
                  value={form.supplier_email}
                  onChange={(e) => setForm({ ...form, supplier_email: e.target.value })}
                />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="text-xs text-slate-500">
                Supplier contact is stored once per vendor here and shown on every project that
                plans this item.
              </p>
              <div className="flex gap-2">
                {editingId !== null && (
                  <Button variant="secondary" onClick={cancelEdit}>
                    Cancel
                  </Button>
                )}
                <Button onClick={save} disabled={saving || !form.name.trim()}>
                  {saving ? 'Saving…' : editingId === null ? 'Add to Catalog' : 'Save Changes'}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

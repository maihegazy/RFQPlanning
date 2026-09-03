import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { ProjectSummary, ProjectTemplate } from '../types'
import { Button, ErrorBanner, EmptyState, Input, Label, Modal, Select, Spinner, StatusBadge } from '../components/ui'
import { MONTH_NAMES } from '../utils'
import { downloadBlob } from '../download'
import { useVault } from '../vault/VaultContext'
import { VaultDialog, VaultStatusButton } from '../vault/VaultGate'
import { emptyMoneyConfig, type MoneyConfig } from '../money/types'

type LegacyImport = {
  rate_config?: Record<string, unknown>
  [key: string]: unknown
}

const STATUS_TABS = [
  { key: '', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'quoted', label: 'Quoted' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
]

const SORT_OPTIONS = [
  { key: 'updated', label: 'Recently updated' },
  { key: 'name', label: 'Name (A–Z)' },
  { key: 'start', label: 'Start date' },
  { key: 'status', label: 'Status' },
]

type SortKey = 'updated' | 'name' | 'start' | 'status'

const STATUS_ORDER: Record<string, number> = { quoted: 0, draft: 1, won: 2, lost: 3 }

/** Inclusive project duration in months. */
function monthSpan(p: ProjectSummary): number {
  return (p.end_year - p.start_year) * 12 + (p.end_month - p.start_month) + 1
}

/** Timestamps arrive as naive UTC — normalise before comparing to "now". */
function relativeTime(iso: string): string {
  const stamp = /[Z+]/.test(iso) ? iso : `${iso}Z`
  const days = Math.floor((Date.now() - new Date(stamp).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.round(days / 30)
  return months <= 1 ? 'last month' : `${months} months ago`
}

function Stat({ label, value, tone = 'text-slate-100' }: {
  label: string
  value: string | number
  tone?: string
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
      <div className={`text-2xl font-semibold ${tone}`}>{value}</div>
      <div className="mt-0.5 text-xs uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  )
}

function ProjectCard({
  project,
  onExport,
  onDelete,
}: {
  project: ProjectSummary
  onExport: () => void
  onDelete: () => void
}) {
  const p = project
  const inFlight = p.status === 'draft' || p.status === 'quoted'
  return (
    <div className="group relative h-full rounded-xl border border-slate-800 bg-slate-900/60 transition-colors hover:border-indigo-600/60 hover:bg-slate-900">
      <Link to={`/projects/${p.id}`} className="flex h-full flex-col p-5">
        <div className="flex items-start gap-2 pr-16">
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold text-slate-100 group-hover:text-indigo-300">
            {p.name}
          </h2>
          {p.is_winning_scenario && <span title="Winning scenario">👑</span>}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <StatusBadge status={p.status} />
          <span className="min-w-0 truncate text-sm text-slate-400">{p.company}</span>
        </div>

        <p className="mt-3 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
          <span aria-hidden>🗓</span>
          <span className="text-slate-400">
            {MONTH_NAMES[p.start_month - 1].slice(0, 3)} {p.start_year} –{' '}
            {MONTH_NAMES[p.end_month - 1].slice(0, 3)} {p.end_year}
          </span>
          <span className="text-slate-600">·</span>
          <span>{monthSpan(p)} months</span>
        </p>

        {inFlight && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-slate-500">Win probability</span>
              <span className="font-medium text-slate-300">{p.win_probability_pct}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-indigo-500"
                style={{ width: `${Math.max(0, Math.min(100, p.win_probability_pct))}%` }}
              />
            </div>
          </div>
        )}
        {p.status === 'lost' && p.lost_reason && (
          <p className="mt-3 truncate text-xs text-rose-300/80" title={p.lost_reason}>
            Lost: {p.lost_reason}
          </p>
        )}
        <div className="h-4" />

        <div className="mt-auto flex items-center justify-between border-t border-slate-800 pt-3 text-xs text-slate-500">
          <span>Updated {relativeTime(p.updated_at)}</span>
          <span className="text-indigo-400 opacity-0 transition-opacity group-hover:opacity-100">
            Open →
          </span>
        </div>
      </Link>

      <div className="absolute right-3 top-3 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <button
          onClick={onExport}
          title="Export as JSON"
          aria-label={`Export ${p.name} as JSON`}
          className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
        >
          ⬇
        </button>
        <button
          onClick={onDelete}
          title="Delete project"
          aria-label={`Delete ${p.name}`}
          className="rounded-md px-2 py-1 text-slate-400 hover:bg-rose-950 hover:text-rose-300"
        >
          🗑
        </button>
      </div>
    </div>
  )
}

function containsFinancialData(data: LegacyImport): boolean {
  const rates = data.rate_config ?? {}
  return Boolean(
    rates.hourly_rates || rates.cost_rates || rates.ticket_price || rates.hw_cost_per_hour,
  )
}

export default function ProjectsPage() {
  const vault = useVault()
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('updated')
  const [pendingImport, setPendingImport] = useState<LegacyImport | null>(null)
  const [showImportVault, setShowImportVault] = useState(false)
  const [importReady, setImportReady] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  // Load once and filter in the browser: the list is small, and it keeps the
  // status counts and search instant.
  const load = useCallback(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch((e) => setError(e.message))
  }, [])

  useEffect(load, [load])

  const importProject = useCallback(
    async (data: LegacyImport) => {
      const project = await api.importProject(data)
      if (!containsFinancialData(data)) return project

      try {
        const meta = await api.getMeta()
        const rates = data.rate_config ?? {}
        const base = emptyMoneyConfig(meta.locations, meta.levels, meta.ticket_sizes)
        const money: MoneyConfig = {
          ...base,
          hourly_rates: { ...base.hourly_rates, ...((rates.hourly_rates ?? {}) as object) },
          cost_rates: Object.fromEntries(
            meta.locations.map((location) => [
              location,
              {
                ...base.cost_rates[location],
                ...(((rates.cost_rates as Record<string, object> | undefined)?.[location]) ?? {}),
              },
            ]),
          ),
          hw_cost_per_hour: Number(rates.hw_cost_per_hour ?? 0),
          ticket_prices: { ...base.ticket_prices, ...((rates.ticket_price ?? {}) as object) },
        }
        const blob = await vault.encrypt(money)
        await api.putMoneyBlob(project.id, {
          encrypted_money: blob.ciphertext,
          money_iv: blob.iv,
        })
        return project
      } catch (error) {
        await api.deleteProject(project.id).catch(() => undefined)
        throw error
      }
    },
    [vault],
  )

  useEffect(() => {
    if (!pendingImport || !importReady || vault.status !== 'unlocked') return

    const data = pendingImport
    setPendingImport(null)
    setImportReady(false)
    setShowImportVault(false)
    importProject(data)
      .then(() => {
        setNotice('Project imported with encrypted financial values.')
        load()
      })
      .catch((e) => setError(`Import failed: ${(e as Error).message}`))
  }, [importProject, importReady, load, pendingImport, vault.status])

  const handleDelete = async (project: ProjectSummary) => {
    if (!window.confirm(`Delete project "${project.name}"? This cannot be undone.`)) return
    try {
      await api.deleteProject(project.id)
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const handleImport = async (file: File) => {
    setError('')
    setNotice('')
    try {
      const data = JSON.parse(await file.text()) as LegacyImport
      if (containsFinancialData(data) && vault.status !== 'unlocked') {
        setPendingImport(data)
        setImportReady(false)
        setShowImportVault(true)
        setNotice('Unlock the financial vault to continue this import securely.')
        return
      }
      await importProject(data)
      setNotice('Project imported successfully.')
      load()
    } catch (e) {
      setError(`Import failed: ${(e as Error).message}`)
    }
  }

  const handleExport = async (project: ProjectSummary) => {
    setError('')
    setNotice('')
    try {
      const data = (await api.exportProject(project.id)) as {
        rate_config?: Record<string, unknown>
      }
      if (vault.status === 'unlocked') {
        const blob = await api.getMoneyBlob(project.id)
        if (blob.encrypted_money && blob.money_iv) {
          const money = await vault.decrypt<MoneyConfig>({
            iv: blob.money_iv,
            ciphertext: blob.encrypted_money,
          })
          data.rate_config = {
            ...(data.rate_config ?? {}),
            hourly_rates: money.hourly_rates,
            cost_rates: money.cost_rates,
            hw_cost_per_hour: money.hw_cost_per_hour,
            ticket_price: money.ticket_prices,
          }
        }
      } else {
        setNotice('Exported without financial values (vault locked). Unlock to include them.')
      }
      downloadBlob(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
        `${project.name}.json`,
      )
    } catch (e) {
      setError(`Export failed: ${(e as Error).message}`)
    }
  }

  const counts = useMemo(() => {
    const all = projects ?? []
    const by = (st: string) => all.filter((p) => p.status === st).length
    const won = by('won')
    const lost = by('lost')
    return {
      '': all.length,
      draft: by('draft'),
      quoted: by('quoted'),
      won,
      lost,
      inFlight: by('draft') + by('quoted'),
      hitRate: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null,
    } as Record<string, number | null>
  }, [projects])

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    const rows = (projects ?? []).filter((p) => {
      if (statusFilter && p.status !== statusFilter) return false
      if (!query) return true
      return (
        p.name.toLowerCase().includes(query) || p.company.toLowerCase().includes(query)
      )
    })
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return a.name.localeCompare(b.name)
        case 'start':
          return a.start_year * 12 + a.start_month - (b.start_year * 12 + b.start_month)
        case 'status':
          return (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
        default:
          return b.updated_at.localeCompare(a.updated_at)
      }
    })
  }, [projects, statusFilter, search, sortKey])

  const filtersActive = Boolean(statusFilter || search.trim())

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-indigo-800 bg-indigo-950 text-xl">
            📋
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">RFQ Planner</h1>
            <p className="text-sm text-slate-400">Resource &amp; budget planning for RFQs</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <VaultStatusButton />
          <Button onClick={() => setShowCreate(true)}>+ New Project</Button>
        </div>
      </header>

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-lg border border-indigo-800 bg-indigo-950/50 px-4 py-3 text-sm text-indigo-200">
          {notice}
        </div>
      )}

      {projects !== null && projects.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="RFQs" value={counts[''] ?? 0} />
          <Stat label="In flight" value={counts.inFlight ?? 0} tone="text-sky-300" />
          <Stat label="Won" value={counts.won ?? 0} tone="text-emerald-300" />
          <Stat
            label="Hit rate"
            value={counts.hitRate === null ? '—' : `${counts.hitRate}%`}
            tone="text-indigo-300"
          />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <div className="min-w-52 flex-1">
          <Input
            placeholder="Search by project or customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search projects"
          />
        </div>
        <div className="w-48">
          <Select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            aria-label="Sort projects"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="h-6 w-px bg-slate-800" />
        <input
          ref={fileInput}
          type="file"
          accept=".json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleImport(file)
            e.target.value = ''
          }}
        />
        <Button variant="secondary" onClick={() => fileInput.current?.click()}>
          ⬆ Import JSON
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              statusFilter === tab.key
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
            <span className={statusFilter === tab.key ? 'ml-1.5 text-indigo-200' : 'ml-1.5 text-slate-500'}>
              {counts[tab.key] ?? 0}
            </span>
          </button>
        ))}
        {filtersActive && (
          <button
            onClick={() => {
              setStatusFilter('')
              setSearch('')
            }}
            className="ml-1 rounded-full px-3 py-1 text-xs text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {projects === null ? (
        <Spinner />
      ) : projects.length === 0 ? (
        <EmptyState>
          <p className="text-base text-slate-300">No projects yet</p>
          <p className="mt-1">Create your first RFQ from a template, or import an existing one.</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button onClick={() => setShowCreate(true)}>+ New Project</Button>
            <Button variant="secondary" onClick={() => fileInput.current?.click()}>
              ⬆ Import JSON
            </Button>
          </div>
        </EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState>
          <p className="text-base text-slate-300">No projects match your filters</p>
          <p className="mt-1">Try a different search term or status.</p>
          <div className="mt-4 flex justify-center">
            <Button
              variant="secondary"
              onClick={() => {
                setStatusFilter('')
                setSearch('')
              }}
            >
              Clear filters
            </Button>
          </div>
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                onExport={() => handleExport(p)}
                onDelete={() => handleDelete(p)}
              />
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Showing {visible.length} of {projects.length} projects. Scenarios are grouped
            inside their base project.
          </p>
        </>
      )}

      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false)
            load()
          }}
        />
      )}
      {showImportVault && (
        <VaultDialog
          onUnlocked={() => setImportReady(true)}
          onClose={() => setShowImportVault(false)}
        />
      )}
    </div>
  )
}

function TemplateOption({
  selected,
  onSelect,
  title,
  description,
  detail,
  onDelete,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  description: string
  detail?: string
  onDelete?: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      className={`cursor-pointer rounded-lg border p-3 text-left transition-colors ${
        selected
          ? 'border-indigo-500 bg-indigo-950/40'
          : 'border-slate-700 bg-slate-900 hover:border-slate-500'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-100">{title}</span>
        <span className="flex items-center gap-1.5">
          {detail && <span className="text-[11px] text-slate-500">{detail}</span>}
          {onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
              className="rounded p-0.5 text-slate-600 hover:bg-slate-800 hover:text-rose-400"
              title="Delete this template"
            >
              🗑
            </button>
          )}
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">{description}</p>
    </div>
  )
}

function CreateProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const now = new Date()
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [startYear, setStartYear] = useState(now.getFullYear())
  const [startMonth, setStartMonth] = useState(now.getMonth() + 1)
  const [endYear, setEndYear] = useState(now.getFullYear() + 1)
  const [endMonth, setEndMonth] = useState(now.getMonth() + 1)
  const [templates, setTemplates] = useState<ProjectTemplate[]>([])
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.listTemplates().then(setTemplates).catch(() => setTemplates([]))
  }, [])

  const submit = async () => {
    setSaving(true)
    setError('')
    try {
      await api.createProject({
        name: name || 'Project',
        company: company || 'Company',
        start_year: startYear,
        start_month: startMonth,
        end_year: endYear,
        end_month: endMonth,
        template_id: templateId,
      })
      onCreated()
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title="New Project" onClose={onClose} wide>
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <div>
          <Label>Project name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project" autoFocus />
        </div>
        <div>
          <Label>Company</Label>
          <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Start</Label>
            <div className="flex gap-2">
              <Select value={startMonth} onChange={(e) => setStartMonth(Number(e.target.value))}>
                {MONTH_NAMES.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </Select>
              <Input
                type="number"
                value={startYear}
                onChange={(e) => setStartYear(Number(e.target.value))}
                className="w-24"
              />
            </div>
          </div>
          <div>
            <Label>End</Label>
            <div className="flex gap-2">
              <Select value={endMonth} onChange={(e) => setEndMonth(Number(e.target.value))}>
                {MONTH_NAMES.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </Select>
              <Input
                type="number"
                value={endYear}
                onChange={(e) => setEndYear(Number(e.target.value))}
                className="w-24"
              />
            </div>
          </div>
        </div>
        <div>
          <Label>Template</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            <TemplateOption
              selected={templateId === null}
              onSelect={() => setTemplateId(null)}
              title="Blank Project"
              description="Start from scratch and add features and roles yourself."
            />
            {templates.map((t) => (
              <TemplateOption
                key={t.id}
                selected={templateId === t.id}
                onSelect={() => setTemplateId(t.id)}
                title={t.custom ? `★ ${t.name}` : t.name}
                description={t.description}
                detail={`${t.features.length} features · ${t.features.reduce(
                  (n, f) => n + f.roles.length,
                  0,
                )} roles`}
                onDelete={
                  t.custom
                    ? async () => {
                        if (!window.confirm(`Delete template "${t.name}"?`)) return
                        await api.deleteTemplate(t.id)
                        if (templateId === t.id) setTemplateId(null)
                        setTemplates(await api.listTemplates())
                      }
                    : undefined
                }
              />
            ))}
          </div>
          {templateId && (
            <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
              {templates
                .find((t) => t.id === templateId)!
                .features.map((f) => (
                  <div key={f.name} className="mb-1 last:mb-0">
                    <span className="font-medium text-slate-300">{f.name}:</span>{' '}
                    {f.roles
                      .map((r) => `${r.name} (${r.location} ${r.level}, ${r.ftes} FTE)`)
                      .join(', ')}
                  </div>
                ))}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Creating…' : 'Create Project'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

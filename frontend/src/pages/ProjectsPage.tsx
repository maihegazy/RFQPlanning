import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { ProjectSummary, ProjectTemplate } from '../types'
import { Button, Card, ErrorBanner, EmptyState, Input, Label, Modal, Select, Spinner } from '../components/ui'
import { MONTH_NAMES } from '../utils'
import { downloadBlob } from '../download'
import { useVault } from '../vault/VaultContext'
import { VaultStatusButton } from '../vault/VaultGate'
import { emptyMoneyConfig, type MoneyConfig } from '../money/types'

export default function ProjectsPage() {
  const vault = useVault()
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = () => {
    api
      .listProjects()
      .then(setProjects)
      .catch((e) => setError(e.message))
  }

  useEffect(load, [])

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
      const data = JSON.parse(await file.text())
      // Non-monetary parts are stored by the server; money is encrypted here
      const project = await api.importProject(data)
      const rc = data.rate_config ?? {}
      const hasMoney =
        rc.hourly_rates || rc.cost_rates || rc.ticket_price || rc.hw_cost_per_hour
      if (hasMoney) {
        if (vault.status === 'unlocked') {
          const meta = await api.getMeta()
          const base = emptyMoneyConfig(meta.locations, meta.levels, meta.ticket_sizes)
          const money: MoneyConfig = {
            ...base,
            hourly_rates: { ...base.hourly_rates, ...(rc.hourly_rates ?? {}) },
            cost_rates: Object.fromEntries(
              meta.locations.map((loc) => [
                loc,
                { ...base.cost_rates[loc], ...((rc.cost_rates ?? {})[loc] ?? {}) },
              ]),
            ),
            hw_cost_per_hour: Number(rc.hw_cost_per_hour ?? 0),
            ticket_prices: { ...base.ticket_prices, ...(rc.ticket_price ?? {}) },
          }
          const blob = await vault.encrypt(money)
          await api.putMoneyBlob(project.id, {
            encrypted_money: blob.ciphertext,
            money_iv: blob.iv,
          })
        } else {
          setNotice(
            'Project imported. The file contained money values, but the vault is locked — unlock it and re-import to bring them in encrypted.',
          )
        }
      }
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
        setNotice('Exported without money values (vault locked). Unlock to include them.')
      }
      downloadBlob(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
        `${project.name}.json`,
      )
    } catch (e) {
      setError(`Export failed: ${(e as Error).message}`)
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">RFQ Planner</h1>
          <p className="mt-1 text-sm text-slate-400">
            Resource &amp; budget planning for RFQs
          </p>
        </div>
        <div className="flex items-center gap-2">
          <VaultStatusButton />
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
            Import JSON
          </Button>
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

      {projects === null ? (
        <Spinner />
      ) : projects.length === 0 ? (
        <EmptyState>
          No projects yet. Create a new project or import one from a JSON file.
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((p) => (
            <Card key={p.id} className="hover:border-slate-600">
              <div className="flex items-start justify-between">
                <Link to={`/projects/${p.id}`} className="group flex-1">
                  <h2 className="text-lg font-semibold text-slate-100 group-hover:text-indigo-400">
                    {p.name}
                  </h2>
                  <p className="text-sm text-slate-400">{p.company}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    {MONTH_NAMES[p.start_month - 1]} {p.start_year} –{' '}
                    {MONTH_NAMES[p.end_month - 1]} {p.end_year}
                  </p>
                </Link>
                <div className="flex flex-col gap-1">
                  <Button variant="ghost" onClick={() => handleDelete(p)} title="Delete project">
                    🗑
                  </Button>
                  <Button variant="ghost" onClick={() => handleExport(p)} title="Export as JSON">
                    ⬇
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
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
    </div>
  )
}

function TemplateOption({
  selected,
  onSelect,
  title,
  description,
  detail,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  description: string
  detail?: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`rounded-lg border p-3 text-left transition-colors ${
        selected
          ? 'border-indigo-500 bg-indigo-950/40'
          : 'border-slate-700 bg-slate-900 hover:border-slate-500'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-100">{title}</span>
        {detail && <span className="text-[11px] text-slate-500">{detail}</span>}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">{description}</p>
    </button>
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
                title={t.name}
                description={t.description}
                detail={`${t.features.length} features · ${t.features.reduce(
                  (n, f) => n + f.roles.length,
                  0,
                )} roles`}
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

import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import type { Meta, Project, ProjectSummary } from '../types'
import { Button, ErrorBanner, Input, Label, Modal, Spinner, StatusBadge } from '../components/ui'
import { VaultStatusButton } from '../vault/VaultGate'
import InfoTab from '../tabs/InfoTab'
import ResourcesTab from '../tabs/ResourcesTab'
import BudgetTab from '../tabs/BudgetTab'
import HardwareTab from '../tabs/HardwareTab'
import ReportsTab from '../tabs/ReportsTab'
import CompareTab from '../tabs/CompareTab'

function SaveTemplateModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const [name, setName] = useState(`${project.name} Template`)
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [savedName, setSavedName] = useState('')
  const [saving, setSaving] = useState(false)

  const featureCount = project.features.length
  const roleCount = project.features.reduce((n, f) => n + f.roles.length, 0)

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const template = await api.saveAsTemplate(project.id, name.trim(), description.trim())
      setSavedName(template.name)
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title="Save as Template" onClose={onClose}>
      {savedName ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-800 bg-emerald-950/50 px-4 py-3 text-sm text-emerald-300">
            ✓ Template "{savedName}" saved. It now appears in the New Project dialog.
          </div>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            Snapshots this project's structure — {featureCount} feature
            {featureCount === 1 ? '' : 's'} with {roleCount} role
            {roleCount === 1 ? '' : 's'} — as a reusable template. Roles with variable FTE periods
            are saved with their average FTE. Financial data and the timeline are not part of a
            template.
          </p>
          {error && <ErrorBanner message={error} />}
          <div>
            <Label>Template name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <Label>Description (optional)</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Standard staffing for gateway ECU projects"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !name.trim() || featureCount === 0}>
              {saving ? 'Saving…' : 'Save Template'}
            </Button>
          </div>
          {featureCount === 0 && (
            <p className="text-xs text-amber-400">
              Add at least one feature before saving a template.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

const TABS = [
  { path: 'info', label: 'Project Info' },
  { path: 'resources', label: 'Resources' },
  { path: 'budget', label: 'Budget' },
  { path: 'hardware', label: 'Hardware' },
  { path: 'reports', label: 'Reports' },
  { path: 'compare', label: 'Scenarios' },
]

export default function ProjectPage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const id = Number(projectId)
  const [project, setProject] = useState<Project | null>(null)
  const [family, setFamily] = useState<ProjectSummary[]>([])
  const [meta, setMeta] = useState<Meta | null>(null)
  const [error, setError] = useState('')
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)

  const reload = useCallback(() => {
    api
      .getProject(id)
      .then(setProject)
      .catch((e) => setError(e.message))
    api
      .listScenarios(id)
      .then(setFamily)
      .catch(() => setFamily([]))
  }, [id])

  useEffect(() => {
    reload()
    api
      .getMeta()
      .then(setMeta)
      .catch((e) => setError(e.message))
  }, [reload])

  const newScenario = async () => {
    if (!project) return
    const name = window.prompt(
      'Scenario name:',
      `${project.name} — Scenario ${String.fromCharCode(65 + family.length)}`,
    )
    if (!name) return
    try {
      const clone = await api.cloneProject(project.id, name, true)
      navigate(`/projects/${clone.id}`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <ErrorBanner message={error} />
        <Link to="/" className="mt-4 inline-block text-sm text-indigo-400 hover:underline">
          ← Back to projects
        </Link>
      </div>
    )
  }

  if (!project || !meta) return <Spinner />

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6">
        <Link to="/" className="text-sm text-slate-400 hover:text-indigo-400">
          ← All projects
        </Link>
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
            <StatusBadge status={project.status} />
            {project.is_winning_scenario && (
              <span className="rounded-full bg-amber-950 px-2 py-0.5 text-xs text-amber-300">
                👑 winner
              </span>
            )}
            <span className="text-sm text-slate-400">{project.company}</span>
          </div>
          <div className="flex items-center gap-2">
            {family.length > 1 && (
              <select
                className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
                value={project.id}
                onChange={(e) => navigate(`/projects/${e.target.value}`)}
                title="Switch scenario"
              >
                {family.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.base_project_id === null ? '⌂ ' : ''}
                    {p.is_winning_scenario ? '👑 ' : ''}
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <Button variant="secondary" onClick={newScenario}>
              + New Scenario
            </Button>
            <Button variant="secondary" onClick={() => setShowSaveTemplate(true)}>
              Save as Template
            </Button>
            <VaultStatusButton />
          </div>
        </div>
      </header>

      <nav className="mb-6 flex gap-1 border-b border-slate-800">
        {TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            className={({ isActive }) =>
              `border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      {showSaveTemplate && (
        <SaveTemplateModal project={project} onClose={() => setShowSaveTemplate(false)} />
      )}

      <Routes>
        <Route index element={<Navigate to="info" replace />} />
        <Route path="info" element={<InfoTab project={project} onSaved={reload} />} />
        <Route
          path="resources"
          element={<ResourcesTab project={project} meta={meta} onChanged={reload} />}
        />
        <Route path="budget" element={<BudgetTab project={project} meta={meta} />} />
        <Route path="hardware" element={<HardwareTab project={project} meta={meta} />} />
        <Route path="reports" element={<ReportsTab project={project} meta={meta} />} />
        <Route
          path="compare"
          element={<CompareTab project={project} meta={meta} onChanged={reload} />}
        />
      </Routes>
    </div>
  )
}

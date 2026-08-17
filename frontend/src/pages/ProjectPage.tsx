import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import type { Meta, Project, ProjectSummary } from '../types'
import { Button, ErrorBanner, Spinner, StatusBadge } from '../components/ui'
import { VaultStatusButton } from '../vault/VaultGate'
import InfoTab from '../tabs/InfoTab'
import ResourcesTab from '../tabs/ResourcesTab'
import BudgetTab from '../tabs/BudgetTab'
import ReportsTab from '../tabs/ReportsTab'
import CompareTab from '../tabs/CompareTab'

const TABS = [
  { path: 'info', label: 'Project Info' },
  { path: 'resources', label: 'Resources' },
  { path: 'budget', label: 'Budget' },
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

  const reload = useCallback(() => {
    api.getProject(id).then(setProject).catch((e) => setError(e.message))
    api.listScenarios(id).then(setFamily).catch(() => setFamily([]))
  }, [id])

  useEffect(() => {
    reload()
    api.getMeta().then(setMeta).catch((e) => setError(e.message))
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

      <Routes>
        <Route index element={<Navigate to="info" replace />} />
        <Route path="info" element={<InfoTab project={project} onSaved={reload} />} />
        <Route
          path="resources"
          element={<ResourcesTab project={project} meta={meta} onChanged={reload} />}
        />
        <Route path="budget" element={<BudgetTab project={project} meta={meta} />} />
        <Route path="reports" element={<ReportsTab project={project} meta={meta} />} />
        <Route
          path="compare"
          element={<CompareTab project={project} meta={meta} onChanged={reload} />}
        />
      </Routes>
    </div>
  )
}

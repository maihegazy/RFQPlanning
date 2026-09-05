import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ExternalLink, FolderKanban, Plus, Search } from 'lucide-react'
import { api } from '../api'
import type { HwProjectRollup } from '../types'
import HwProjectsTable from '../components/HwProjectsTable'
import {
  defaultSortDir,
  visibleProjects,
  type HwProjectSortKey,
  type SortDir,
} from '../hardware/projectList'
import NewHwProjectModal from '../components/NewHwProjectModal'
import { Button, Card, EmptyState, ErrorBanner, Input, Spinner, Stat } from '../components/ui'
import { formatEuro } from '../utils'

const ACTION_LINK =
  'inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700'

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'Something went wrong.'
}

/**
 * The hardware purchasing projects, on a page of their own.
 *
 * Separate from the management overview on purpose: this page asks the server
 * for the project list (`GET /api/hw/projects`) and shows exactly what comes
 * back, so once the deployment identifies users the same page shows a project
 * leader only the projects that are theirs, with nothing else to trim.
 */
export default function HwProjectsPage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<HwProjectRollup[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<HwProjectSortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    api
      .listHwProjects()
      .then(setProjects)
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const sortBy = (key: HwProjectSortKey) => {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir(defaultSortDir(key))
  }

  const rows = useMemo(
    () => visibleProjects(projects ?? [], query, sortKey, sortDir),
    [projects, query, sortKey, sortDir],
  )

  /** The totals of the projects this page can see, not of every project. */
  const totals = useMemo(() => {
    const list = projects ?? []
    const sum = (pick: (project: HwProjectRollup) => number) =>
      list.reduce((total, project) => total + pick(project), 0)
    return {
      budget: sum((p) => p.effective_budget),
      committed: sum((p) => p.actual_total),
      remaining: sum((p) => p.remaining),
    }
  }, [projects])

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-indigo-800 bg-indigo-950 text-indigo-300">
            <FolderKanban className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Hardware Projects</h1>
            <p className="text-sm text-slate-400">
              Every purchasing project with its own registers, budget and depreciation
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5">
            <Plus className="h-4 w-4" strokeWidth={2} />
            New Project
          </Button>
          <Link to="/hardware" className={ACTION_LINK}>
            <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
            Overview
          </Link>
        </div>
      </header>

      {error && (
        <div className="mb-6 space-y-3">
          <ErrorBanner message={error} />
          <Button variant="secondary" onClick={load}>
            Try again
          </Button>
        </div>
      )}

      {loading && <Spinner />}

      {projects && !loading && (
        <>
          {projects.length > 0 && (
            <div className="mb-6 grid gap-4 sm:grid-cols-4">
              <Stat label="Projects" value={projects.length} />
              <Stat label="Budget" value={formatEuro(totals.budget)} />
              <Stat label="Committed" value={formatEuro(totals.committed)} />
              <Stat
                label="Remaining"
                value={formatEuro(totals.remaining)}
                tone={totals.remaining < 0 ? 'text-rose-300' : 'text-slate-100'}
              />
            </div>
          )}

          <Card
            title={`Projects (${projects.length})`}
            actions={
              projects.length > 0 ? (
                <div className="w-64">
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                      strokeWidth={1.75}
                    />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search projects"
                      aria-label="Search projects"
                      className="pl-9"
                    />
                  </div>
                </div>
              ) : null
            }
          >
            {projects.length === 0 ? (
              <EmptyState>
                <p>No hardware projects yet.</p>
                <p className="mt-1">
                  A project holds its own asset and license registers, budget and depreciation.
                </p>
                <div className="mt-4 flex justify-center">
                  <Button
                    onClick={() => setCreating(true)}
                    className="inline-flex items-center gap-1.5"
                  >
                    <Plus className="h-4 w-4" strokeWidth={2} />
                    Create the first project
                  </Button>
                </div>
              </EmptyState>
            ) : rows.length === 0 ? (
              <EmptyState>No project matches “{query.trim()}”.</EmptyState>
            ) : (
              <HwProjectsTable
                projects={rows}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={sortBy}
              />
            )}
          </Card>
        </>
      )}

      {creating && (
        <NewHwProjectModal
          onClose={() => setCreating(false)}
          onCreated={(project) => navigate(`/hardware/projects/${project.id}`)}
        />
      )}
    </div>
  )
}

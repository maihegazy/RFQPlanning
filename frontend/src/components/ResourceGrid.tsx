import { useMemo, useState } from 'react'
import { api } from '../api'
import type { Project, Role } from '../types'
import { Button, EmptyState, ErrorBanner } from './ui'
import { MONTH_NAMES, formatMonth, monthRange } from '../utils'

type CellValues = Record<number, Record<string, number>>

function roleFtesForMonth(role: Role, month: string): number {
  if (!role.use_advanced_allocation || role.allocations.length === 0) return role.ftes
  let total = 0
  for (const alloc of role.allocations) {
    if (alloc.start_month <= month && month <= alloc.end_month) total += alloc.ftes
  }
  return total
}

function buildInitialValues(project: Project, months: string[]): CellValues {
  const values: CellValues = {}
  for (const feature of project.features) {
    for (const role of feature.roles) {
      values[role.id] = {}
      for (const month of months) {
        values[role.id][month] = roleFtesForMonth(role, month)
      }
    }
  }
  return values
}

export default function ResourceGrid({
  project,
  onChanged,
}: {
  project: Project
  onChanged: () => void
}) {
  const months = useMemo(
    () =>
      monthRange(
        formatMonth(project.start_year, project.start_month),
        formatMonth(project.end_year, project.end_month),
      ),
    [project],
  )

  const initial = useMemo(() => buildInitialValues(project, months), [project, months])
  const [values, setValues] = useState<CellValues>(() => structuredClone(initial))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // Year header groups: [year, colSpan]
  const yearGroups = useMemo(() => {
    const groups: [string, number][] = []
    for (const m of months) {
      const year = m.slice(0, 4)
      const last = groups[groups.length - 1]
      if (last && last[0] === year) last[1] += 1
      else groups.push([year, 1])
    }
    return groups
  }, [months])

  const dirtyRoles = useMemo(() => {
    const dirty = new Set<number>()
    for (const roleId of Object.keys(values)) {
      const id = Number(roleId)
      for (const month of months) {
        if ((values[id]?.[month] ?? 0) !== (initial[id]?.[month] ?? 0)) {
          dirty.add(id)
          break
        }
      }
    }
    return dirty
  }, [values, initial, months])

  const setCell = (roleId: number, month: string, value: number) => {
    setValues((prev) => ({
      ...prev,
      [roleId]: { ...prev[roleId], [month]: value },
    }))
  }

  const fillRow = (roleId: number, value: number) => {
    setValues((prev) => ({
      ...prev,
      [roleId]: Object.fromEntries(months.map((m) => [m, value])),
    }))
  }

  const rowTotal = (roleId: number) =>
    months.reduce((sum, m) => sum + (values[roleId]?.[m] ?? 0), 0)

  const monthTotal = (month: string) =>
    project.features.reduce(
      (sum, f) => sum + f.roles.reduce((s, r) => s + (values[r.id]?.[month] ?? 0), 0),
      0,
    )

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      await api.updateResourceGrid(
        project.id,
        [...dirtyRoles].map((roleId) => ({
          role_id: roleId,
          ftes_by_month: values[roleId],
        })),
      )
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      // The parent re-fetches the project but keeps this grid mounted, so the
      // button has to come back on its own.
      setSaving(false)
    }
  }

  const reset = () => {
    setValues(structuredClone(initial))
    setError('')
  }

  const hasRoles = project.features.some((f) => f.roles.length > 0)
  if (!hasRoles) {
    return (
      <EmptyState>
        Add features and roles first (switch to List view), then edit their monthly FTEs here.
      </EmptyState>
    )
  }

  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} />}

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Edit FTE values per month like a spreadsheet. Use the ⇥ fill button to apply a row's first
          value to all months. Changed cells are highlighted; saving converts each row into a fixed
          FTE or variable periods automatically.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={reset} disabled={dirtyRoles.size === 0}>
            Discard
          </Button>
          <Button onClick={save} disabled={saving || dirtyRoles.size === 0}>
            {saving
              ? 'Saving…'
              : dirtyRoles.size > 0
                ? `Save ${dirtyRoles.size} Role${dirtyRoles.size === 1 ? '' : 's'}`
                : 'Saved'}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-900">
              <th
                className="sticky left-0 z-10 border-b border-r border-slate-700 bg-slate-900 px-3 py-2 text-left"
                rowSpan={2}
              >
                Feature / Role
              </th>
              {yearGroups.map(([year, span]) => (
                <th
                  key={year}
                  colSpan={span}
                  className="border-b border-l border-slate-700 px-2 py-1.5 text-center font-semibold text-indigo-300"
                >
                  {year}
                </th>
              ))}
              <th rowSpan={2} className="border-b border-l border-slate-700 px-3 py-2 text-right">
                Total
                <div className="font-normal text-slate-500">FTE-months</div>
              </th>
            </tr>
            <tr className="bg-slate-900">
              {months.map((m) => (
                <th
                  key={m}
                  className="border-b border-l border-slate-800 px-1 py-1 text-center font-medium text-slate-400"
                >
                  {MONTH_NAMES[Number(m.slice(5)) - 1].slice(0, 3)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {project.features.map((feature) => (
              <FeatureRows
                key={feature.id}
                featureName={feature.name}
                roles={feature.roles}
                months={months}
                values={values}
                initial={initial}
                dirtyRoles={dirtyRoles}
                setCell={setCell}
                fillRow={fillRow}
                rowTotal={rowTotal}
              />
            ))}
            <tr className="bg-slate-800/80 font-semibold">
              <td className="sticky left-0 z-10 border-r border-t border-slate-700 bg-slate-800 px-3 py-2">
                TOTAL FTEs
              </td>
              {months.map((m) => (
                <td key={m} className="border-l border-t border-slate-700 px-1 py-2 text-center">
                  {monthTotal(m).toFixed(1)}
                </td>
              ))}
              <td className="border-l border-t border-slate-700 px-3 py-2 text-right">
                {months.reduce((s, m) => s + monthTotal(m), 0).toFixed(1)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FeatureRows({
  featureName,
  roles,
  months,
  values,
  initial,
  dirtyRoles,
  setCell,
  fillRow,
  rowTotal,
}: {
  featureName: string
  roles: Role[]
  months: string[]
  values: CellValues
  initial: CellValues
  dirtyRoles: Set<number>
  setCell: (roleId: number, month: string, value: number) => void
  fillRow: (roleId: number, value: number) => void
  rowTotal: (roleId: number) => number
}) {
  if (roles.length === 0) return null
  return (
    <>
      <tr className="bg-slate-900/80">
        <td
          colSpan={months.length + 2}
          className="border-t border-slate-700 px-3 py-1.5 font-semibold text-indigo-300"
        >
          {featureName}
        </td>
      </tr>
      {roles.map((role) => (
        <tr key={role.id} className="group">
          <td className="sticky left-0 z-10 whitespace-nowrap border-r border-t border-slate-800 bg-slate-950 px-3 py-1 group-hover:bg-slate-900">
            <div className="flex items-center gap-2">
              <button
                title="Fill all months with the first month's value"
                className="rounded px-1 text-slate-600 hover:bg-slate-800 hover:text-slate-300"
                onClick={() => fillRow(role.id, values[role.id]?.[months[0]] ?? 0)}
              >
                ⇥
              </button>
              <span>
                <span className="font-medium text-slate-200">{role.name}</span>
                <span className="ml-2 text-slate-500">
                  {role.location} · {role.level}
                </span>
                {dirtyRoles.has(role.id) && (
                  <span className="ml-2 text-amber-400" title="Unsaved changes">
                    ●
                  </span>
                )}
              </span>
            </div>
          </td>
          {months.map((m) => {
            const value = values[role.id]?.[m] ?? 0
            const changed = value !== (initial[role.id]?.[m] ?? 0)
            return (
              <td key={m} className="border-l border-t border-slate-800 p-0">
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={value}
                  onChange={(e) => setCell(role.id, m, Math.max(0, Number(e.target.value)))}
                  onFocus={(e) => e.target.select()}
                  className={`w-14 border-0 bg-transparent px-1 py-1.5 text-center outline-none [appearance:textfield] focus:bg-indigo-950/60 focus:ring-1 focus:ring-inset focus:ring-indigo-500 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
                    changed
                      ? 'bg-amber-950/50 text-amber-200'
                      : value === 0
                        ? 'text-slate-600'
                        : 'text-slate-200'
                  }`}
                />
              </td>
            )
          })}
          <td className="border-l border-t border-slate-800 px-3 py-1.5 text-right font-medium">
            {rowTotal(role.id).toFixed(1)}
          </td>
        </tr>
      ))}
    </>
  )
}

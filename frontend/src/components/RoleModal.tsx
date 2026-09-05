import { useMemo, useState } from 'react'
import { api } from '../api'
import type { AllocationPeriod, Feature, Meta, Project, Role } from '../types'
import { Button, ErrorBanner, Input, Label, Modal, Select } from '../components/ui'
import { formatMonth, monthRange, nextMonth } from '../utils'

export default function RoleModal({
  project,
  meta,
  feature,
  role,
  onClose,
  onSaved,
}: {
  project: Project
  meta: Meta
  feature: Feature
  role: Role | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(role?.name ?? '')
  const [location, setLocation] = useState(role?.location ?? meta.locations[0])
  const [level, setLevel] = useState(role?.level ?? meta.levels[0])
  const [ftes, setFtes] = useState(role?.ftes ?? 1.0)
  const [useAdvanced, setUseAdvanced] = useState(role?.use_advanced_allocation ?? false)
  const [allocations, setAllocations] = useState<AllocationPeriod[]>(
    role?.allocations.map((a) => ({ ...a })) ?? [],
  )
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const projectStart = formatMonth(project.start_year, project.start_month)
  const projectEnd = formatMonth(project.end_year, project.end_month)
  const projectMonths = useMemo(
    () => monthRange(projectStart, projectEnd),
    [projectStart, projectEnd],
  )

  const totalFteMonths = useMemo(() => {
    if (!useAdvanced) return ftes * projectMonths.length
    let total = 0
    for (const month of projectMonths) {
      for (const alloc of allocations) {
        if (alloc.start_month <= month && month <= alloc.end_month) total += alloc.ftes
      }
    }
    return total
  }, [useAdvanced, ftes, allocations, projectMonths])

  const addPeriod = () => {
    const last = allocations[allocations.length - 1]
    if (last && last.end_month >= projectEnd) return
    setAllocations([
      ...allocations,
      {
        start_month: last ? nextMonth(last.end_month) : projectStart,
        end_month: projectEnd,
        ftes: 0.5,
      },
    ])
  }

  const updatePeriod = (index: number, patch: Partial<AllocationPeriod>) => {
    setAllocations(allocations.map((a, i) => (i === index ? { ...a, ...patch } : a)))
  }

  const removePeriod = (index: number) => {
    setAllocations(allocations.filter((_, i) => i !== index))
  }

  const clientValidate = (): string | null => {
    if (!name.trim()) return 'Role name is required'
    if (!useAdvanced) {
      if (ftes < 0) return 'FTEs cannot be negative'
      if (ftes > 2.0)
        return 'FTEs cannot exceed 2.0 for fixed allocation (use variable periods for higher values)'
    } else {
      if (allocations.length === 0) return 'Variable allocation requires at least one period'
      for (const [i, a] of allocations.entries()) {
        if (a.ftes < 0) return `Period ${i + 1}: FTEs cannot be negative`
        if (a.start_month > a.end_month)
          return `Period ${i + 1}: start month must be before or equal to end month`
      }
      const sorted = [...allocations].sort((a, b) => a.start_month.localeCompare(b.start_month))
      for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i].end_month >= sorted[i + 1].start_month)
          return `Overlapping periods: ${sorted[i].end_month} and ${sorted[i + 1].start_month}`
      }
    }
    return null
  }

  const save = async () => {
    const clientError = clientValidate()
    if (clientError) {
      setError(clientError)
      return
    }
    setSaving(true)
    setError('')
    const payload = {
      name: name.trim(),
      location,
      level,
      ftes,
      use_advanced_allocation: useAdvanced,
      allocations: useAdvanced
        ? allocations.map(({ start_month, end_month, ftes }) => ({ start_month, end_month, ftes }))
        : [],
    }
    try {
      if (role) await api.updateRole(role.id, payload)
      else await api.createRole(feature.id, payload)
      onSaved()
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal
      title={role ? `Edit Role — ${feature.name}` : `Add Role — ${feature.name}`}
      onClose={onClose}
      wide
    >
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label>Role name</Label>
            <Input
              aria-label="Role name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <Label>Location</Label>
            <Select
              aria-label="Location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            >
              {meta.locations.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Level</Label>
            <Select aria-label="Level" value={level} onChange={(e) => setLevel(e.target.value)}>
              {meta.levels.map((lvl) => (
                <option key={lvl} value={lvl}>
                  {lvl}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 p-4">
          <div className="mb-3 flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={!useAdvanced}
                onChange={() => setUseAdvanced(false)}
                className="accent-indigo-500"
              />
              Fixed FTE
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={useAdvanced}
                onChange={() => setUseAdvanced(true)}
                className="accent-indigo-500"
              />
              Variable FTE periods
            </label>
          </div>

          {!useAdvanced ? (
            <div className="max-w-40">
              <Label>FTE (0 – 2.0)</Label>
              <Input
                type="number"
                aria-label="Fixed FTE"
                min={0}
                max={2}
                step={0.1}
                value={ftes}
                onChange={(e) => setFtes(Number(e.target.value))}
              />
            </div>
          ) : (
            <div className="space-y-2">
              {allocations.length === 0 && (
                <p className="text-sm text-slate-500">
                  Define periods with different FTE levels (e.g. ramp-up 0.2 → 0.8 → 0.5).
                </p>
              )}
              {allocations.map((alloc, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <div>
                    <Label>Start (YYYY-MM)</Label>
                    <Input
                      aria-label={`Period ${i + 1} start month`}
                      type="month"
                      value={alloc.start_month}
                      min={projectStart}
                      max={projectEnd}
                      onChange={(e) => updatePeriod(i, { start_month: e.target.value })}
                      className="w-40"
                    />
                  </div>
                  <div>
                    <Label>End (YYYY-MM)</Label>
                    <Input
                      aria-label={`Period ${i + 1} end month`}
                      type="month"
                      value={alloc.end_month}
                      min={projectStart}
                      max={projectEnd}
                      onChange={(e) => updatePeriod(i, { end_month: e.target.value })}
                      className="w-40"
                    />
                  </div>
                  <div>
                    <Label>FTE</Label>
                    <Input
                      type="number"
                      aria-label={`Period ${i + 1} FTE`}
                      min={0}
                      step={0.1}
                      value={alloc.ftes}
                      onChange={(e) => updatePeriod(i, { ftes: Number(e.target.value) })}
                      className="w-24"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => removePeriod(i)}
                    aria-label={`Remove period ${i + 1}`}
                    title="Remove period"
                  >
                    ✕
                  </Button>
                </div>
              ))}
              <Button
                variant="secondary"
                onClick={addPeriod}
                disabled={allocations[allocations.length - 1]?.end_month >= projectEnd}
              >
                + Add Period
              </Button>
            </div>
          )}

          <p className="mt-3 text-xs text-slate-500">
            Total over project:{' '}
            <span className="text-slate-300">{totalFteMonths.toFixed(1)} FTE-months</span> (
            {(totalFteMonths * meta.hours_per_fte_per_month).toLocaleString()} man-hours)
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : role ? 'Save Role' : 'Add Role'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

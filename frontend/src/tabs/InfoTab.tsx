import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Project, ValidationResult } from '../types'
import { Button, Card, ErrorBanner, Input, Label, Select } from '../components/ui'
import { MONTH_NAMES } from '../utils'

export default function InfoTab({ project, onSaved }: { project: Project; onSaved: () => void }) {
  const [name, setName] = useState(project.name)
  const [company, setCompany] = useState(project.company)
  const [startYear, setStartYear] = useState(project.start_year)
  const [startMonth, setStartMonth] = useState(project.start_month)
  const [endYear, setEndYear] = useState(project.end_year)
  const [endMonth, setEndMonth] = useState(project.end_month)
  const [status, setStatus] = useState<string>(project.status)
  const [winProb, setWinProb] = useState(project.win_probability_pct)
  const [lostReason, setLostReason] = useState(project.lost_reason ?? '')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [validation, setValidation] = useState<ValidationResult | null>(null)

  useEffect(() => {
    setName(project.name)
    setCompany(project.company)
    setStartYear(project.start_year)
    setStartMonth(project.start_month)
    setEndYear(project.end_year)
    setEndMonth(project.end_month)
    setStatus(project.status)
    setWinProb(project.win_probability_pct)
    setLostReason(project.lost_reason ?? '')
    setError('')
    setValidation(null)
  }, [project])

  // A save triggers a reload of the same project, which must not wipe its own
  // "Saved" flash; only another project (a scenario switch) or an edit does.
  useEffect(() => {
    setSaved(false)
  }, [project.id])

  const edit =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value)
      setSaved(false)
    }

  const save = async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await api.updateProject(project.id, {
        name,
        company,
        start_year: startYear,
        start_month: startMonth,
        end_year: endYear,
        end_month: endMonth,
        status: status as Project['status'],
        win_probability_pct: winProb,
        lost_reason: status === 'lost' ? lostReason : null,
      })
      setSaved(true)
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const validate = async () => {
    try {
      setValidation(await api.validateProject(project.id))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Project Details">
        <div className="space-y-4">
          {error && <ErrorBanner message={error} />}
          <div>
            <Label>Project name</Label>
            <Input
              aria-label="Project name"
              value={name}
              onChange={(e) => edit(setName)(e.target.value)}
            />
          </div>
          <div>
            <Label>Company</Label>
            <Input
              aria-label="Company"
              value={company}
              onChange={(e) => edit(setCompany)(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Start</Label>
              <div className="flex gap-2">
                <Select
                  aria-label="Start month"
                  value={startMonth}
                  onChange={(e) => edit(setStartMonth)(Number(e.target.value))}
                >
                  {MONTH_NAMES.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </Select>
                <Input
                  type="number"
                  aria-label="Start year"
                  className="w-24"
                  value={startYear}
                  onChange={(e) => edit(setStartYear)(Number(e.target.value))}
                />
              </div>
            </div>
            <div>
              <Label>End</Label>
              <div className="flex gap-2">
                <Select
                  aria-label="End month"
                  value={endMonth}
                  onChange={(e) => edit(setEndMonth)(Number(e.target.value))}
                >
                  {MONTH_NAMES.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </Select>
                <Input
                  type="number"
                  aria-label="End year"
                  className="w-24"
                  value={endYear}
                  onChange={(e) => edit(setEndYear)(Number(e.target.value))}
                />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 border-t border-slate-800 pt-4">
            <div>
              <Label>RFQ Status</Label>
              <Select
                aria-label="RFQ status"
                value={status}
                onChange={(e) => edit(setStatus)(e.target.value)}
              >
                {['draft', 'quoted', 'won', 'lost'].map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </Select>
            </div>
            {(status === 'draft' || status === 'quoted') && (
              <div>
                <Label>Win probability (%)</Label>
                <Input
                  type="number"
                  aria-label="Win probability (%)"
                  min={0}
                  max={100}
                  step={5}
                  value={winProb}
                  onChange={(e) => edit(setWinProb)(Number(e.target.value))}
                />
              </div>
            )}
            {status === 'lost' && (
              <div className="col-span-2">
                <Label>Lost reason</Label>
                <Input
                  aria-label="Lost reason"
                  value={lostReason}
                  onChange={(e) => edit(setLostReason)(e.target.value)}
                  placeholder="e.g. Competitor undercut on price"
                />
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 pt-2">
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
            {saved && <span className="text-sm text-emerald-400">Saved ✓</span>}
          </div>
        </div>
      </Card>

      <Card
        title="Project Validation"
        actions={
          <Button variant="secondary" onClick={validate}>
            Run Validation
          </Button>
        }
      >
        {validation === null ? (
          <p className="text-sm text-slate-500">
            Run validation to check the project is complete and consistent before generating
            reports.
          </p>
        ) : validation.valid ? (
          <div className="rounded-lg border border-emerald-800 bg-emerald-950/50 px-4 py-3 text-sm text-emerald-300">
            ✓ Project is valid — all checks passed.
          </div>
        ) : (
          <ul className="space-y-2">
            {validation.errors.map((err, i) => (
              <li
                key={i}
                className="rounded-lg border border-amber-800 bg-amber-950/40 px-4 py-2 text-sm text-amber-300"
              >
                {err}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

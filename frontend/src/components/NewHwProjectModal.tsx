import { useState, type FormEvent } from 'react'
import { api } from '../api'
import type { HwProject } from '../types'
import { budgetPayload, EMPTY_BUDGET, type BudgetDraft } from '../hardware/budget'
import { EMPTY_WINDOW, windowPayload, type PlanningWindowDraft } from '../hardware/planningWindow'
import HwBudgetFields from './HwBudgetFields'
import PlanningWindowFields from './PlanningWindowFields'
import { Button, ErrorBanner, Input, Label, Modal } from './ui'

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'Something went wrong.'
}

/** Creates a hardware purchasing project: its own registers, budget and horizon. */
export default function NewHwProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (project: HwProject) => void
}) {
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [description, setDescription] = useState('')
  const [budget, setBudget] = useState<BudgetDraft>(EMPTY_BUDGET)
  const [window, setWindow] = useState<PlanningWindowDraft>(EMPTY_WINDOW)
  const [portalReference, setPortalReference] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving || !name.trim()) return
    setSaving(true)
    setError('')
    try {
      const created = await api.createHwProject({
        name: name.trim(),
        company: company.trim(),
        description: description.trim(),
        ...budgetPayload(budget),
        ...windowPayload(window),
        portal_reference: portalReference.trim(),
      })
      // No setSaving(false): the caller navigates away and unmounts this form.
      onCreated(created)
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <Modal title="New hardware project" onClose={onClose} size="lg">
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBanner message={error} />}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Name</Label>
            <Input
              aria-label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Platform HW 2026"
              autoFocus
              required
            />
          </div>
          <div>
            <Label>Company</Label>
            <Input
              aria-label="Company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Owning entity"
            />
          </div>
        </div>

        <div>
          <Label>Description</Label>
          <textarea
            aria-label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            placeholder="What this purchasing project covers"
          />
        </div>

        <HwBudgetFields draft={budget} onChange={setBudget} />

        <PlanningWindowFields draft={window} onChange={setWindow} />

        <div className="sm:max-w-xs">
          <Label>Portal reference</Label>
          <Input
            aria-label="Portal reference"
            value={portalReference}
            onChange={(e) => setPortalReference(e.target.value)}
            placeholder="Optional"
          />
        </div>

        <p className="text-xs text-slate-500">
          The budget and the portal reference can be changed later on the project page.
        </p>

        <div className="flex justify-end gap-2 border-t border-slate-800 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !name.trim()}>
            {saving ? 'Creating…' : 'Create project'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

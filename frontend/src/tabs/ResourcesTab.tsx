import { useState } from 'react'
import { api } from '../api'
import type { Feature, Meta, Project, Role } from '../types'
import { Button, Card, EmptyState, ErrorBanner, Input, Modal } from '../components/ui'
import RoleModal from '../components/RoleModal'
import ResourceGrid from '../components/ResourceGrid'

export default function ResourcesTab({
  project,
  meta,
  onChanged,
}: {
  project: Project
  meta: Meta
  onChanged: () => void
}) {
  const [error, setError] = useState('')
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [showAddFeature, setShowAddFeature] = useState(false)
  const [editingFeature, setEditingFeature] = useState<Feature | null>(null)
  const [roleModal, setRoleModal] = useState<{ feature: Feature; role: Role | null } | null>(null)

  const run = async (fn: () => Promise<unknown>) => {
    setError('')
    try {
      await fn()
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const deleteFeature = (feature: Feature) => {
    if (!window.confirm(`Delete feature "${feature.name}" and all its roles?`)) return
    run(() => api.deleteFeature(feature.id))
  }

  const deleteRole = (role: Role) => {
    if (!window.confirm(`Delete role "${role.name}"?`)) return
    run(() => api.deleteRole(role.id))
  }

  return (
    <div className="space-y-6">
      {error && <ErrorBanner message={error} />}

      <div className="flex items-center justify-between">
        <div className="flex rounded-lg border border-slate-700 p-0.5">
          {(
            [
              ['list', 'List View'],
              ['grid', 'Planning Grid'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${
                view === key ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <Button onClick={() => setShowAddFeature(true)}>+ Add Feature</Button>
      </div>

      {view === 'grid' ? (
        <ResourceGrid key={project.updated_at} project={project} onChanged={onChanged} />
      ) : project.features.length === 0 ? (
        <EmptyState>
          No features yet. Add a feature, then add roles with their FTE allocations.
        </EmptyState>
      ) : (
        project.features.map((feature) => (
          <Card
            key={feature.id}
            title={
              <span className="text-base">
                {feature.name}{' '}
                <span className="ml-2 text-xs font-normal text-slate-500">
                  {feature.roles.length} role{feature.roles.length === 1 ? '' : 's'}
                </span>
              </span>
            }
            actions={
              <>
                <Button variant="secondary" onClick={() => setRoleModal({ feature, role: null })}>
                  + Add Role
                </Button>
                <Button variant="ghost" onClick={() => setEditingFeature(feature)}>
                  Rename
                </Button>
                <Button variant="ghost" onClick={() => deleteFeature(feature)}>
                  🗑
                </Button>
              </>
            }
          >
            {feature.roles.length === 0 ? (
              <p className="text-sm text-slate-500">No roles in this feature yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="pb-2 pr-4">Role</th>
                      <th className="pb-2 pr-4">Location</th>
                      <th className="pb-2 pr-4">Level</th>
                      <th className="pb-2 pr-4">Allocation</th>
                      <th className="pb-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feature.roles.map((role) => (
                      <tr key={role.id} className="border-b border-slate-800/60 last:border-0">
                        <td className="py-2.5 pr-4 font-medium text-slate-200">{role.name}</td>
                        <td className="py-2.5 pr-4">{role.location}</td>
                        <td className="py-2.5 pr-4">{role.level}</td>
                        <td className="py-2.5 pr-4">
                          {role.use_advanced_allocation ? (
                            <span className="rounded-full bg-indigo-950 px-2.5 py-0.5 text-xs text-indigo-300">
                              Variable · {role.allocations.length} period
                              {role.allocations.length === 1 ? '' : 's'}
                            </span>
                          ) : (
                            <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs text-slate-300">
                              Fixed · {role.ftes} FTE
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 text-right">
                          <Button variant="ghost" onClick={() => setRoleModal({ feature, role })}>
                            Edit
                          </Button>
                          <Button variant="ghost" onClick={() => deleteRole(role)}>
                            🗑
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ))
      )}

      {showAddFeature && (
        <FeatureNameModal
          title="Add Feature"
          initial=""
          onClose={() => setShowAddFeature(false)}
          onSubmit={async (name) => {
            await run(() => api.createFeature(project.id, name))
            setShowAddFeature(false)
          }}
        />
      )}

      {editingFeature && (
        <FeatureNameModal
          title="Rename Feature"
          initial={editingFeature.name}
          onClose={() => setEditingFeature(null)}
          onSubmit={async (name) => {
            await run(() => api.updateFeature(editingFeature.id, name))
            setEditingFeature(null)
          }}
        />
      )}

      {roleModal && (
        <RoleModal
          project={project}
          meta={meta}
          feature={roleModal.feature}
          role={roleModal.role}
          onClose={() => setRoleModal(null)}
          onSaved={() => {
            setRoleModal(null)
            onChanged()
          }}
        />
      )}
    </div>
  )
}

function FeatureNameModal({
  title,
  initial,
  onClose,
  onSubmit,
}: {
  title: string
  initial: string
  onClose: () => void
  onSubmit: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(initial)

  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) onSubmit(name.trim())
        }}
        className="space-y-4"
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Feature name"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim()}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  )
}

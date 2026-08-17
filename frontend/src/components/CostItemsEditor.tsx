import type { Project } from '../types'
import { Button, Input, Label, Select } from './ui'
import { formatMonth } from '../utils'
import { COST_CATEGORIES, type CostItem } from '../money/types'

export default function CostItemsEditor({
  project,
  items,
  onChange,
}: {
  project: Project
  items: CostItem[]
  onChange: (items: CostItem[]) => void
}) {
  const projectStart = formatMonth(project.start_year, project.start_month)
  const projectEnd = formatMonth(project.end_year, project.end_month)

  const add = () => {
    onChange([
      ...items,
      {
        name: '',
        category: 'license',
        amount: 0,
        is_recurring: false,
        start_month: projectStart,
        end_month: null,
        pass_through: false,
      },
    ])
  }

  const update = (index: number, patch: Partial<CostItem>) => {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  const remove = (index: number) => {
    onChange(items.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-3">
      {items.length === 0 && (
        <p className="text-sm text-slate-500">
          Non-labor costs — tool licenses, test benches, travel — added to project cost.
          Mark an item "billed" to also charge it to the customer.
        </p>
      )}
      {items.map((item, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-800 p-3">
          <div className="min-w-40 flex-1">
            <Label>Name</Label>
            <Input
              value={item.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="e.g. AUTOSAR license"
            />
          </div>
          <div>
            <Label>Category</Label>
            <Select
              value={item.category}
              onChange={(e) => update(i, { category: e.target.value as CostItem['category'] })}
              className="w-28"
            >
              {COST_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>{item.is_recurring ? '€ / month' : 'Amount (€)'}</Label>
            <Input
              type="number"
              min={0}
              step={100}
              className="w-28"
              value={item.amount}
              onChange={(e) => update(i, { amount: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label>Type</Label>
            <Select
              value={item.is_recurring ? 'recurring' : 'one-time'}
              onChange={(e) =>
                update(i, {
                  is_recurring: e.target.value === 'recurring',
                  end_month: e.target.value === 'recurring' ? projectEnd : null,
                })
              }
              className="w-28"
            >
              <option value="one-time">One-time</option>
              <option value="recurring">Monthly</option>
            </Select>
          </div>
          <div>
            <Label>{item.is_recurring ? 'From' : 'Month'}</Label>
            <Input
              type="month"
              className="w-38"
              min={projectStart}
              max={projectEnd}
              value={item.start_month}
              onChange={(e) => update(i, { start_month: e.target.value })}
            />
          </div>
          {item.is_recurring && (
            <div>
              <Label>To</Label>
              <Input
                type="month"
                className="w-38"
                min={projectStart}
                max={projectEnd}
                value={item.end_month ?? projectEnd}
                onChange={(e) => update(i, { end_month: e.target.value })}
              />
            </div>
          )}
          <label className="flex items-center gap-1.5 pb-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={item.pass_through}
              onChange={(e) => update(i, { pass_through: e.target.checked })}
              className="accent-indigo-500"
            />
            billed to customer
          </label>
          <Button variant="ghost" onClick={() => remove(i)}>✕</Button>
        </div>
      ))}
      <Button variant="secondary" onClick={add}>+ Add Cost Item</Button>
    </div>
  )
}

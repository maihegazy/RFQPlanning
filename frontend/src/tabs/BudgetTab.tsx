import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Meta, Project, RateConfig } from '../types'
import { Button, Card, ErrorBanner, Input, Label, Spinner } from '../components/ui'
import { projectYears } from '../utils'

export default function BudgetTab({ project, meta }: { project: Project; meta: Meta }) {
  const [rates, setRates] = useState<RateConfig | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.getRates(project.id).then(setRates).catch((e) => setError(e.message))
  }, [project.id])

  if (error && !rates) return <ErrorBanner message={error} />
  if (!rates) return <Spinner />

  const years = projectYears(project.start_year, project.end_year)

  const setNum = (updater: (r: RateConfig) => void) => {
    const next = structuredClone(rates)
    updater(next)
    setRates(next)
    setSaved(false)
  }

  const quotaFor = (year: number, size: string): number =>
    rates.ticket_quotas[String(year)]?.[size] ?? 0

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      // Only send quotas for years inside the project timeline
      const quotas: Record<string, Record<string, number>> = {}
      for (const year of years) {
        quotas[String(year)] = {}
        for (const size of meta.ticket_sizes) {
          quotas[String(year)][size] = quotaFor(year, size)
        }
      }
      const updated = await api.updateRates(project.id, { ...rates, ticket_quotas: quotas })
      setRates(updated)
      setSaved(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {error && <ErrorBanner message={error} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Hourly Sell Rates (€ / hour, per location)">
          <div className="grid grid-cols-3 gap-4">
            {meta.locations.map((loc) => (
              <div key={loc}>
                <Label>{loc}</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={rates.hourly_rates[loc] ?? 0}
                  onChange={(e) =>
                    setNum((r) => {
                      r.hourly_rates[loc] = Number(e.target.value)
                    })
                  }
                />
              </div>
            ))}
          </div>
        </Card>

        <Card title="Conversion Factors">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>SP → Hours</Label>
              <Input
                type="number"
                min={0}
                step={0.5}
                value={rates.sp_to_hours}
                onChange={(e) => setNum((r) => { r.sp_to_hours = Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>HW Cost / Hour (€)</Label>
              <Input
                type="number"
                min={0}
                step={0.5}
                value={rates.hw_cost_per_hour}
                onChange={(e) => setNum((r) => { r.hw_cost_per_hour = Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Risk Factor (%)</Label>
              <Input
                type="number"
                min={0}
                step={0.5}
                value={rates.risk_factor_pct}
                onChange={(e) => setNum((r) => { r.risk_factor_pct = Number(e.target.value) })}
              />
            </div>
          </div>
        </Card>
      </div>

      <Card title="Hourly Cost Rates (€ / hour, per location and level)">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="pb-2 pr-4">Location</th>
                {meta.levels.map((lvl) => (
                  <th key={lvl} className="pb-2 pr-3">{lvl}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {meta.locations.map((loc) => (
                <tr key={loc} className="border-t border-slate-800/60">
                  <td className="py-2 pr-4 font-medium">{loc}</td>
                  {meta.levels.map((lvl) => (
                    <td key={lvl} className="py-2 pr-3">
                      <Input
                        type="number"
                        min={0}
                        step={0.5}
                        className="w-24"
                        value={rates.cost_rates[loc]?.[lvl] ?? 0}
                        onChange={(e) =>
                          setNum((r) => {
                            r.cost_rates[loc] = r.cost_rates[loc] ?? {}
                            r.cost_rates[loc][lvl] = Number(e.target.value)
                          })
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Ticket Configuration">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="pb-2 pr-4">Size</th>
                <th className="pb-2 pr-4">Story Points</th>
                <th className="pb-2 pr-4">Price (€)</th>
                {years.map((y) => (
                  <th key={y} className="pb-2 pr-4">Quota {y} (%)</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {meta.ticket_sizes.map((size) => (
                <tr key={size} className="border-t border-slate-800/60">
                  <td className="py-2 pr-4 font-medium capitalize">{size}</td>
                  <td className="py-2 pr-4">
                    <Input
                      type="number"
                      min={0}
                      step={0.5}
                      className="w-24"
                      value={rates.ticket_story_points[size] ?? 0}
                      onChange={(e) =>
                        setNum((r) => { r.ticket_story_points[size] = Number(e.target.value) })
                      }
                    />
                  </td>
                  <td className="py-2 pr-4">
                    <Input
                      type="number"
                      min={0}
                      step={0.5}
                      className="w-24"
                      value={rates.ticket_prices[size] ?? 0}
                      onChange={(e) =>
                        setNum((r) => { r.ticket_prices[size] = Number(e.target.value) })
                      }
                    />
                  </td>
                  {years.map((y) => (
                    <td key={y} className="py-2 pr-4">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        className="w-24"
                        value={quotaFor(y, size)}
                        onChange={(e) =>
                          setNum((r) => {
                            const key = String(y)
                            r.ticket_quotas[key] = r.ticket_quotas[key] ?? {}
                            r.ticket_quotas[key][size] = Number(e.target.value)
                          })
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Quota = percentage of the year's total man-hours expected to be delivered as
          tickets of this size.
        </p>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save Budget Configuration'}
        </Button>
        {saved && <span className="text-sm text-emerald-400">Saved ✓</span>}
      </div>
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { Meta, Project, RateConfig } from '../types'
import { Button, Card, ErrorBanner, Input, Label, Spinner } from '../components/ui'
import { projectYears } from '../utils'
import { useVault } from '../vault/VaultContext'
import { VaultPrompt } from '../vault/VaultGate'
import { emptyMoneyConfig, normalizeMoneyConfig, type MoneyConfig } from '../money/types'
import CostItemsEditor from '../components/CostItemsEditor'

export default function BudgetTab({ project, meta }: { project: Project; meta: Meta }) {
  const vault = useVault()
  const [rates, setRates] = useState<RateConfig | null>(null)
  const [money, setMoney] = useState<MoneyConfig | null>(null)
  const [legacyBanner, setLegacyBanner] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.getRates(project.id).then(setRates).catch((e) => setError(e.message))
  }, [project.id])

  const loadMoney = useCallback(async () => {
    if (vault.status !== 'unlocked') return
    try {
      const blob = await api.getMoneyBlob(project.id)
      if (blob.encrypted_money && blob.money_iv) {
        setMoney(
          normalizeMoneyConfig(
            await vault.decrypt<MoneyConfig>({
              iv: blob.money_iv,
              ciphertext: blob.encrypted_money,
            }),
          ),
        )
      } else {
        // No blob yet — check for pre-encryption plaintext to migrate
        const legacy = await api.getLegacyMoney(project.id)
        const base = emptyMoneyConfig(meta.locations, meta.levels, meta.ticket_sizes)
        if (legacy.has_data) {
          setMoney({
            ...base,
            hourly_rates: { ...base.hourly_rates, ...legacy.hourly_rates },
            cost_rates: Object.fromEntries(
              meta.locations.map((loc) => [
                loc,
                { ...base.cost_rates[loc], ...(legacy.cost_rates[loc] ?? {}) },
              ]),
            ),
            hw_cost_per_hour: legacy.hw_cost_per_hour,
            ticket_prices: { ...base.ticket_prices, ...legacy.ticket_prices },
          })
          setLegacyBanner(true)
        } else {
          setMoney(base)
        }
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }, [project.id, vault, meta])

  useEffect(() => {
    setMoney(null)
    setLegacyBanner(false)
    loadMoney()
  }, [loadMoney])

  if (error && !rates) return <ErrorBanner message={error} />
  if (!rates) return <Spinner />

  const years = projectYears(project.start_year, project.end_year)

  const editRates = (updater: (r: RateConfig) => void) => {
    const next = structuredClone(rates)
    updater(next)
    setRates(next)
    setSaved(false)
  }

  const editMoney = (updater: (m: MoneyConfig) => void) => {
    if (!money) return
    const next = structuredClone(money)
    updater(next)
    setMoney(next)
    setSaved(false)
  }

  const quotaFor = (year: number, size: string): number =>
    rates.ticket_quotas[String(year)]?.[size] ?? 0

  const quotaTotal = (year: number): number =>
    meta.ticket_sizes.reduce((s, size) => s + quotaFor(year, size), 0)

  const quotaErrors = years
    .filter((y) => quotaTotal(y) > 100)
    .map((y) => `Ticket quotas for ${y} sum to ${quotaTotal(y)}% — max is 100% per year`)

  const save = async () => {
    if (quotaErrors.length > 0) {
      setError(quotaErrors.join('. '))
      return
    }
    setSaving(true)
    setError('')
    try {
      const quotas: Record<string, Record<string, number>> = {}
      for (const year of years) {
        quotas[String(year)] = {}
        for (const size of meta.ticket_sizes) {
          quotas[String(year)][size] = quotaFor(year, size)
        }
      }
      const updated = await api.updateRates(project.id, { ...rates, ticket_quotas: quotas })
      setRates(updated)

      if (money && vault.status === 'unlocked') {
        const blob = await vault.encrypt(money)
        await api.putMoneyBlob(project.id, {
          encrypted_money: blob.ciphertext,
          money_iv: blob.iv,
        })
        if (legacyBanner) {
          await api.purgeLegacyMoney(project.id)
          setLegacyBanner(false)
        }
      }
      setSaved(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const moneyLocked = vault.status !== 'unlocked'

  return (
    <div className="space-y-6">
      {error && <ErrorBanner message={error} />}

      {legacyBanner && (
        <div className="rounded-lg border border-indigo-800 bg-indigo-950/50 px-4 py-3 text-sm text-indigo-200">
          Unencrypted money values from an earlier version were found for this project.
          They are loaded below — click <strong>Save</strong> to encrypt them and remove
          the plaintext from the database.
        </div>
      )}

      {moneyLocked ? (
        <VaultPrompt>
          Hourly rates, cost rates and ticket prices are end-to-end encrypted.
          Unlock the vault to view and edit them. Non-financial settings below remain
          editable.
        </VaultPrompt>
      ) : money === null ? (
        <Spinner />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Hourly Sell Rates (€ / hour, per location) 🔐">
            <div className="grid grid-cols-3 gap-4">
              {meta.locations.map((loc) => (
                <div key={loc}>
                  <Label>{loc}</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.5}
                    value={money.hourly_rates[loc] ?? 0}
                    onChange={(e) =>
                      editMoney((m) => {
                        m.hourly_rates[loc] = Number(e.target.value)
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </Card>

          <Card title="Hardware Cost & Escalation 🔐">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>HW Cost / Hour (€)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={money.hw_cost_per_hour}
                  onChange={(e) =>
                    editMoney((m) => {
                      m.hw_cost_per_hour = Number(e.target.value)
                    })
                  }
                />
              </div>
              <div>
                <Label>Rate escalation (% / year)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={money.rate_escalation_pct}
                  onChange={(e) =>
                    editMoney((m) => {
                      m.rate_escalation_pct = Number(e.target.value)
                    })
                  }
                />
                <p className="mt-1 text-xs text-slate-500">
                  Compounds yearly from the project's first year (sell &amp; cost rates).
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {!moneyLocked && money && (
        <Card title="Hourly Cost Rates (€ / hour, per location and level) 🔐">
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
                          value={money.cost_rates[loc]?.[lvl] ?? 0}
                          onChange={(e) =>
                            editMoney((m) => {
                              m.cost_rates[loc] = m.cost_rates[loc] ?? {}
                              m.cost_rates[loc][lvl] = Number(e.target.value)
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
      )}

      {!moneyLocked && money && (
        <Card title="Non-Labor Cost Items 🔐">
          <CostItemsEditor
            project={project}
            items={money.cost_items}
            onChange={(items) => editMoney((m) => { m.cost_items = items })}
          />
        </Card>
      )}

      <Card title="Conversion Factors">
        <div className="grid grid-cols-2 gap-4 sm:max-w-md">
          <div>
            <Label>SP → Hours</Label>
            <Input
              type="number"
              min={0}
              step={0.5}
              value={rates.sp_to_hours}
              onChange={(e) => editRates((r) => { r.sp_to_hours = Number(e.target.value) })}
            />
          </div>
          <div>
            <Label>Risk Factor (%)</Label>
            <Input
              type="number"
              min={0}
              step={0.5}
              value={rates.risk_factor_pct}
              onChange={(e) => editRates((r) => { r.risk_factor_pct = Number(e.target.value) })}
            />
          </div>
        </div>
      </Card>

      <Card title="Ticket Configuration">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="pb-2 pr-4">Size</th>
                <th className="pb-2 pr-4">Story Points</th>
                <th className="pb-2 pr-4">Price (€) 🔐</th>
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
                        editRates((r) => { r.ticket_story_points[size] = Number(e.target.value) })
                      }
                    />
                  </td>
                  <td className="py-2 pr-4">
                    {moneyLocked || !money ? (
                      <span className="text-slate-600">🔒</span>
                    ) : (
                      <Input
                        type="number"
                        min={0}
                        step={0.5}
                        className="w-24"
                        value={money.ticket_prices[size] ?? 0}
                        onChange={(e) =>
                          editMoney((m) => { m.ticket_prices[size] = Number(e.target.value) })
                        }
                      />
                    )}
                  </td>
                  {years.map((y) => (
                    <td key={y} className="py-2 pr-4">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        className={`w-24 ${
                          quotaTotal(y) > 100 ? 'border-rose-600 focus:border-rose-500 focus:ring-rose-500' : ''
                        }`}
                        value={quotaFor(y, size)}
                        onChange={(e) =>
                          editRates((r) => {
                            const key = String(y)
                            r.ticket_quotas[key] = r.ticket_quotas[key] ?? {}
                            r.ticket_quotas[key][size] = Math.max(
                              0,
                              Math.min(100, Number(e.target.value)),
                            )
                          })
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t border-slate-700 text-xs font-semibold">
                <td className="py-2 pr-4 text-slate-400" colSpan={3}>
                  Total per year (max 100%)
                </td>
                {years.map((y) => {
                  const total = quotaTotal(y)
                  return (
                    <td
                      key={y}
                      className={`py-2 pr-4 ${
                        total > 100 ? 'text-rose-400' : 'text-slate-300'
                      }`}
                    >
                      {total}%{total > 100 && ' ⚠'}
                    </td>
                  )
                })}
              </tr>
            </tbody>
          </table>
        </div>
        {quotaErrors.length > 0 && (
          <div className="mt-3 rounded-lg border border-rose-800 bg-rose-950/50 px-4 py-2 text-sm text-rose-300">
            {quotaErrors.map((e, i) => (
              <div key={i}>{e}</div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Quota = percentage of the year's total man-hours expected to be delivered as
          tickets of this size. Fields marked 🔐 are end-to-end encrypted.
        </p>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving || quotaErrors.length > 0}>
          {saving ? 'Saving…' : 'Save Budget Configuration'}
        </Button>
        {saved && <span className="text-sm text-emerald-400">Saved ✓ {money ? '(money encrypted)' : ''}</span>}
      </div>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { HardwareCatalogItem, HardwareItemInput, Project } from '../types'
import { Button, ErrorBanner, Input, Label, Modal, Select, Spinner } from './ui'
import { formatEuro } from '../utils'
import {
  BENCH_SLOTS,
  LICENCE_SLOTS,
  benchesForUsers,
  buildAutoPlanRows,
  countEngineeringUsers,
  planTotal,
  rowCost,
  slotOptions,
  type BusChoice,
  type DebuggerChoice,
  type LicenceSlot,
} from '../hardware/autoPlan'

const LICENCE_LABELS: Record<LicenceSlot, string> = {
  compiler: 'Compiler toolchain',
  polyspace: 'Polyspace',
  vectorcast: 'VectorCAST',
  davinciConfigurator: 'DaVinci Configurator',
  davinciDeveloper: 'DaVinci Developer',
}

/** Generates a full hardware plan from the project staffing, then hands the
 *  rows over to the normal (editable) table. */
export default function HardwareWizardModal({
  project,
  existingCount,
  onClose,
  onGenerated,
}: {
  project: Project
  existingCount: number
  onClose: () => void
  onGenerated: () => void
}) {
  const [catalog, setCatalog] = useState<HardwareCatalogItem[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const head = useMemo(() => countEngineeringUsers(project), [project])
  const [users, setUsers] = useState(head.users)
  const [usersPerBench, setUsersPerBench] = useState(1)
  const [benches, setBenches] = useState(head.users)
  const [benchesTouched, setBenchesTouched] = useState(false)
  const [amtsBenches, setAmtsBenches] = useState(0)
  const [debuggerChoice, setDebuggerChoice] = useState<DebuggerChoice>('lauterbach')
  const [bus, setBus] = useState<BusChoice>('can')
  const [replace, setReplace] = useState(true)

  const [pcId, setPcId] = useState<number | null>(null)
  const [powerId, setPowerId] = useState<number | null>(null)
  const [debuggerId, setDebuggerId] = useState<number | null>(null)
  const [vectorBoxId, setVectorBoxId] = useState<number | null>(null)
  const [amtsBoardId, setAmtsBoardId] = useState<number | null>(null)
  const [licenceIds, setLicenceIds] = useState<Partial<Record<LicenceSlot, number | null>>>({})

  useEffect(() => {
    api
      .listHardwareCatalog()
      .then((items) => {
        setCatalog(items)
        const first = (names: readonly string[]) => slotOptions(items, names)[0]?.id ?? null
        setPcId(first(BENCH_SLOTS.pc))
        setPowerId(first(BENCH_SLOTS.power))
        setDebuggerId(first(BENCH_SLOTS.debuggerLauterbach))
        setVectorBoxId(first(BENCH_SLOTS.vectorCan))
        setAmtsBoardId(first(BENCH_SLOTS.amts))
        setLicenceIds({
          compiler: first(LICENCE_SLOTS.compiler),
          polyspace: first(LICENCE_SLOTS.polyspace),
          vectorcast: first(LICENCE_SLOTS.vectorcast),
          davinciConfigurator: first(LICENCE_SLOTS.davinciConfigurator),
          davinciDeveloper: first(LICENCE_SLOTS.davinciDeveloper),
        })
      })
      .catch((e) => setError(e.message))
  }, [])

  // Bench count follows users ÷ users-per-bench until the user overrides it
  useEffect(() => {
    if (!benchesTouched) setBenches(benchesForUsers(users, usersPerBench))
  }, [users, usersPerBench, benchesTouched])

  const setDebuggerVendor = (choice: DebuggerChoice) => {
    setDebuggerChoice(choice)
    const names =
      choice === 'lauterbach' ? BENCH_SLOTS.debuggerLauterbach : BENCH_SLOTS.debuggerUde
    setDebuggerId(slotOptions(catalog ?? [], names)[0]?.id ?? null)
  }

  const setBusChoice = (choice: BusChoice) => {
    setBus(choice)
    const names =
      choice === 'ethernet'
        ? BENCH_SLOTS.vectorEthernet
        : choice === 'lin'
          ? BENCH_SLOTS.vectorLin
          : BENCH_SLOTS.vectorCan
    setVectorBoxId(slotOptions(catalog ?? [], names)[0]?.id ?? null)
  }

  const rows: HardwareItemInput[] = useMemo(() => {
    if (!catalog) return []
    return buildAutoPlanRows(project, catalog, {
      benches,
      amtsBenches,
      pcId,
      powerId,
      debuggerId,
      vectorBoxId,
      amtsBoardId,
      licenceIds,
    })
  }, [
    catalog, project, benches, amtsBenches,
    pcId, powerId, debuggerId, vectorBoxId, amtsBoardId, licenceIds,
  ])

  const generate = async () => {
    setBusy(true)
    setError('')
    try {
      if (replace && existingCount > 0) {
        const plan = await api.getHardwarePlan(project.id)
        for (const item of plan.items) await api.deleteHardwareItem(item.id)
      }
      for (const row of rows) await api.createHardwareItem(project.id, row)
      onGenerated()
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const slotSelect = (
    label: string,
    names: readonly string[],
    value: number | null,
    onChange: (id: number | null) => void,
  ) => {
    const options = slotOptions(catalog ?? [], names)
    return (
      <div>
        <Label>{label}</Label>
        <Select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">— none —</option>
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} — {formatEuro(item.unit_cost)}
              {item.billing === 'yearly' ? '/yr' : ''}
            </option>
          ))}
        </Select>
        {options.length === 0 && (
          <p className="mt-1 text-xs text-amber-400">
            Not in the catalog — add it there to include it.
          </p>
        )}
      </div>
    )
  }

  return (
    <Modal title="Generate Hardware Plan" onClose={onClose} size="xl">
      {catalog === null ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          {error && <ErrorBanner message={error} />}

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-4">
              {/* --- sizing ------------------------------------------------ */}
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                <h4 className="mb-3 text-sm font-semibold text-slate-200">Bench count</h4>
                <p className="mb-3 text-xs text-slate-500">
                  {head.engineerFtes} engineering FTE
                  {head.engineerFtes === 1 ? '' : 's'} in this project
                  {head.excluded.length > 0 && (
                    <> — excluding {head.excluded.join(', ')} ({head.leadFtes} FTE)</>
                  )}
                  . Rounded up to {head.users} user{head.users === 1 ? '' : 's'}
                  {usersPerBench > 1 && (
                    <>, shared {usersPerBench} per bench</>
                  )}
                  .
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label>Engineering users</Label>
                    <Input
                      type="number"
                      min={0}
                      value={users}
                      onChange={(e) => setUsers(Math.max(0, Number(e.target.value)))}
                    />
                  </div>
                  <div>
                    <Label>Users per bench</Label>
                    <Input
                      type="number"
                      min={1}
                      step="1"
                      value={usersPerBench}
                      onChange={(e) => {
                        setBenchesTouched(false)
                        setUsersPerBench(Math.max(1, Math.floor(Number(e.target.value) || 1)))
                      }}
                    />
                  </div>
                  <div>
                    <Label>Total benches</Label>
                    <Input
                      type="number"
                      min={0}
                      value={benches}
                      onChange={(e) => {
                        setBenchesTouched(true)
                        setBenches(Math.max(0, Math.floor(Number(e.target.value))))
                      }}
                    />
                  </div>
                </div>
                <div className="mt-3 w-1/3">
                  <Label>of which AMTS</Label>
                  <Input
                    type="number"
                    min={0}
                    max={benches}
                    value={amtsBenches}
                    onChange={(e) =>
                      setAmtsBenches(
                        Math.max(0, Math.min(benches, Math.floor(Number(e.target.value)))),
                      )
                    }
                  />
                </div>
              </div>

              {/* --- per bench --------------------------------------------- */}
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                <h4 className="mb-1 text-sm font-semibold text-slate-200">
                  Every bench gets
                </h4>
                <p className="mb-3 text-xs text-slate-500">
                  One of each, times {benches} bench{benches === 1 ? '' : 'es'}.
                  {amtsBenches > 0 &&
                    (amtsBenches === 1
                      ? ' The AMTS bench also gets an AMTS board.'
                      : ` The ${amtsBenches} AMTS benches also get an AMTS board each.`)}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {slotSelect('PC', BENCH_SLOTS.pc, pcId, setPcId)}
                  {slotSelect('Power supply', BENCH_SLOTS.power, powerId, setPowerId)}
                  <div>
                    <Label>Debugger</Label>
                    <div className="mb-2 flex gap-1 rounded-lg bg-slate-800 p-1 text-xs">
                      {(['lauterbach', 'ude'] as const).map((choice) => (
                        <button
                          key={choice}
                          onClick={() => setDebuggerVendor(choice)}
                          className={`flex-1 rounded-md px-2 py-1 transition-colors ${
                            debuggerChoice === choice
                              ? 'bg-indigo-600 text-white'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {choice === 'lauterbach' ? 'Lauterbach' : 'UDE (PLS)'}
                        </button>
                      ))}
                    </div>
                    <Select
                      value={debuggerId ?? ''}
                      onChange={(e) =>
                        setDebuggerId(e.target.value ? Number(e.target.value) : null)
                      }
                    >
                      <option value="">— none —</option>
                      {slotOptions(
                        catalog,
                        debuggerChoice === 'lauterbach'
                          ? BENCH_SLOTS.debuggerLauterbach
                          : BENCH_SLOTS.debuggerUde,
                      ).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} — {formatEuro(item.unit_cost)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label>Vector box</Label>
                    <div className="mb-2 flex gap-1 rounded-lg bg-slate-800 p-1 text-xs">
                      {(['can', 'lin', 'ethernet'] as const).map((choice) => (
                        <button
                          key={choice}
                          onClick={() => setBusChoice(choice)}
                          className={`flex-1 rounded-md px-2 py-1 uppercase transition-colors ${
                            bus === choice
                              ? 'bg-indigo-600 text-white'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {choice}
                        </button>
                      ))}
                    </div>
                    <Select
                      value={vectorBoxId ?? ''}
                      onChange={(e) =>
                        setVectorBoxId(e.target.value ? Number(e.target.value) : null)
                      }
                    >
                      <option value="">— none —</option>
                      {slotOptions(
                        catalog,
                        bus === 'ethernet'
                          ? BENCH_SLOTS.vectorEthernet
                          : bus === 'lin'
                            ? BENCH_SLOTS.vectorLin
                            : BENCH_SLOTS.vectorCan,
                      ).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} — {formatEuro(item.unit_cost)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  {amtsBenches > 0 &&
                    slotSelect('AMTS board', BENCH_SLOTS.amts, amtsBoardId, setAmtsBoardId)}
                </div>
              </div>

              {/* --- licences ---------------------------------------------- */}
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                <h4 className="mb-1 text-sm font-semibold text-slate-200">
                  Project licences
                </h4>
                <p className="mb-3 text-xs text-slate-500">
                  One of each for the whole project. Pick the variant you licence.
                </p>
                <div className="space-y-3">
                  {(Object.keys(LICENCE_SLOTS) as LicenceSlot[]).map((slot) =>
                    slotSelect(
                      LICENCE_LABELS[slot],
                      LICENCE_SLOTS[slot],
                      licenceIds[slot] ?? null,
                      (id) => setLicenceIds((prev) => ({ ...prev, [slot]: id })),
                    ),
                  )}
                </div>
              </div>
            </div>

            {/* --- preview -------------------------------------------------- */}
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                <h4 className="mb-3 text-sm font-semibold text-slate-200">
                  Preview — {rows.length} row{rows.length === 1 ? '' : 's'}
                </h4>
                {rows.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    Nothing to generate yet — set a bench count or pick a licence.
                  </p>
                ) : (
                  <div className="max-h-96 overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-slate-900">
                        <tr className="border-b border-slate-700 text-left text-xs uppercase tracking-wide text-slate-400">
                          <th className="py-2 pr-2">Item</th>
                          <th className="py-2 pr-2 text-center">Qty</th>
                          <th className="py-2 pr-2">Years</th>
                          <th className="py-2 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, i) => (
                          <tr key={i} className="border-b border-slate-800 last:border-0">
                            <td className="py-2 pr-2">
                              {row.name}
                              <span className="ml-1 text-xs text-slate-500">
                                {row.billing === 'yearly' ? '(yearly)' : '(once)'}
                              </span>
                            </td>
                            <td className="py-2 pr-2 text-center">{row.qty}</td>
                            <td className="py-2 pr-2 text-xs text-slate-500">
                              {row.years.length === 1
                                ? row.years[0]
                                : `${row.years[0]}–${row.years[row.years.length - 1]}`}
                            </td>
                            <td className="py-2 text-right whitespace-nowrap">
                              {formatEuro(rowCost(row))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-slate-800/50 font-semibold">
                          <td className="py-2.5 pr-2" colSpan={3}>
                            TOTAL
                          </td>
                          <td className="py-2.5 text-right whitespace-nowrap">
                            {formatEuro(planTotal(rows))}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>

              {existingCount > 0 && (
                <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-4 text-sm">
                  <p className="mb-2 text-amber-200">
                    This project already has {existingCount} hardware row
                    {existingCount === 1 ? '' : 's'}.
                  </p>
                  <label className="flex items-center gap-2 text-slate-300">
                    <input
                      type="radio"
                      checked={replace}
                      onChange={() => setReplace(true)}
                      className="accent-indigo-500"
                    />
                    Replace them with the generated plan
                  </label>
                  <label className="mt-1 flex items-center gap-2 text-slate-300">
                    <input
                      type="radio"
                      checked={!replace}
                      onChange={() => setReplace(false)}
                      className="accent-indigo-500"
                    />
                    Keep them and add these rows
                  </label>
                </div>
              )}

              <p className="text-xs text-slate-500">
                Everything generated stays fully editable in the table afterwards —
                quantities, years, prices and rows you want to remove.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={generate} disabled={busy || rows.length === 0}>
              {busy ? 'Generating…' : `Generate ${rows.length} row${rows.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

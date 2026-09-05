/**
 * Automatic hardware plan generation.
 *
 * Sizes a bench pool from the project's staffing, equips every bench from the
 * shared catalog and adds the project-level tool licences. Everything it
 * produces is an ordinary hardware row, so the result stays fully editable.
 */

import type { HardwareCatalogItem, HardwareItemInput, Project, Role } from '../types'
import { monthRange, formatMonth } from '../utils'

/** Roles that lead the project rather than occupying a bench. */
const PROJECT_LEAD = /(^|\W)(project\s*lead|project\s*manager|\(pl\)|pl)(\W|$)/i

export function isProjectLead(role: Pick<Role, 'name'>): boolean {
  return PROJECT_LEAD.test(role.name)
}

/** Headcount contributed by one role: fixed FTE, or the average of a
 *  variable allocation across the project timeline. */
export function roleFtes(role: Role, months: string[]): number {
  if (!role.use_advanced_allocation || role.allocations.length === 0) return role.ftes
  if (months.length === 0) return 0
  let total = 0
  for (const month of months) {
    for (const alloc of role.allocations) {
      if (alloc.start_month <= month && month <= alloc.end_month) total += alloc.ftes
    }
  }
  return total / months.length
}

export interface Headcount {
  /** Engineering users needing a bench — summed FTEs, rounded up. */
  users: number
  engineerFtes: number
  leadFtes: number
  excluded: string[]
}

export function countEngineeringUsers(project: Project): Headcount {
  const months = monthRange(
    formatMonth(project.start_year, project.start_month),
    formatMonth(project.end_year, project.end_month),
  )
  let engineerFtes = 0
  let leadFtes = 0
  const excluded: string[] = []
  for (const feature of project.features) {
    for (const role of feature.roles) {
      const ftes = roleFtes(role, months)
      if (isProjectLead(role)) {
        leadFtes += ftes
        if (!excluded.includes(role.name)) excluded.push(role.name)
      } else {
        engineerFtes += ftes
      }
    }
  }
  return {
    users: Math.ceil(round2(engineerFtes)),
    engineerFtes: round2(engineerFtes),
    leadFtes: round2(leadFtes),
    excluded,
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Benches needed when `usersPerBench` engineers share one bench. */
export function benchesForUsers(users: number, usersPerBench: number): number {
  if (users <= 0) return 0
  const share = Math.max(1, usersPerBench)
  return Math.ceil(users / share)
}

// ---------------------------------------------------------------------------
// Catalog choices
// ---------------------------------------------------------------------------

/** Catalog entries offered for each slot, best default first. */
export const BENCH_SLOTS = {
  pc: ['Mini PC', 'PC / workstation'],
  power: ['PowerSupply VOLTCRAFT PPS-16005', 'NI power supplies including LabVIEW'],
  debuggerLauterbach: [
    'PowerDebug E40',
    'Debugger for TriCore AUTO26 (PACK)',
    'License for Multicore Debugging (tool locked)',
  ],
  debuggerUde: [
    'PLS UAD2Pro debugger for TriCore AURIX (UDE-LIC-TC-MCA/UAD2pro)',
    'MiniDAP/cJTAG/MiniJTAG/ETKS adapter for UAD2Pro',
  ],
  vectorEthernet: ['VN5620 Ethernet Interface', 'VN5611 Ethernet Interface'],
  vectorCan: ['VN1610 CAN Network Interface', 'VN7610 FR/CAN Interface'],
  vectorLin: ['VN1611 LIN/CAN Network Interface'],
  amts: ['AMTS PowerSupplyBoard (PSB)'],
} as const

export const LICENCE_SLOTS = {
  compiler: [
    'TASKING VX-toolset for TriCore, Professional Edition v6.3',
    'TASKING VX-toolset for TriCore, Standard Edition',
  ],
  polyspace: [
    'Polyspace Bug Finder (user, subscription)',
    'Polyspace Bug Finder (user, perpetual)',
    'Polyspace Bug Finder (floating, subscription)',
    'Polyspace Bug Finder (floating, perpetual)',
    'Polyspace Bug Finder Server (subscription)',
    'Polyspace Bug Finder Server (perpetual)',
  ],
  vectorcast: [
    'VectorCAST/C++ DE (named user, 12-month subscription)',
    'VectorCAST/C++ DE (named user, perpetual)',
    'VectorCAST/C++ DE (floating, 12-month subscription)',
    'VectorCAST/C++ DE (floating, perpetual)',
    'VectorCAST/C++ SE (CI team subscription, 10 committers)',
  ],
  davinciConfigurator: [
    'DaVinci Configurator Classic (perpetual)',
    'Maintenance DaVinci Configurator Classic',
  ],
  davinciDeveloper: [
    'DaVinci Developer Classic (perpetual)',
    'Maintenance DaVinci Developer Classic',
  ],
} as const

export type BenchSlot = keyof typeof BENCH_SLOTS
export type LicenceSlot = keyof typeof LICENCE_SLOTS

/** Catalog entries for a slot, in preference order, skipping deleted ones. */
export function slotOptions(
  catalog: HardwareCatalogItem[],
  names: readonly string[],
): HardwareCatalogItem[] {
  return names
    .map((name) => catalog.find((item) => item.name === name))
    .filter((item): item is HardwareCatalogItem => item !== undefined)
}

export type DebuggerChoice = 'lauterbach' | 'ude'
export type BusChoice = 'ethernet' | 'can' | 'lin'

export interface AutoPlanConfig {
  benches: number
  amtsBenches: number
  /** Catalog item id chosen per bench slot; null skips the slot. */
  pcId: number | null
  powerId: number | null
  debuggerId: number | null
  vectorBoxId: number | null
  amtsBoardId: number | null
  /** Catalog item id per licence, or null to leave it out. */
  licenceIds: Partial<Record<LicenceSlot, number | null>>
}

/** Build the rows for a configuration. Quantities aggregate per item, so one
 *  row covers all benches (six benches → one "Mini PC ×6" row). */
export function buildAutoPlanRows(
  project: Project,
  catalog: HardwareCatalogItem[],
  config: AutoPlanConfig,
): HardwareItemInput[] {
  const years: number[] = []
  for (let y = project.start_year; y <= project.end_year; y++) years.push(y)
  const firstYear = years[0]

  const rows: HardwareItemInput[] = []
  const add = (catalogId: number | null | undefined, qty: number) => {
    if (!catalogId || qty <= 0) return
    const item = catalog.find((c) => c.id === catalogId)
    if (!item) return
    rows.push({
      catalog_item_id: item.id,
      name: item.name,
      aspice: item.aspice,
      billing: item.billing,
      unit_cost: item.unit_cost,
      qty,
      // Recurring items run for the whole project; purchases land up front.
      years: item.billing === 'yearly' ? [...years] : [firstYear],
      supplier_name: item.supplier_name,
      supplier_email: item.supplier_email,
    })
  }

  const benches = Math.max(0, Math.floor(config.benches))
  const amts = Math.max(0, Math.min(benches, Math.floor(config.amtsBenches)))

  add(config.pcId, benches)
  add(config.powerId, benches)
  add(config.debuggerId, benches)
  add(config.vectorBoxId, benches)
  add(config.amtsBoardId, amts)

  for (const slot of Object.keys(LICENCE_SLOTS) as LicenceSlot[]) {
    add(config.licenceIds[slot] ?? null, 1)
  }

  return rows
}

/** Cost of a generated row, mirroring the server's rule. */
export function rowCost(row: HardwareItemInput): number {
  const occurrences = row.billing === 'once' ? 1 : row.years.length
  return row.unit_cost * row.qty * occurrences
}

export function planTotal(rows: HardwareItemInput[]): number {
  return rows.reduce((sum, row) => sum + rowCost(row), 0)
}

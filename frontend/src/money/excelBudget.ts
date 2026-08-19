/**
 * Client-side budget workbook generator (exceljs).
 *
 * Reproduces the original desktop/server workbook layout — Config sheet,
 * CostProfit sheet with per-year Overall/Profit rows, and per-year pivot
 * sheets — entirely in the browser so decrypted money never leaves it.
 */

import type ExcelJS from 'exceljs'
import { downloadBlob } from '../download'
import type { HardwarePlan, Project, RateConfig } from '../types'
import type { BudgetPlan, MoneyConfig } from './types'

const YELLOW = 'FFFFFF00'
const GRAY = 'FFD3D3D3'
const GREEN = 'FF90EE90'
const PINK = 'FFFFB6C1'
const DARK = 'FF1F2937'
const LIGHT_GRAY = 'FFF3F4F6'

const thinBorder: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
}

function fill(color: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }
}

function setCell(
  sheet: ExcelJS.Worksheet,
  row: number,
  col: number,
  value: ExcelJS.CellValue,
  opts: {
    bold?: boolean
    bg?: string
    numFmt?: string
    align?: 'left' | 'center' | 'right'
    fontColor?: string
    fontSize?: number
    border?: boolean
  } = {},
) {
  const cell = sheet.getCell(row + 1, col + 1)
  cell.value = value
  if (opts.border !== false) cell.border = thinBorder
  cell.font = {
    bold: opts.bold ?? false,
    color: opts.fontColor ? { argb: opts.fontColor } : undefined,
    size: opts.fontSize,
  }
  if (opts.bg) cell.fill = fill(opts.bg)
  if (opts.numFmt) cell.numFmt = opts.numFmt
  cell.alignment = { horizontal: opts.align ?? 'center', vertical: 'middle' }
}

const EURO_FMT = '#,##0.00 "€"'
const NUM_FMT = '#,##0.00'
const PCT_FMT = '0.00%'

function sanitizeSheetName(name: string): string {
  let s = name
  for (const ch of [':', '\\', '/', '?', '*', '[', ']']) s = s.split(ch).join('_')
  return s.slice(0, 31)
}

function writePivotSheet(
  wb: ExcelJS.Workbook,
  name: string,
  pivot: BudgetPlan['yearly_pivots'][number],
) {
  const sheet = wb.addWorksheet(sanitizeSheetName(name))
  pivot.columns.forEach((header, col) => {
    setCell(sheet, 0, col, header, { bold: true, bg: YELLOW })
  })
  pivot.rows.forEach((row, i) => {
    const isTotal = String(row['Feature']).startsWith('TOTAL')
    pivot.columns.forEach((colName, col) => {
      const value = row[colName]
      if (col < 4) {
        setCell(sheet, i + 1, col, value as string, {
          bold: isTotal,
          bg: isTotal ? GRAY : undefined,
          align: 'left',
        })
      } else {
        setCell(sheet, i + 1, col, value as number, {
          bold: isTotal,
          bg: isTotal ? GRAY : undefined,
          numFmt: NUM_FMT,
        })
      }
    })
  })
  pivot.columns.forEach((header, col) => {
    const maxLen = Math.max(
      String(header).length,
      ...pivot.rows.map((r) => String(r[header] ?? '').length),
    )
    sheet.getColumn(col + 1).width = maxLen + 2
  })
}

function writeCostProfitSheet(wb: ExcelJS.Workbook, plan: BudgetPlan) {
  const sheet = wb.addWorksheet('CostProfit')
  let row = 0

  setCell(sheet, row, 0, 'Cost-Profit Summary by Year and Location', {
    bold: true,
    fontSize: 14,
    fontColor: DARK,
    align: 'left',
    border: false,
  })
  row += 2

  const years = [...new Set(plan.cost_profit_summary.map((r) => r.year))].sort()
  for (const year of years) {
    const yearData = plan.cost_profit_summary.filter((r) => r.year === year)
    const headers = ['Year', 'Location', 'ManHours', 'Cost', 'SellingPrice',
      'HourlyCost', 'HourlyRate', 'Profit', 'Profit%']
    headers.forEach((h, col) => setCell(sheet, row, col, h, { bold: true, bg: YELLOW }))
    row += 1

    yearData.forEach((r, idx) => {
      setCell(sheet, row, 0, idx === 0 ? r.year : '')
      setCell(sheet, row, 1, r.location)
      setCell(sheet, row, 2, r.man_hours, { numFmt: NUM_FMT })
      setCell(sheet, row, 3, r.cost, { numFmt: EURO_FMT })
      setCell(sheet, row, 4, r.selling_price, { numFmt: EURO_FMT })
      setCell(sheet, row, 5, r.hourly_cost, { numFmt: EURO_FMT })
      setCell(sheet, row, 6, r.hourly_rate, { numFmt: EURO_FMT })
      setCell(sheet, row, 7, r.profit, { numFmt: EURO_FMT })
      setCell(sheet, row, 8, r.profit_pct / 100, { numFmt: PCT_FMT })
      row += 1
    })

    // Non-labor costs feed into the Overall row — show them explicitly
    const nl = plan.non_labor_summary.filter((r) => r.year === year)
    const nlCost = nl.reduce((s, r) => s + r.cost, 0)
    const nlBilled = nl.reduce((s, r) => s + r.billed, 0)
    if (nlCost !== 0 || nlBilled !== 0) {
      setCell(sheet, row, 0, '')
      setCell(sheet, row, 1, `Non-labor (${nl.map((r) => r.category).join(', ')})`, {
        align: 'left', fontColor: 'FF6B7A99',
      })
      setCell(sheet, row, 2, '—')
      setCell(sheet, row, 3, nlCost, { numFmt: EURO_FMT })
      setCell(sheet, row, 4, nlBilled, { numFmt: EURO_FMT })
      setCell(sheet, row, 5, '—')
      setCell(sheet, row, 6, '—')
      setCell(sheet, row, 7, nlBilled - nlCost, { numFmt: EURO_FMT })
      setCell(sheet, row, 8, '—')
      row += 1
    }

    const overall = plan.cost_profit_overall.find((o) => o.year === year)
    if (overall) {
      setCell(sheet, row, 0, 'Overall', { bold: true, bg: GREEN })
      setCell(sheet, row, 1, '', { bold: true, bg: GREEN })
      setCell(sheet, row, 2, overall.man_hours, { bold: true, bg: GREEN, numFmt: NUM_FMT })
      setCell(sheet, row, 3, overall.cost, { bold: true, bg: GREEN, numFmt: EURO_FMT })
      setCell(sheet, row, 4, overall.selling_price, { bold: true, bg: GREEN, numFmt: EURO_FMT })
      setCell(sheet, row, 5, overall.hourly_cost, { bold: true, bg: GREEN, numFmt: EURO_FMT })
      setCell(sheet, row, 6, overall.hourly_rate, { bold: true, bg: GREEN, numFmt: EURO_FMT })
      setCell(sheet, row, 7, overall.profit, { bold: true, bg: GREEN, numFmt: EURO_FMT })
      setCell(sheet, row, 8, overall.profit_pct / 100, { bold: true, bg: GREEN, numFmt: PCT_FMT })
      row += 1
    }
    row += 2
  }

  if (plan.non_labor_summary.length > 0) {
    setCell(sheet, row, 0, 'Non-Labor Costs', {
      bold: true, fontSize: 14, fontColor: DARK, align: 'left', border: false,
    })
    row += 2
    const nlHeaders = ['Year', 'Category', 'Cost', 'Billed']
    nlHeaders.forEach((h, col) => setCell(sheet, row, col, h, { bold: true, bg: YELLOW }))
    row += 1
    for (const r of plan.non_labor_summary) {
      setCell(sheet, row, 0, r.year)
      setCell(sheet, row, 1, r.category)
      setCell(sheet, row, 2, r.cost, { numFmt: EURO_FMT })
      setCell(sheet, row, 3, r.billed, { numFmt: EURO_FMT })
      row += 1
    }
    row += 2
  }

  row += 2
  setCell(sheet, row, 0, 'Ticket Analysis', {
    bold: true,
    fontSize: 14,
    fontColor: DARK,
    align: 'left',
    border: false,
  })
  row += 2

  const ticketYears = [...new Set(plan.ticket_analysis.map((r) => r.year))].sort()
  for (const year of ticketYears) {
    const yearData = plan.ticket_analysis.filter((r) => r.year === year)
    const headers = ['Year', 'Size', 'StoryPoints', 'HoursPerTicket',
      'NumTickets', 'TotalHours', 'HourlyRate', 'Revenue']
    headers.forEach((h, col) => setCell(sheet, row, col, h, { bold: true, bg: YELLOW }))
    row += 1

    yearData.forEach((r, idx) => {
      setCell(sheet, row, 0, idx === 0 ? r.year : '')
      setCell(sheet, row, 1, r.size)
      setCell(sheet, row, 2, r.story_points, { numFmt: NUM_FMT })
      setCell(sheet, row, 3, r.hours_per_ticket, { numFmt: NUM_FMT })
      setCell(sheet, row, 4, r.num_tickets, { numFmt: NUM_FMT })
      setCell(sheet, row, 5, r.total_hours, { numFmt: NUM_FMT })
      setCell(sheet, row, 6, r.hourly_rate, { numFmt: EURO_FMT })
      setCell(sheet, row, 7, r.revenue, { numFmt: EURO_FMT })
      row += 1
    })

    const overall = plan.ticket_overall.find((o) => o.year === year)
    if (overall) {
      for (let col = 0; col < 7; col++) {
        setCell(sheet, row, col, col === 0 ? 'Overall' : '', { bold: true, bg: GREEN })
      }
      setCell(sheet, row, 7, overall.revenue, { bold: true, bg: GREEN, numFmt: EURO_FMT })
      row += 1
      for (let col = 0; col < 7; col++) {
        setCell(sheet, row, col, col === 0 ? 'Profit' : '', { bold: true, bg: PINK })
      }
      setCell(sheet, row, 7, overall.profit_pct / 100, { bold: true, bg: PINK, numFmt: PCT_FMT })
      row += 1
    }
    row += 2
  }

  sheet.getColumn(1).width = 10
  sheet.getColumn(2).width = 15
  for (let c = 3; c <= 9; c++) sheet.getColumn(c).width = 15
}

function writeConfigSheet(
  wb: ExcelJS.Workbook,
  project: Project,
  money: MoneyConfig,
  rates: RateConfig,
) {
  const sheet = wb.addWorksheet('Config')
  let row = 0

  const sectionHeader = (title: string) => {
    sheet.mergeCells(row + 1, 1, row + 1, 4)
    setCell(sheet, row, 0, title, { bold: true, bg: DARK, fontColor: 'FFFFFFFF' })
    row += 2
  }
  const label = (r: number, c: number, text: string) =>
    setCell(sheet, r, c, text, { bold: true, bg: LIGHT_GRAY, align: 'left' })
  const value = (r: number, c: number, v: ExcelJS.CellValue, numFmt?: string) =>
    setCell(sheet, r, c, v, { align: 'left', numFmt })

  sectionHeader('PROJECT CONFIGURATION')
  label(row, 0, 'Project Name:')
  value(row, 1, project.name)
  label(row, 2, 'Company:')
  value(row, 3, project.company)
  row += 1
  label(row, 0, 'Start Date:')
  value(row, 1, `${project.start_year}-${String(project.start_month).padStart(2, '0')}`)
  label(row, 2, 'End Date:')
  value(row, 3, `${project.end_year}-${String(project.end_month).padStart(2, '0')}`)
  row += 2

  sectionHeader('RATES CONFIGURATION')
  label(row, 0, 'Story Points to Hours:')
  value(row, 1, rates.sp_to_hours, NUM_FMT)
  label(row, 2, 'HW Cost/Hour:')
  value(row, 3, money.hw_cost_per_hour, NUM_FMT)
  row += 1
  label(row, 0, 'Risk Factor %:')
  value(row, 1, rates.risk_factor_pct, NUM_FMT)
  label(row, 2, 'Rate Escalation %/yr:')
  value(row, 3, money.rate_escalation_pct ?? 0, NUM_FMT)
  row += 2

  sectionHeader('HOURLY SELL RATES')
  row -= 1
  for (const [location, rate] of Object.entries(money.hourly_rates)) {
    label(row, 0, `${location}:`)
    value(row, 1, rate, NUM_FMT)
    row += 1
  }
  row += 1

  sectionHeader('HOURLY COST RATES')
  row -= 1
  for (const [location, levels] of Object.entries(money.cost_rates)) {
    label(row, 0, `${location}:`)
    value(row, 1, '')
    row += 1
    for (const [level, rate] of Object.entries(levels)) {
      value(row, 0, '')
      label(row, 1, `  ${level}:`)
      value(row, 2, rate, NUM_FMT)
      row += 1
    }
  }
  row += 1

  sectionHeader('TICKET CONFIGURATION')
  const quotaYears = Object.keys(rates.ticket_quotas).sort()
  const headers = ['Size', 'Story-points', 'Price (€)', ...quotaYears.map((y) => `Quota ${y} (%)`)]
  headers.forEach((h, col) => setCell(sheet, row, col, h, { bold: true, bg: DARK, fontColor: 'FFFFFFFF' }))
  row += 1
  for (const size of ['Small', 'Medium', 'Large']) {
    const key = size.toLowerCase()
    setCell(sheet, row, 0, size)
    setCell(sheet, row, 1, rates.ticket_story_points[key] ?? 0, { numFmt: NUM_FMT })
    setCell(sheet, row, 2, money.ticket_prices[key] ?? 0, { numFmt: NUM_FMT })
    quotaYears.forEach((y, i) => {
      setCell(sheet, row, 3 + i, rates.ticket_quotas[y]?.[key] ?? 0, { numFmt: NUM_FMT })
    })
    row += 1
  }

  if ((money.cost_items ?? []).length > 0) {
    row += 1
    sectionHeader('NON-LABOR COST ITEMS')
    const itemHeaders = ['Name', 'Category', 'Amount (€)', 'Type', 'From', 'To', 'Billed']
    itemHeaders.forEach((h, col) =>
      setCell(sheet, row, col, h, { bold: true, bg: DARK, fontColor: 'FFFFFFFF' }),
    )
    row += 1
    for (const item of money.cost_items) {
      setCell(sheet, row, 0, item.name, { align: 'left' })
      setCell(sheet, row, 1, item.category)
      setCell(sheet, row, 2, item.amount, { numFmt: NUM_FMT })
      setCell(sheet, row, 3, item.is_recurring ? 'Monthly' : 'One-time')
      setCell(sheet, row, 4, item.start_month)
      setCell(sheet, row, 5, item.end_month ?? '')
      setCell(sheet, row, 6, item.pass_through ? 'Yes' : 'No')
      row += 1
    }
  }

  for (let c = 1; c <= 4; c++) sheet.getColumn(c).width = 20
  for (let c = 5; c < 4 + quotaYears.length; c++) sheet.getColumn(c).width = 15
}

function writeHardwareSheet(
  wb: ExcelJS.Workbook,
  project: Project,
  hardware: HardwarePlan,
) {
  const sheet = wb.addWorksheet('Hardware')
  const years: number[] = []
  for (let y = project.start_year; y <= project.end_year; y++) years.push(y)

  const headers = [
    'ASPICE', 'Item', 'Yearly/Once', 'Unit Cost', 'Qty',
    ...years.map(String), 'Total', 'Supplier', 'Supplier Email',
  ]
  headers.forEach((h, col) => setCell(sheet, 0, col, h, { bold: true, bg: YELLOW }))

  const yearOffset = 5
  const totalCol = yearOffset + years.length
  hardware.items.forEach((item, i) => {
    const row = i + 1
    setCell(sheet, row, 0, item.aspice, { align: 'left' })
    setCell(sheet, row, 1, item.name, { align: 'left' })
    setCell(sheet, row, 2, item.billing, { align: 'left' })
    setCell(sheet, row, 3, item.unit_cost, { numFmt: EURO_FMT })
    setCell(sheet, row, 4, item.qty)
    const perOccurrence = item.unit_cost * item.qty
    const itemYears =
      item.billing === 'once'
        ? [item.years[0] ?? project.start_year]
        : item.years
    years.forEach((year, offset) => {
      const value = itemYears.includes(year) ? perOccurrence : ''
      setCell(sheet, row, yearOffset + offset, value, {
        numFmt: value === '' ? undefined : EURO_FMT,
      })
    })
    setCell(sheet, row, totalCol, item.total, { numFmt: EURO_FMT })
    setCell(sheet, row, totalCol + 1, item.supplier_name, { align: 'left' })
    setCell(sheet, row, totalCol + 2, item.supplier_email, { align: 'left' })
  })

  const footer = hardware.items.length + 1
  setCell(sheet, footer, 0, 'TOTAL', { bold: true, bg: GRAY })
  for (let col = 1; col < yearOffset; col++) setCell(sheet, footer, col, '', { bg: GRAY })
  years.forEach((year, offset) => {
    setCell(sheet, footer, yearOffset + offset, hardware.per_year[String(year)] ?? 0, {
      bold: true, bg: GRAY, numFmt: EURO_FMT,
    })
  })
  setCell(sheet, footer, totalCol, hardware.grand_total, {
    bold: true, bg: GRAY, numFmt: EURO_FMT,
  })
  setCell(sheet, footer, totalCol + 1, '', { bg: GRAY })
  setCell(sheet, footer, totalCol + 2, '', { bg: GRAY })

  const widths = [10, 32, 12, 14, 6, ...years.map(() => 14), 14, 24, 30]
  widths.forEach((w, idx) => {
    sheet.getColumn(idx + 1).width = w
  })
}

/** Build the workbook and trigger a browser download. */
export async function downloadBudgetWorkbook(
  project: Project,
  money: MoneyConfig,
  rates: RateConfig,
  plan: BudgetPlan,
  hardware?: HardwarePlan | null,
): Promise<void> {
  const { Workbook } = await import('exceljs') // lazy: only loaded on export
  const wb = new Workbook()
  writeConfigSheet(wb, project, money, rates)
  writeCostProfitSheet(wb, plan)
  for (const pivot of plan.yearly_pivots) {
    writePivotSheet(wb, pivot.year, pivot)
  }
  if (hardware && hardware.items.length > 0) {
    writeHardwareSheet(wb, project, hardware)
  }

  const buffer = await wb.xlsx.writeBuffer()
  downloadBlob(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${project.name} - Budget Plan.xlsx`,
  )
}

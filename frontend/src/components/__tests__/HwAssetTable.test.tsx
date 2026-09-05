// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import HwAssetTable from '../HwAssetTable'
import { BLANK_ASSET } from '../../hardware/registers'
import type { HwAssetInput, HwMeta } from '../../types'

const meta: HwMeta = {
  purchase_types: ['Purchase', 'Leasing', 'Planned Purchase', 'Not Purchased'],
  asset_statuses: ['In Stock', 'Return'],
  asset_categories: ['PC', 'Debugger'],
  license_categories: ['Compiler'],
  budget_modes: ['split', 'overall'],
  leasing_months: 36,
}

function lease(overrides: Partial<HwAssetInput> = {}): HwAssetInput {
  return {
    ...BLANK_ASSET,
    name: 'Bench PC',
    purchase_type: 'Leasing',
    purchase_date: '2026-01-01',
    eol_date: '2028-12-31',
    purchase_cost: 3600,
    ...overrides,
  }
}

const years = [2026, 2027, 2028]

describe('HwAssetTable', () => {
  it('shows the live per-year depreciation and the totals', () => {
    render(
      <HwAssetTable rows={[lease()]} years={years} meta={meta} catalog={[]} onChange={vi.fn()} />,
    )
    const row = screen.getByDisplayValue('Bench PC').closest('tr')!
    // 3600 over 36 months: 1200 in each of the three years, 3600 in total
    expect(within(row).getAllByText(/1[,.]200[.,]00/)).toHaveLength(3)
    expect(within(row).getByText(/3[,.]600[.,]00/)).toBeInTheDocument()
    const footer = screen.getByText('Total actual').closest('tr')!
    expect(within(footer).getAllByText(/1[,.]200[.,]00/)).toHaveLength(3)
    expect(within(footer).getByText(/3[,.]600[.,]00/)).toBeInTheDocument()
  })

  it('reports every edit through onChange without keeping state of its own', () => {
    const onChange = vi.fn()
    render(
      <HwAssetTable rows={[lease()]} years={years} meta={meta} catalog={[]} onChange={onChange} />,
    )
    fireEvent.change(screen.getByLabelText('Purchase cost'), { target: { value: '7200' } })
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ purchase_cost: 7200 })])
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Return' } })
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ status: 'Return' })])
  })

  it('flags a row that counts towards no year and a row without a name', () => {
    render(
      <HwAssetTable
        rows={[lease({ eol_date: null }), lease({ name: '', purchase_cost: 10 })]}
        years={years}
        meta={meta}
        catalog={[]}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText('not counted')).toHaveAttribute('title', 'no end date')
    expect(screen.getByText('Name needed to save')).toBeInTheDocument()
  })

  it('appends a blank line from the empty state and from the footer button', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <HwAssetTable rows={[]} years={years} meta={meta} catalog={[]} onChange={onChange} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /add asset/i }))
    expect(onChange).toHaveBeenCalledWith([BLANK_ASSET])
    rerender(
      <HwAssetTable rows={[lease()]} years={years} meta={meta} catalog={[]} onChange={onChange} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /add asset/i }))
    expect(onChange).toHaveBeenLastCalledWith([lease(), BLANK_ASSET])
  })

  it('asks before deleting and then drops the row', () => {
    const onChange = vi.fn()
    render(
      <HwAssetTable rows={[lease()]} years={years} meta={meta} catalog={[]} onChange={onChange} />,
    )
    fireEvent.click(screen.getByLabelText('Delete asset'))
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Confirm delete'))
    expect(onChange).toHaveBeenCalledWith([])
  })
})

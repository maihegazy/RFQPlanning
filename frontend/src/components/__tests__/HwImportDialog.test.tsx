// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import HwImportDialog from '../HwImportDialog'
import { BLANK_ASSET } from '../../hardware/registers'
import type { HwImportPreview, HwImportResult } from '../../types'

const apiMock = vi.hoisted(() => ({
  importHwWorkbook: vi.fn(),
  hwImportTemplateUrl: () => '/api/hw/import-template.xlsx',
}))
vi.mock('../../api', () => ({ api: apiMock, ApiError: class extends Error {} }))

const preview: HwImportPreview = {
  assets: [{ ...BLANK_ASSET, asset_tag: 'A-1', name: 'Trace32', purchase_cost: 1234.56 }],
  licenses: [],
  warnings: ['Assets row 4: skipped, no Asset Name'],
  sheets_found: ['Assets'],
}

const result: HwImportResult = {
  created_assets: 1,
  created_licenses: 0,
  replaced_assets: 3,
  replaced_licenses: 0,
  warnings: [],
}

function pickFile(name = 'register.xlsx') {
  const file = new File(['x'], name)
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
  return file
}

describe('HwImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('previews the workbook before anything is written, then imports in the chosen mode', async () => {
    apiMock.importHwWorkbook.mockResolvedValueOnce(preview).mockResolvedValueOnce(result)
    const onImported = vi.fn()
    const onClose = vi.fn()
    render(<HwImportDialog projectId={7} onClose={onClose} onImported={onImported} />)

    const file = pickFile()
    await waitFor(() => expect(screen.getByText('Trace32')).toBeInTheDocument())
    expect(apiMock.importHwWorkbook).toHaveBeenCalledWith(7, file, true)
    expect(screen.getByText(/1 warning/)).toBeInTheDocument()
    expect(screen.getByText(/1 asset and 0 licenses will be added/)).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(/Replace the registers/))
    expect(screen.getByText(/will replace the matching registers/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Import 1 row/ }))
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(result))
    expect(apiMock.importHwWorkbook).toHaveBeenLastCalledWith(7, file, false, 'replace')
    expect(onClose).toHaveBeenCalled()
  })

  it('refuses a file that is not a workbook without calling the API', () => {
    render(<HwImportDialog projectId={7} onClose={vi.fn()} onImported={vi.fn()} />)
    pickFile('register.csv')
    expect(screen.getByText(/is not an .xlsx workbook/)).toBeInTheDocument()
    expect(apiMock.importHwWorkbook).not.toHaveBeenCalled()
  })

  it("shows the server's reason when the workbook cannot be read", async () => {
    apiMock.importHwWorkbook.mockRejectedValueOnce(new Error('no Assets or Licenses sheet found'))
    render(<HwImportDialog projectId={7} onClose={vi.fn()} onImported={vi.fn()} />)
    pickFile()
    await waitFor(() =>
      expect(screen.getByText('no Assets or Licenses sheet found')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, describeDetail } from './api'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 422 ? 'Unprocessable Entity' : 'OK',
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('describeDetail', () => {
  it('turns a validation error list into a readable sentence', () => {
    expect(
      describeDetail([
        { loc: ['body', 'start_month'], msg: 'Input should be less than or equal to 12' },
        { loc: ['body', 'features', 0, 'name'], msg: 'Field required' },
      ]),
    ).toBe('start_month: Input should be less than or equal to 12; features.0.name: Field required')
  })

  it('passes plain strings through and falls back sensibly', () => {
    expect(describeDetail('Project not found')).toBe('Project not found')
    expect(describeDetail([{ msg: 'invalid' }])).toBe('invalid')
    expect(describeDetail([])).toBeNull()
    expect(describeDetail(null)).toBeNull()
  })
})

describe('the api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports a 422 as the field and the message, not raw JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(422, {
          detail: [{ loc: ['body', 'end_year'], msg: 'Input should be a valid integer' }],
        }),
      ),
    )
    const failure = await api.getProject(1).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(ApiError)
    expect((failure as ApiError).status).toBe(422)
    expect((failure as ApiError).message).toBe('end_year: Input should be a valid integer')
  })

  it('sends an empty status filter as "no status" and no filter as "every status"', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(200, {}))
    vi.stubGlobal('fetch', fetchMock)
    await api.getPortfolioCapacity([])
    await api.getPortfolioCapacity(['won', 'draft'])
    await api.getPortfolioCapacity()
    const urls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(urls).toEqual([
      '/api/portfolio/capacity?statuses=',
      '/api/portfolio/capacity?statuses=won,draft',
      '/api/portfolio/capacity',
    ])
  })

  it('uploads a workbook with the chosen import mode', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(200, {}))
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['x'], 'register.xlsx')
    await api.importHwWorkbook(7, file, true)
    await api.importHwWorkbook(7, file, false, 'replace')
    const urls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(urls).toEqual([
      '/api/hw/projects/7/import?dry_run=true&mode=append',
      '/api/hw/projects/7/import?dry_run=false&mode=replace',
    ])
  })
})

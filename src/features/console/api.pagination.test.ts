// T17.18: paginated console reads. Venues, invoices and invoice lines go through the *_page RPCs; leads and reviews
// through bounded .range() reads with an exact count. Page numbers are 1-based, 25 rows per page.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tables } from '../../lib/database.types'

type Result = { data: unknown; error: { message: string } | null; count: number | null }
let rows: unknown[] = []
let count: number | null = 0
let failure: { message: string } | null = null
let calls: Array<[string, unknown[]]> = []

function builder() {
  const chain: Record<string, unknown> = {}
  for (const name of ['select', 'eq', 'order', 'or', 'ilike', 'range', 'limit']) {
    chain[name] = (...args: unknown[]) => { calls.push([name, args]); return chain }
  }
  chain.then = (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve({ data: failure ? null : rows, error: failure, count: failure ? null : count } as Result).then(resolve, reject)
  return chain
}

const rpc = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn(() => builder()), rpc: (...args: unknown[]) => rpc(...args) },
}))

const api = await import('./api')
const { supabase } = await import('../../lib/supabase')
const { resetPage } = await import('./paging')

const lead: Tables<'leads'> = {
  id: 'l1', first_name: 'Ana', last_name: 'Cruz', email: 'e2e-a@example.com', phone: '0917', venue_name: 'E2E Courts',
  location: 'Manila', courts: 2, facebook: null, message: null, notes: null, status: 'new',
  consented_at: '2026-01-01T00:00:00Z', created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
}
const review: Tables<'reviews'> = {
  id: 'r1', name: 'Ben', role: 'Owner', venue: 'E2E Courts', quote: 'Great', rating: 5, approved: false,
  consented_at: '2026-01-01T00:00:00Z', created_at: '2026-01-02T00:00:00Z',
}

function orderCalls() {
  return calls.filter(([n]) => n === 'order').map(([, a]) => a)
}
function orArg(): string {
  const c = calls.find(([n]) => n === 'or')
  return String(c?.[1][0])
}

beforeEach(() => {
  rows = []
  count = 0
  failure = null
  calls = []
  rpc.mockReset()
  vi.mocked(supabase.from).mockClear()
})

describe('page size', () => {
  it('is 25', () => {
    expect(api.CONSOLE_PAGE_SIZE).toBe(25)
  })
})

describe('fetchVenuesPage', () => {
  it('calls venues_page with the filters and a 25-row window for page 1', async () => {
    rpc.mockResolvedValue({ data: { total: 0, rows: [] }, error: null })
    await api.fetchVenuesPage({ search: 'zed', status: 'active', page: 1 })
    expect(rpc).toHaveBeenCalledWith('venues_page', { p_search: 'zed', p_status: 'active', p_limit: 25, p_offset: 0 })
  })

  it('page 2 starts at offset 25 and page 3 at 50', async () => {
    rpc.mockResolvedValue({ data: { total: 60, rows: [] }, error: null })
    await api.fetchVenuesPage({ search: '', status: '', page: 2 })
    expect(rpc).toHaveBeenLastCalledWith('venues_page', { p_search: null, p_status: null, p_limit: 25, p_offset: 25 })
    await api.fetchVenuesPage({ search: '', status: '', page: 3 })
    expect(rpc).toHaveBeenLastCalledWith('venues_page', { p_search: null, p_status: null, p_limit: 25, p_offset: 50 })
  })

  it('returns rows and total as the RPC gave them, and an empty page as is', async () => {
    const venueRows = [{ venue_id: 'v1', slug: 'e2e-a', name: 'E2E A', status: 'active', month_transactions: 1, month_total: 10, open_invoices: 0 }]
    rpc.mockResolvedValue({ data: { total: 26, rows: venueRows }, error: null })
    expect(await api.fetchVenuesPage({ search: '', status: '', page: 1 })).toEqual({ rows: venueRows, total: 26 })
    rpc.mockResolvedValue({ data: { total: 0, rows: [] }, error: null })
    expect(await api.fetchVenuesPage({ search: 'nope', status: '', page: 1 })).toEqual({ rows: [], total: 0 })
  })

  it('rejects with the RPC error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'x', details: '', hint: 'not_platform_admin', code: 'P0001', name: 'PostgrestError' } })
    await expect(api.fetchVenuesPage({ search: '', status: '', page: 1 })).rejects.toMatchObject({ hint: 'not_platform_admin' })
  })

  it('leaves fetchVenuesOverview on the old RPC', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    await api.fetchVenuesOverview()
    expect(rpc).toHaveBeenCalledWith('venues_overview')
  })
})

describe('fetchInvoicesPage', () => {
  it('calls invoices_page with search, status, month and the window', async () => {
    rpc.mockResolvedValue({ data: { total: 0, rows: [] }, error: null })
    await api.fetchInvoicesPage({ search: 'zed', status: 'sent', month: '2026-03-01', page: 2 })
    expect(rpc).toHaveBeenCalledWith('invoices_page', { p_search: 'zed', p_status: 'sent', p_month: '2026-03-01', p_limit: 25, p_offset: 25 })
  })

  it('sends null for empty filters', async () => {
    rpc.mockResolvedValue({ data: { total: 0, rows: [] }, error: null })
    await api.fetchInvoicesPage({ search: '', status: '', month: '', page: 1 })
    expect(rpc).toHaveBeenCalledWith('invoices_page', { p_search: null, p_status: null, p_month: null, p_limit: 25, p_offset: 0 })
  })

  it('returns rows and total', async () => {
    rpc.mockResolvedValue({ data: { total: 3, rows: [{ invoice_id: 'i1' }] }, error: null })
    expect(await api.fetchInvoicesPage({ search: '', status: '', month: '', page: 1 })).toEqual({ rows: [{ invoice_id: 'i1' }], total: 3 })
  })

  it('leaves fetchInvoicesOverview on the old RPC', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    await api.fetchInvoicesOverview()
    expect(rpc).toHaveBeenCalledWith('invoices_overview')
  })
})

describe('fetchInvoiceDetailPage', () => {
  it('calls invoice_detail_page with the invoice id and the line window', async () => {
    const detail = { invoice_id: 'i1', lines: [], line_total: 0 }
    rpc.mockResolvedValue({ data: detail, error: null })
    expect(await api.fetchInvoiceDetailPage({ invoiceId: 'i1', page: 3 })).toEqual(detail)
    expect(rpc).toHaveBeenCalledWith('invoice_detail_page', { p_invoice_id: 'i1', p_limit: 25, p_offset: 50 })
  })

  it('leaves fetchInvoiceDetail on the old RPC', async () => {
    rpc.mockResolvedValue({ data: { invoice_id: 'i1', lines: [] }, error: null })
    await api.fetchInvoiceDetail('i1')
    expect(rpc).toHaveBeenCalledWith('invoice_detail', { p_invoice_id: 'i1' })
  })
})

describe('fetchLeadsPage', () => {
  it('reads one bounded, exactly counted page, newest first with id as the tie-breaker', async () => {
    rows = [lead]
    count = 61
    await expect(api.fetchLeadsPage({ status: 'all', search: '', page: 1 })).resolves.toEqual({ rows: [lead], total: 61 })
    expect(supabase.from).toHaveBeenCalledWith('leads')
    expect(calls).toContainEqual(['select', ['*', { count: 'exact' }]])
    expect(orderCalls()).toEqual([['created_at', { ascending: false }], ['id', { ascending: false }]])
    expect(calls).toContainEqual(['range', [0, 24]])
  })

  it('page 2 covers rows 25 to 49 and does not overlap page 1', async () => {
    await api.fetchLeadsPage({ status: 'all', search: '', page: 2 })
    expect(calls).toContainEqual(['range', [25, 49]])
  })

  it('has no status filter for "all" and filters otherwise', async () => {
    await api.fetchLeadsPage({ status: 'all', search: '', page: 1 })
    expect(calls.some(([n]) => n === 'eq')).toBe(false)
    calls = []
    await api.fetchLeadsPage({ status: 'won', search: '', page: 1 })
    expect(calls).toContainEqual(['eq', ['status', 'won']])
  })

  it('adds no search filter for a blank search', async () => {
    await api.fetchLeadsPage({ status: 'all', search: '   ', page: 1 })
    expect(calls.some(([n]) => n === 'or')).toBe(false)
  })

  it('searches first name, last name, email and venue name with a trimmed term', async () => {
    await api.fetchLeadsPage({ status: 'all', search: '  cruz ', page: 1 })
    const arg = orArg()
    for (const col of ['first_name', 'last_name', 'email', 'venue_name']) expect(arg).toContain(`${col}.ilike.`)
    expect(arg).toContain('%cruz%')
    expect(arg).not.toContain(' cruz')
  })

  it('escapes LIKE wildcards so % and _ are literal', async () => {
    await api.fetchLeadsPage({ status: 'all', search: '50%_off', page: 1 })
    const arg = orArg()
    expect(arg).toMatch(/50\\+%\\+_off/)
    expect(arg).not.toMatch(/50%/)
  })

  it('escapes a backslash in the search', async () => {
    await api.fetchLeadsPage({ status: 'all', search: 'a\\b', page: 1 })
    expect(orArg()).toMatch(/a\\{2,}b/)
  })

  it('double-quotes the term so commas and parentheses cannot break the or filter', async () => {
    await api.fetchLeadsPage({ status: 'all', search: 'a,b(c)', page: 1 })
    expect(orArg()).toContain('"%a,b(c)%"')
  })

  it('returns an empty page with total 0', async () => {
    rows = []
    count = 0
    await expect(api.fetchLeadsPage({ status: 'all', search: 'zzz', page: 4 })).resolves.toEqual({ rows: [], total: 0 })
  })

  it('rejects when the read fails', async () => {
    failure = { message: 'boom' }
    await expect(api.fetchLeadsPage({ status: 'all', search: '', page: 1 })).rejects.toThrow('boom')
  })

  it('keeps fetchLeads unpaged for old consumers', async () => {
    rows = [lead]
    await expect(api.fetchLeads('all')).resolves.toEqual([lead])
    expect(calls.some(([n]) => n === 'range')).toBe(false)
  })
})

describe('fetchReviewsPage', () => {
  it('reads one bounded, exactly counted page, newest first with id as the tie-breaker', async () => {
    rows = [review]
    count = 26
    await expect(api.fetchReviewsPage({ approved: 'all', search: '', page: 1 })).resolves.toEqual({ rows: [review], total: 26 })
    expect(supabase.from).toHaveBeenCalledWith('reviews')
    expect(calls).toContainEqual(['select', ['*', { count: 'exact' }]])
    expect(orderCalls()).toEqual([['created_at', { ascending: false }], ['id', { ascending: false }]])
    expect(calls).toContainEqual(['range', [0, 24]])
  })

  it('page 2 covers rows 25 to 49', async () => {
    await api.fetchReviewsPage({ approved: 'all', search: '', page: 2 })
    expect(calls).toContainEqual(['range', [25, 49]])
  })

  it('has no approval filter for "all", filters approved = true for "approved" and false for "hidden"', async () => {
    await api.fetchReviewsPage({ approved: 'all', search: '', page: 1 })
    expect(calls.some(([n]) => n === 'eq')).toBe(false)
    calls = []
    await api.fetchReviewsPage({ approved: 'approved', search: '', page: 1 })
    expect(calls).toContainEqual(['eq', ['approved', true]])
    calls = []
    await api.fetchReviewsPage({ approved: 'hidden', search: '', page: 1 })
    expect(calls).toContainEqual(['eq', ['approved', false]])
  })

  it('searches name, venue and quote with an escaped, quoted, trimmed term', async () => {
    await api.fetchReviewsPage({ approved: 'all', search: ' 100%, (great) ', page: 1 })
    const arg = orArg()
    for (const col of ['name', 'venue', 'quote']) expect(arg).toContain(`${col}.ilike.`)
    expect(arg).toMatch(/100\\+%/)
    expect(arg).toContain('"%')
    expect(arg).not.toMatch(/100%/)
  })

  it('returns an empty page with total 0 and rejects on failure', async () => {
    await expect(api.fetchReviewsPage({ approved: 'all', search: '', page: 9 })).resolves.toEqual({ rows: [], total: 0 })
    failure = { message: 'boom' }
    await expect(api.fetchReviewsPage({ approved: 'all', search: '', page: 1 })).rejects.toThrow('boom')
  })

  it('keeps fetchReviews unpaged for old consumers', async () => {
    rows = [review]
    await expect(api.fetchReviews()).resolves.toEqual([review])
    expect(calls.some(([n]) => n === 'range')).toBe(false)
  })
})

describe('resetPage', () => {
  it('returns the filters with page 1', () => {
    expect(resetPage({ search: 'x', status: 'new', page: 4 })).toEqual({ search: 'x', status: 'new', page: 1 })
  })

  it('does not mutate its input', () => {
    const filters = { search: 'x', page: 3 }
    resetPage(filters)
    expect(filters.page).toBe(3)
  })
})

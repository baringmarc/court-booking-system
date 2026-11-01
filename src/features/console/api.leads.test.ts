// T14.3: fetchLeads (newest first, optional status filter) and updateLead.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Result = { data: unknown; error: { message: string } | null }
let rows: unknown[] = []
let failure: { message: string } | null = null
let calls: Array<[string, unknown[]]> = []

function builder() {
  const chain: Record<string, unknown> = {}
  for (const name of ['select', 'eq', 'order', 'update', 'limit']) {
    chain[name] = (...args: unknown[]) => { calls.push([name, args]); return chain }
  }
  chain.then = (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve({ data: failure ? null : rows, error: failure } as Result).then(resolve, reject)
  return chain
}

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder()) } }))

const { fetchLeads, updateLead } = await import('./api')
const { supabase } = await import('../../lib/supabase')

beforeEach(() => {
  rows = []
  failure = null
  calls = []
  vi.mocked(supabase.from).mockClear()
})

describe('fetchLeads', () => {
  it('reads the leads table newest first, without a status filter for "all"', async () => {
    rows = [{ id: 'l1' }]
    await expect(fetchLeads('all')).resolves.toEqual([{ id: 'l1' }])
    expect(supabase.from).toHaveBeenCalledWith('leads')
    expect(calls).toContainEqual(['order', ['created_at', { ascending: false }]])
    expect(calls.some(([n]) => n === 'eq')).toBe(false)
  })

  it('filters by status when one is given', async () => {
    await fetchLeads('talking')
    expect(calls).toContainEqual(['eq', ['status', 'talking']])
  })

  it('rejects when the read fails', async () => {
    failure = { message: 'boom' }
    await expect(fetchLeads('all')).rejects.toThrow('boom')
  })
})

describe('updateLead', () => {
  it('updates only the patched fields of the lead with that id', async () => {
    await expect(updateLead('l1', { status: 'won' })).resolves.toBeUndefined()
    expect(supabase.from).toHaveBeenCalledWith('leads')
    expect(calls).toContainEqual(['update', [{ status: 'won' }]])
    expect(calls).toContainEqual(['eq', ['id', 'l1']])
  })

  it('can clear notes with null', async () => {
    await updateLead('l1', { notes: null })
    expect(calls).toContainEqual(['update', [{ notes: null }]])
  })

  it('rejects when the update fails', async () => {
    failure = { message: 'denied' }
    await expect(updateLead('l1', { status: 'lost' })).rejects.toThrow('denied')
  })
})

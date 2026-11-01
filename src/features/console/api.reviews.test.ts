// T15.4: fetchReviews (newest first) and setReviewApproved.
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

const { fetchReviews, setReviewApproved } = await import('./api')
const { supabase } = await import('../../lib/supabase')

beforeEach(() => {
  rows = []
  failure = null
  calls = []
  vi.mocked(supabase.from).mockClear()
})

describe('fetchReviews', () => {
  it('reads reviews newest first', async () => {
    rows = [{ id: 'r1' }]
    expect(await fetchReviews()).toEqual([{ id: 'r1' }])
    expect(supabase.from).toHaveBeenCalledWith('reviews')
    expect(calls).toContainEqual(['order', ['created_at', { ascending: false }]])
  })

  it('throws when the read fails', async () => {
    failure = { message: 'denied' }
    await expect(fetchReviews()).rejects.toBeTruthy()
  })
})

describe('setReviewApproved', () => {
  it('updates only approved, by id', async () => {
    await setReviewApproved('r1', true)
    expect(supabase.from).toHaveBeenCalledWith('reviews')
    expect(calls).toContainEqual(['update', [{ approved: true }]])
    expect(calls).toContainEqual(['eq', ['id', 'r1']])
  })

  it('throws when the update fails', async () => {
    failure = { message: 'denied' }
    await expect(setReviewApproved('r1', false)).rejects.toBeTruthy()
  })
})

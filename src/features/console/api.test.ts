// T13.7: fetchIsPlatformAdmin reads the signed-in user's own platform_admins row.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Result = { data: unknown; error: { message: string } | null }
const tables: Record<string, unknown[]> = {}
let failure: { message: string } | null = null

function builder(table: string) {
  const rows = () => tables[table] ?? []
  const chain: Record<string, unknown> = {}
  for (const name of ['select', 'eq', 'neq', 'in', 'is', 'order', 'limit', 'match', 'filter']) chain[name] = () => chain
  const one = (): Result => ({ data: failure ? null : (rows()[0] ?? null), error: failure })
  const many = (): Result => ({ data: failure ? null : rows(), error: failure })
  chain.single = () => Promise.resolve(one())
  chain.maybeSingle = () => Promise.resolve(one())
  chain.then = (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(many()).then(resolve, reject)
  return chain
}

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn((table: string) => builder(table)) } }))

const { fetchIsPlatformAdmin } = await import('./api')
const { supabase } = await import('../../lib/supabase')

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key]
  failure = null
  vi.mocked(supabase.from).mockClear()
})

describe('fetchIsPlatformAdmin', () => {
  it('is true when the user has a platform_admins row', async () => {
    tables.platform_admins = [{ user_id: 'u1' }]
    await expect(fetchIsPlatformAdmin('u1')).resolves.toBe(true)
    expect(supabase.from).toHaveBeenCalledWith('platform_admins')
  })

  it('is false when there is no row', async () => {
    tables.platform_admins = []
    await expect(fetchIsPlatformAdmin('u1')).resolves.toBe(false)
  })

  it('rejects when the read fails, instead of answering false', async () => {
    failure = { message: 'boom' }
    await expect(fetchIsPlatformAdmin('u1')).rejects.toThrow('boom')
  })
})

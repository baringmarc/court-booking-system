// T13.4: the venues the signed-in user belongs to, for the venue switcher.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  error: null as { message: string } | null,
  tables: [] as string[],
  selects: [] as string[],
  eqs: [] as [string, unknown][],
  orders: [] as string[],
}))

vi.mock('../../lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  chain.select = (s: string) => { h.selects.push(s); return chain }
  chain.order = (c: string) => { h.orders.push(c); return chain }
  chain.eq = (c: string, v: unknown) => { h.eqs.push([c, v]); return chain }
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: h.error ? null : h.rows, error: h.error }).then(resolve)
  return { supabase: { from: (t: string) => { h.tables.push(t); return chain } } }
})

import { fetchMemberVenues } from './api'

beforeEach(() => {
  h.rows = []
  h.error = null
  for (const a of [h.tables, h.selects, h.eqs, h.orders]) a.length = 0
})

describe('fetchMemberVenues (T13.4)', () => {
  it('reads the user\'s own venue_members rows joined to venues and returns {id, slug}', async () => {
    h.rows = [
      { venue_id: 'v-a', venues: { id: 'v-a', slug: 'a-venue' } },
      { venue_id: 'v-b', venues: { id: 'v-b', slug: 'b-venue' } },
    ]
    await expect(fetchMemberVenues('u1')).resolves.toEqual([
      { id: 'v-a', slug: 'a-venue' },
      { id: 'v-b', slug: 'b-venue' },
    ])
    expect(h.tables).toEqual(['venue_members'])
    expect(h.selects[0]).toMatch(/venues/)
    expect(h.eqs).toContainEqual(['user_id', 'u1'])
  })

  it('returns an empty list for a user with no membership', async () => {
    await expect(fetchMemberVenues('u1')).resolves.toEqual([])
  })

  it('throws when the query fails', async () => {
    h.error = { message: 'boom' }
    await expect(fetchMemberVenues('u1')).rejects.toBeTruthy()
  })
})

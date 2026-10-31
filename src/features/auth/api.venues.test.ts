// T12.10: the signed-in user's venues come from their own venue_members rows.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rows: [] as { venue_id: string }[],
  error: null as { message: string } | null,
  tables: [] as string[],
  eqs: [] as [string, unknown][],
}))

vi.mock('../../lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'order', 'limit']) chain[m] = () => chain
  chain.eq = (column: string, value: unknown) => { h.eqs.push([column, value]); return chain }
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: h.error ? null : h.rows, error: h.error }).then(resolve)
  const user = { id: 'u1', email: 'ada@example.com' }
  return {
    supabase: {
      from: (table: string) => { h.tables.push(table); return chain },
      auth: {
        getSession: async () => ({ data: { session: { user } }, error: null }),
        getUser: async () => ({ data: { user }, error: null }),
      },
    },
  }
})

import { fetchAdminVenueIds } from './api'

beforeEach(() => {
  h.rows = []
  h.error = null
  h.tables.length = 0
  h.eqs.length = 0
})

describe('fetchAdminVenueIds', () => {
  it('returns the venue ids of the user\'s venue_members rows, filtered to that user', async () => {
    h.rows = [{ venue_id: 'venue-a' }, { venue_id: 'venue-b' }]
    await expect(fetchAdminVenueIds('u1')).resolves.toEqual(['venue-a', 'venue-b'])
    expect(h.tables).toEqual(['venue_members'])
    expect(h.eqs).toContainEqual(['user_id', 'u1'])
  })

  it('returns an empty list for a user with no membership', async () => {
    await expect(fetchAdminVenueIds('u1')).resolves.toEqual([])
  })

  it('throws when the query fails', async () => {
    h.error = { message: 'boom' }
    await expect(fetchAdminVenueIds('u1')).rejects.toBeTruthy()
  })
})

// T14.7: the setup checklist's two RPCs name the page's venue.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  VENUE: 'a0000000-0000-0000-0000-00000000000a',
  calls: [] as { fn: string; args: unknown }[],
  result: { data: null as unknown, error: null as { message: string; code?: string } | null },
}))

vi.mock('../../lib/currentVenue', () => ({ currentVenueId: () => h.VENUE }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      h.calls.push({ fn, args })
      return Promise.resolve(h.result)
    },
  },
}))

import { fetchSetupStatus, publishVenue, type SetupStatus } from './api'

const status: SetupStatus = {
  items: [
    { key: 'courts', label: 'Add a court', required: true, done: true },
    { key: 'photos', label: 'Add photos', required: false, done: false },
  ],
  ready: false,
}

describe('setup checklist api', () => {
  beforeEach(() => {
    h.calls.length = 0
    h.result = { data: null, error: null }
  })

  it('fetchSetupStatus calls venue_setup_status with the current venue and returns the status', async () => {
    h.result = { data: status, error: null }
    await expect(fetchSetupStatus()).resolves.toEqual(status)
    expect(h.calls).toEqual([{ fn: 'venue_setup_status', args: { p_venue_id: h.VENUE } }])
  })

  it('fetchSetupStatus throws the database error message', async () => {
    h.result = { data: null, error: { message: 'Not allowed.', code: 'P0001' } }
    await expect(fetchSetupStatus()).rejects.toThrow('Not allowed.')
  })

  it('publishVenue calls publish_venue with the current venue', async () => {
    await expect(publishVenue()).resolves.toBeUndefined()
    expect(h.calls).toEqual([{ fn: 'publish_venue', args: { p_venue_id: h.VENUE } }])
  })

  it('publishVenue throws the database error message', async () => {
    h.result = { data: null, error: { message: 'Finish setting up first.', code: 'P0001' } }
    await expect(publishVenue()).rejects.toThrow('Finish setting up first.')
  })
})

// T12.11: the private Realtime topic is per venue, admin:bookings:{venueId}, with the venue from currentVenueId().
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  VENUE: 'a0000000-0000-0000-0000-00000000000a',
  channels: [] as { name: string; config: unknown }[],
  removed: 0,
}))

vi.mock('../../lib/currentVenue', () => ({ currentVenueId: () => h.VENUE }))
vi.mock('../../lib/supabase', () => {
  const channel = (name: string, config: unknown) => {
    h.channels.push({ name, config })
    const ch = { on: () => ch, subscribe: () => ch }
    return ch
  }
  return {
    supabase: {
      channel,
      removeChannel: () => { h.removed += 1; return Promise.resolve('ok') },
      realtime: { setAuth: () => Promise.resolve() },
    },
  }
})

import { subscribeToBookingChanges } from './api'

describe('subscribeToBookingChanges topic (T12.11)', () => {
  beforeEach(() => { h.channels.length = 0; h.removed = 0 })

  it('joins the private channel admin:bookings:{venueId} for the admin venue', async () => {
    const off = subscribeToBookingChanges({ onChange: () => {}, onReconnect: () => {} })
    await vi.waitFor(() => expect(h.channels).toHaveLength(1))
    expect(h.channels[0].name).toBe(`admin:bookings:${h.VENUE}`)
    expect(h.channels[0].config).toEqual({ config: { private: true } })
    off()
  })

  it('never joins the old venue-less admin:bookings topic', async () => {
    const off = subscribeToBookingChanges({ onChange: () => {}, onReconnect: () => {} })
    await vi.waitFor(() => expect(h.channels).toHaveLength(1))
    expect(h.channels.some((c) => c.name === 'admin:bookings')).toBe(false)
    off()
  })

  it('unsubscribing before the venue resolves joins nothing', async () => {
    const off = subscribeToBookingChanges({ onChange: () => {}, onReconnect: () => {} })
    off()
    await new Promise((r) => setTimeout(r, 20))
    expect(h.channels).toHaveLength(0)
  })
})

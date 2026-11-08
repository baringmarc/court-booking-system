// T16.3: Sentry starts only when a DSN is configured, and scrubs every event.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Sentry from '@sentry/react'
import { initSentry } from './sentry.ts'

vi.mock('@sentry/react', () => ({ init: vi.fn(), setTag: vi.fn() }))

beforeEach(() => {
  vi.mocked(Sentry.init).mockReset()
  vi.mocked(Sentry.setTag).mockReset()
})

describe('initSentry', () => {
  it('does nothing and returns false without a DSN', () => {
    expect(initSentry('app', {})).toBe(false)
    expect(Sentry.init).not.toHaveBeenCalled()
    expect(Sentry.setTag).not.toHaveBeenCalled()
  })

  it('treats an empty or blank DSN as absent', () => {
    expect(initSentry('app', { VITE_SENTRY_DSN: '' })).toBe(false)
    expect(initSentry('console', { VITE_SENTRY_DSN: '   ' })).toBe(false)
    expect(Sentry.init).not.toHaveBeenCalled()
  })

  it('inits once with dsn, no default PII and a scrubbing beforeSend, tags the surface, returns true', () => {
    expect(initSentry('console', { VITE_SENTRY_DSN: 'https://k@o.ingest.sentry.io/1' })).toBe(true)
    expect(Sentry.init).toHaveBeenCalledTimes(1)
    const opts = vi.mocked(Sentry.init).mock.calls[0][0] as unknown as {
      dsn: string
      sendDefaultPii: boolean
      beforeSend: (e: object) => Record<string, unknown>
    }
    expect(opts.dsn).toBe('https://k@o.ingest.sentry.io/1')
    expect(opts.sendDefaultPii).toBe(false)
    const scrubbed = opts.beforeSend({ message: 'hi a@b.com', user: { id: '1' } })
    expect(scrubbed.message).toBe('hi [email]')
    expect(scrubbed).not.toHaveProperty('user')
    expect(Sentry.setTag).toHaveBeenCalledWith('surface', 'console')
  })
})

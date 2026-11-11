// T16.3: withSentry wraps an Edge Function handler; a no-op without SENTRY_DSN.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withSentry, type SentrySdk } from './sentry.ts'

function setEnv(vars: Record<string, string>) {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => vars[k] } }
}
function fakeSdk() {
  const tags: Record<string, string> = {}
  const calls: string[] = []
  const sdk = {
    init: vi.fn(() => { calls.push('init') }),
    withScope: vi.fn(<T,>(fn: (s: { setTag(k: string, v: string): void }) => T): T =>
      fn({ setTag: (k, v) => { tags[k] = v } })),
    captureException: vi.fn(() => { calls.push('capture'); return 'id' }),
    flush: vi.fn(async () => { calls.push('flush'); return true }),
  }
  return { sdk: sdk as unknown as SentrySdk & typeof sdk, tags, calls }
}
const req = () => new Request('https://x.test/fn', { method: 'POST' })

afterEach(() => {
  delete (globalThis as { Deno?: unknown }).Deno
  vi.restoreAllMocks()
})

describe('withSentry without SENTRY_DSN', () => {
  it('never touches the sdk, passes all args through and returns the response', async () => {
    setEnv({})
    const { sdk } = fakeSdk()
    const handler = vi.fn(async (_r: Request, extra: string) => new Response(extra, { status: 201 }))
    const res = await withSentry('fn-a', handler, sdk)(req(), 'rest')
    expect(res.status).toBe(201)
    expect(await res.text()).toBe('rest')
    expect(handler).toHaveBeenCalledTimes(1)
    expect(sdk.init).not.toHaveBeenCalled()
    expect(sdk.withScope).not.toHaveBeenCalled()
    expect(sdk.captureException).not.toHaveBeenCalled()
  })

  it('lets a throwing handler error propagate unchanged', async () => {
    setEnv({ SENTRY_DSN: '' })
    const { sdk } = fakeSdk()
    const boom = new Error('boom')
    await expect(withSentry('fn-b', () => { throw boom }, sdk)(req())).rejects.toBe(boom)
    expect(sdk.init).not.toHaveBeenCalled()
    expect(sdk.captureException).not.toHaveBeenCalled()
  })
})

describe('withSentry with SENTRY_DSN', () => {
  it('inits once per process with dsn, no default PII and a scrubbing beforeSend', async () => {
    setEnv({ SENTRY_DSN: 'https://k@o.ingest.sentry.io/2' })
    const { sdk } = fakeSdk()
    const wrapped = withSentry('fn-c', () => new Response('ok'), sdk)
    await wrapped(req())
    await wrapped(req())
    const other = withSentry('fn-d', () => new Response('ok'), sdk)
    await other(req())
    expect(sdk.init).toHaveBeenCalledTimes(1)
    const opts = sdk.init.mock.calls[0] as unknown as [{ dsn: string; sendDefaultPii: boolean; beforeSend: (e: object) => Record<string, unknown> }]
    expect(opts[0].dsn).toBe('https://k@o.ingest.sentry.io/2')
    expect(opts[0].sendDefaultPii).toBe(false)
    const scrubbed = opts[0].beforeSend({ message: 'x a@b.com', request: { cookies: { a: '1' } }, user: { id: 1 } })
    expect(scrubbed.message).toBe('x [email]')
    expect(scrubbed).not.toHaveProperty('user')
    expect(scrubbed.request).not.toHaveProperty('cookies')
  })

  it('runs the handler in a scope tagged function=name and returns its response without capturing', async () => {
    setEnv({ SENTRY_DSN: 'https://k@o.ingest.sentry.io/2' })
    const { sdk, tags } = fakeSdk()
    const handler = vi.fn(async (_r: Request, n: number) => new Response(String(n), { status: 202 }))
    const res = await withSentry('create-checkout', handler, sdk)(req(), 7)
    expect(sdk.withScope).toHaveBeenCalled()
    expect(tags.function).toBe('create-checkout')
    expect(res.status).toBe(202)
    expect(await res.text()).toBe('7')
    expect(sdk.captureException).not.toHaveBeenCalled()
  })

  it('captures a thrown error, awaits flush before rejecting, then rethrows the same error', async () => {
    setEnv({ SENTRY_DSN: 'https://k@o.ingest.sentry.io/2' })
    const { sdk, calls } = fakeSdk()
    const boom = new Error('kaboom')
    let settled = false
    const p = withSentry('fn-e', async () => { throw boom }, sdk)(req()).catch((e: unknown) => { settled = true; calls.push('rejected'); throw e })
    await expect(p).rejects.toBe(boom)
    expect(settled).toBe(true)
    expect(sdk.captureException).toHaveBeenCalledWith(boom)
    expect(sdk.flush).toHaveBeenCalledTimes(1)
    expect(calls.slice(-3)).toEqual(['capture', 'flush', 'rejected'])
  })

  it('also captures errors thrown synchronously by the handler', async () => {
    setEnv({ SENTRY_DSN: 'https://k@o.ingest.sentry.io/2' })
    const { sdk } = fakeSdk()
    const boom = new Error('sync')
    await expect(withSentry('fn-f', () => { throw boom }, sdk)(req())).rejects.toBe(boom)
    expect(sdk.captureException).toHaveBeenCalledWith(boom)
    expect(sdk.flush).toHaveBeenCalled()
  })
})

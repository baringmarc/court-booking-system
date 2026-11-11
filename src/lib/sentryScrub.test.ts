// T16.3: Sentry events never carry emails, phones, tokens, URL hashes, cookies, bodies or the user.
import { describe, expect, it } from 'vitest'
import { scrubEvent } from './sentryScrub.ts'

type Ev = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

describe('scrubEvent strings', () => {
  it('replaces emails in message, exception, breadcrumbs, extra, tags and request', () => {
    const out = scrubEvent({
      message: 'failed for jane.doe+x@example.com today',
      exception: { values: [{ type: 'Error', value: 'bad mail bob@mail.example.org' }] },
      breadcrumbs: [{ message: 'sent to a@b.co', data: { to: 'c@d.io', n: 3 } }],
      extra: { nested: { deep: ['x@y.com'] } },
      tags: { who: 'me@x.com' },
      request: { url: 'https://app.test/p?email=q@r.com', query_string: 'email=q@r.com' },
    } as Ev) as Ev
    expect(out.message).toBe('failed for [email] today')
    expect(out.exception.values[0].value).toBe('bad mail [email]')
    expect(out.breadcrumbs[0].message).toBe('sent to [email]')
    expect(out.breadcrumbs[0].data.to).toBe('[email]')
    expect(out.breadcrumbs[0].data.n).toBe(3)
    expect(out.extra.nested.deep[0]).toBe('[email]')
    expect(out.tags.who).toBe('[email]')
    expect(out.request.url).toBe('https://app.test/p?email=[email]')
    expect(out.request.query_string).toBe('email=[email]')
  })

  it('replaces Philippine phone numbers in the common formats', () => {
    for (const p of ['+63 917 123 4567', '0917-123-4567', '09171234567']) {
      const out = scrubEvent({ message: `call ${p} now` } as Ev) as Ev
      expect(out.message).toBe('call [phone] now')
    }
  })

  it('replaces token, access_token and refresh_token values in queries and hash fragments', () => {
    const out = scrubEvent({
      message: 'a?token=abc123&x=1 b#access_token=def456&refresh_token=ghi789 c#token=zzz',
    } as Ev) as Ev
    expect(out.message).toContain('token=[token]')
    expect(out.message).toContain('x=1')
    expect(out.message).not.toMatch(/abc123|def456|ghi789|zzz/)
    expect(out.message).toContain('access_token=[token]')
    expect(out.message).toContain('refresh_token=[token]')
  })
})

describe('scrubEvent urls and request', () => {
  it('removes the hash from request.url and breadcrumb data url/from/to', () => {
    const out = scrubEvent({
      request: { url: 'https://app.test/auth/callback#access_token=secret&type=signup' },
      breadcrumbs: [
        { category: 'navigation', data: { from: '/a#one', to: '/b#two' } },
        { category: 'fetch', data: { url: 'https://x.test/y#frag' } },
      ],
    } as Ev) as Ev
    expect(out.request.url).toBe('https://app.test/auth/callback')
    expect(out.breadcrumbs[0].data).toEqual({ from: '/a', to: '/b' })
    expect(out.breadcrumbs[1].data.url).toBe('https://x.test/y')
  })

  it('deletes request cookies, data and headers but keeps the url', () => {
    const out = scrubEvent({
      request: { url: 'https://app.test/', cookies: { s: '1' }, data: { pw: 'x' }, headers: { a: 'b' }, method: 'POST' },
    } as Ev) as Ev
    expect(out.request).not.toHaveProperty('cookies')
    expect(out.request).not.toHaveProperty('data')
    expect(out.request).not.toHaveProperty('headers')
    expect(out.request.url).toBe('https://app.test/')
    expect(out.request.method).toBe('POST')
  })

  it('deletes the user', () => {
    const out = scrubEvent({ user: { id: '1', email: 'a@b.com', ip_address: '1.2.3.4' }, message: 'm' } as Ev) as Ev
    expect(out).not.toHaveProperty('user')
    expect(out.message).toBe('m')
  })

  it('leaves a clean event unchanged', () => {
    const clean = {
      message: 'Something broke at court 2',
      level: 'error',
      exception: { values: [{ type: 'TypeError', value: 'x is undefined' }] },
      breadcrumbs: [{ category: 'ui.click', message: 'button.save', data: { n: 2 } }],
      tags: { surface: 'app' },
      request: { url: 'https://app.test/book?date=2026-11-08' },
    }
    expect(scrubEvent(structuredClone(clean))).toEqual(clean)
  })
})

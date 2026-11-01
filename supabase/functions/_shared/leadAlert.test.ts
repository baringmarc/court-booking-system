import { describe, expect, it, vi } from 'vitest'
import type { Contact } from './siteForms.ts'
import siteContactSource from '../site-contact/index.ts?raw'
import { leadAlertEmail, leadAlertRecipients, sendLeadAlert } from './leadAlert.ts'

type Lead = Contact & { id: string }

const lead: Lead = {
  id: 'lead-1',
  firstName: 'Ana',
  lastName: 'Cruz',
  email: 'ana@example.com',
  phone: '09171234567',
  venueName: 'Smash Hub',
  location: 'Cebu City',
  courts: 4,
  facebook: 'https://facebook.com/smashhub',
  message: 'Please call me after 5pm.',
}

type Init = { method: string; headers: Record<string, string>; body: string }
type Resp = { ok: boolean; status: number; text(): Promise<string> }
const okFetch = () => vi.fn<(url: string, init: Init) => Promise<Resp>>(async () => ({ ok: true, status: 200, text: async () => '' }))
const config = { from: 'Plotline <no-reply@plotline.test>', resendKey: 're_1', mailpitUrl: 'http://mailpit:8025' }

describe('leadAlertRecipients', () => {
  it('parses a comma list, trims it and drops invalid addresses', () => {
    expect(leadAlertRecipients(' a@example.com , b@example.com,not-an-email,, c@@x ')).toEqual(['a@example.com', 'b@example.com'])
  })
  it('gives [] when unset or empty', () => {
    expect(leadAlertRecipients(undefined)).toEqual([])
    expect(leadAlertRecipients(null)).toEqual([])
    expect(leadAlertRecipients('')).toEqual([])
    expect(leadAlertRecipients('  ,  ')).toEqual([])
  })
})

describe('leadAlertEmail', () => {
  it('builds the subject from venue name and location', () => {
    expect(leadAlertEmail(lead).subject).toBe('New lead: Smash Hub (Cebu City)')
  })
  it('lists every field in text and html', () => {
    const { text, html } = leadAlertEmail(lead)
    for (const body of [text, html]) {
      for (const v of ['Ana', 'Cruz', 'ana@example.com', '09171234567', 'Smash Hub', 'Cebu City', '4', 'https://facebook.com/smashhub', 'Please call me after 5pm.']) {
        expect(body).toContain(v)
      }
    }
  })
  it('omits empty optional fields', () => {
    const { text, html } = leadAlertEmail({ ...lead, facebook: '', message: '' })
    expect(text).not.toContain('facebook.com')
    expect(html).not.toContain('facebook.com')
    expect(text).not.toContain('Please call me')
    expect(text.toLowerCase()).not.toContain('facebook')
    expect(text.toLowerCase()).not.toContain('message')
  })
  it('HTML-escapes every user-supplied value in html', () => {
    const evil = '<script>alert(1)</script>'
    const { html } = leadAlertEmail({
      ...lead, firstName: evil, lastName: evil, venueName: evil, location: evil, facebook: evil, message: evil, phone: evil,
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
  it('keeps line breaks out of the subject', () => {
    const { subject } = leadAlertEmail({ ...lead, venueName: 'Smash\r\nBcc: x@evil.test', location: 'Ce\nbu' })
    expect(subject).not.toMatch(/[\r\n]/)
    expect(subject.startsWith('New lead: Smash')).toBe(true)
  })
})

describe('sendLeadAlert', () => {
  it('sends one email per recipient with a lead-scoped idempotency key (resend)', async () => {
    const fetchFn = okFetch()
    const log = vi.fn()
    const result = await sendLeadAlert({ lead, to: 'a@example.com, b@example.com', transport: 'resend', config, fetchFn, log })
    expect(result).toBe('sent')
    expect(fetchFn).toHaveBeenCalledTimes(2)
    const calls = fetchFn.mock.calls.map(([, init]) => ({ body: JSON.parse(init.body), key: init.headers['Idempotency-Key'] }))
    expect(calls.map((c) => c.body.to)).toEqual([['a@example.com'], ['b@example.com']])
    expect(calls[0].body.subject).toBe('New lead: Smash Hub (Cebu City)')
    for (const c of calls) expect(c.key.startsWith('lead-alert-lead-1')).toBe(true)
    expect(new Set(calls.map((c) => c.key)).size).toBe(2)
  })
  it('sends through Mailpit too', async () => {
    const fetchFn = okFetch()
    expect(await sendLeadAlert({ lead, to: 'a@example.com', transport: 'mailpit', config, fetchFn })).toBe('sent')
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn.mock.calls[0][0]).toBe('http://mailpit:8025/api/v1/send')
  })
  it.each([
    ['no recipients', 'resend' as const, undefined],
    ['empty recipients', 'resend' as const, ' , '],
    ['disabled transport', 'disabled' as const, 'a@example.com'],
    ['unavailable transport', 'unavailable' as const, 'a@example.com'],
  ])('skips and logs with no fetch call: %s', async (_name, transport, to) => {
    const fetchFn = okFetch()
    const log = vi.fn()
    expect(await sendLeadAlert({ lead, to, transport, config, fetchFn, log })).toBe('skipped')
    expect(fetchFn).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalled()
  })
  it('returns failed and logs when the provider rejects', async () => {
    const fetchFn = vi.fn<(url: string, init: Init) => Promise<Resp>>(async () => ({ ok: false, status: 500, text: async () => 'boom' }))
    const log = vi.fn()
    expect(await sendLeadAlert({ lead, to: 'a@example.com', transport: 'resend', config, fetchFn, log })).toBe('failed')
    expect(log).toHaveBeenCalled()
  })
  it('never throws when fetch throws or log is missing', async () => {
    const fetchFn = vi.fn<(url: string, init: Init) => Promise<Resp>>(async () => {
      throw new Error('network down')
    })
    await expect(sendLeadAlert({ lead, to: 'a@example.com', transport: 'resend', config, fetchFn })).resolves.toBe('failed')
  })
})

describe('site-contact wiring', () => {
  const src: string = siteContactSource
  it('alerts only after the insert succeeded, and never fails the request over it', () => {
    const insert = src.indexOf(".from('leads').insert")
    const errorReturn = src.indexOf('if (error)')
    const alert = src.search(/sendLeadAlert\s*\(/)
    expect(insert).toBeGreaterThan(-1)
    expect(alert).toBeGreaterThan(errorReturn)
    expect(errorReturn).toBeGreaterThan(insert)
    expect(src).toContain('LEAD_ALERT_TO')
  })
})

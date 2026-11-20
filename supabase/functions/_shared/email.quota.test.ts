// T30.3: Resend's quota errors, the send order and the reminder check of emailAction.
import { describe, expect, it, vi } from 'vitest'
import { emailAction, sendEmail, sendOrder } from './email.ts'
import type { EmailKind } from './emailTemplates.ts'

const email = { to: 'gina@example.com', subject: 'S', html: '<p>H</p>', text: 'T' }
const response = (status: number, body = '') => ({ ok: status >= 200 && status < 300, status, text: async () => body })
const send = (res: ReturnType<typeof response>, transport: 'resend' | 'mailpit' = 'resend') =>
  sendEmail(vi.fn().mockResolvedValue(res), transport, { resendKey: 're_1', mailpitUrl: 'http://mailpit:8025' }, email, 'row-1')

describe('sendEmail quota errors (T30.3)', () => {
  it('reports a daily quota 429 with quota "daily"', async () => {
    const body = '{"statusCode":429,"name":"daily_quota_exceeded","message":"You have reached your daily email sending quota."}'
    expect(await send(response(429, body))).toEqual({ ok: false, error: `Resend 429: ${body}`, quota: 'daily' })
  })

  it('reports a monthly quota 429 with quota "monthly"', async () => {
    const body = '{"statusCode":429,"name":"monthly_quota_exceeded","message":"You have reached your monthly email sending quota."}'
    expect(await send(response(429, body))).toEqual({ ok: false, error: `Resend 429: ${body}`, quota: 'monthly' })
  })

  it('reads the quota name from the whole body, not only the 300 characters kept in the error', async () => {
    const body = `${' '.repeat(400)}{"name":"daily_quota_exceeded"}`
    const result = await send(response(429, body))
    expect(result).toMatchObject({ ok: false, quota: 'daily' })
    expect((result as { error: string }).error).toBe(`Resend 429: ${body.slice(0, 300)}`)
  })

  it('has no quota on any other 429 (a rate limit is retried the usual way)', async () => {
    const result = await send(response(429, '{"name":"rate_limit_exceeded","message":"Too many requests"}'))
    expect(result).toEqual({ ok: false, error: 'Resend 429: {"name":"rate_limit_exceeded","message":"Too many requests"}' })
    expect(result).not.toHaveProperty('quota')
    expect(await send(response(429, ''))).not.toHaveProperty('quota')
  })

  it('has no quota on a non-429 error, even if the body mentions one', async () => {
    const result = await send(response(500, 'daily_quota_exceeded'))
    expect(result).toEqual({ ok: false, error: 'Resend 500: daily_quota_exceeded' })
    expect(result).not.toHaveProperty('quota')
  })

  it('leaves the other results as they were (200, 409, thrown, Mailpit)', async () => {
    expect(await send(response(200, '{"id":"e1"}'))).toEqual({ ok: true })
    expect((await send(response(409, '{"name":"invalid_idempotent_request"}'))).ok).toBe(true)
    expect(await sendEmail(vi.fn().mockRejectedValue(new Error('network down')), 'resend', { resendKey: 're_1' }, email, 'r')).toEqual({
      ok: false,
      error: 'Send failed: network down',
    })
    expect(await send(response(429, 'daily_quota_exceeded'), 'mailpit')).not.toHaveProperty('quota')
  })
})

describe('sendOrder (T30.3)', () => {
  const row = (id: string, kind: EmailKind) => ({ id, kind })

  it('puts every booking_reminder after all other rows and keeps each group in its order', () => {
    const rows = [
      row('r1', 'booking_reminder'),
      row('c1', 'booking_created'),
      row('r2', 'booking_reminder'),
      row('p1', 'payment_confirmed'),
      row('x1', 'booking_cancelled'),
      row('r3', 'booking_reminder'),
      row('m1', 'booking_rescheduled'),
    ]
    expect(sendOrder(rows).map((r) => r.id)).toEqual(['c1', 'p1', 'x1', 'm1', 'r1', 'r2', 'r3'])
  })

  it('does not change the input array', () => {
    const rows = [row('r1', 'booking_reminder'), row('c1', 'booking_created')]
    const copy = [...rows]
    const out = sendOrder(rows)
    expect(rows).toEqual(copy)
    expect(out).not.toBe(rows)
  })

  it('handles an empty list and a list without reminders', () => {
    expect(sendOrder([])).toEqual([])
    const rows = [row('b', 'payment_confirmed'), row('a', 'booking_created')]
    expect(sendOrder(rows).map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('keeps the extra fields of each row', () => {
    const rows = [{ id: 'r', kind: 'booking_reminder' as const, extra: 1 }, { id: 'c', kind: 'booking_created' as const, extra: 2 }]
    expect(sendOrder(rows)).toEqual([rows[1], rows[0]])
  })
})

describe('emailAction with the reminder check (T30.3)', () => {
  const STARTS = '2030-01-07T10:00:00.000Z'
  const ok = { snapshotStartsAt: STARTS, bookingStartsAt: '2030-01-07T10:00:00+00:00', now: new Date('2030-01-06T10:00:00Z') }

  it('sends a reminder for a confirmed booking at the same time, before it starts', () => {
    expect(emailAction('resend', 'booking_reminder', 'confirmed', ok)).toEqual({ action: 'send' })
    expect(emailAction('mailpit', 'booking_reminder', 'confirmed')).toEqual({ action: 'send' })
  })

  it('skips a reminder for a booking that is no longer confirmed, with an "Overtaken:" reason', () => {
    const result = emailAction('resend', 'booking_reminder', 'cancelled', ok)
    expect(result.action).toBe('skip')
    expect((result as { reason: string }).reason).toMatch(/^Overtaken:/)
  })

  it('skips a reminder whose booking moved, with an "Overtaken:" reason', () => {
    const result = emailAction('resend', 'booking_reminder', 'confirmed', { ...ok, bookingStartsAt: '2030-01-08T10:00:00.000Z' })
    expect(result.action).toBe('skip')
    expect((result as { reason: string }).reason).toMatch(/^Overtaken:/)
  })

  it('skips a reminder once the booking has started, with an "Overtaken:" reason', () => {
    const result = emailAction('resend', 'booking_reminder', 'confirmed', { ...ok, now: new Date('2030-01-07T10:00:00Z') })
    expect(result.action).toBe('skip')
    expect((result as { reason: string }).reason).toMatch(/^Overtaken:/)
  })

  it('still skips everything while the transport is disabled', () => {
    expect(emailAction('disabled', 'booking_reminder', 'confirmed', ok)).toEqual({ action: 'skip', reason: 'Email is turned off (EMAIL_TRANSPORT=disabled).' })
  })

  it('leaves the other kinds as they were', () => {
    expect(emailAction('mailpit', 'booking_created', 'cancelled', ok)).toEqual({ action: 'skip', reason: 'Overtaken: the booking is cancelled.' })
    expect(emailAction('mailpit', 'booking_cancelled', 'cancelled', ok)).toEqual({ action: 'send' })
    expect(emailAction('mailpit', 'booking_rescheduled', 'confirmed', { ...ok, bookingStartsAt: '2031-01-01T00:00:00Z' })).toEqual({ action: 'send' })
  })
})

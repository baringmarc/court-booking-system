import { describe, expect, it, vi } from 'vitest'
import { sendEmail } from './email.ts'

// T26.4: one invoice email goes to every owner of a venue.
const email = { to: ['a@example.com', 'b@example.com'], subject: 'S', html: '<p>H</p>', text: 'T' }
const response = (status: number, body = '') => ({ ok: status >= 200 && status < 300, status, text: async () => body })

describe('sendEmail with several recipients', () => {
  it('lists every address in one Resend message', async () => {
    const fetchFn = vi.fn().mockResolvedValue(response(200, '{"id":"e1"}'))
    expect(await sendEmail(fetchFn, 'resend', { resendKey: 're_1' }, email, 'k')).toEqual({ ok: true })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).to).toEqual(['a@example.com', 'b@example.com'])
  })
  it('lists every address in one Mailpit message', async () => {
    const fetchFn = vi.fn().mockResolvedValue(response(200, '{}'))
    await sendEmail(fetchFn, 'mailpit', { mailpitUrl: 'http://mailpit:8025' }, email, 'k')
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).To).toEqual([{ Email: 'a@example.com' }, { Email: 'b@example.com' }])
  })
})

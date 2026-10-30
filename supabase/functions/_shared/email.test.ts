import { describe, expect, it, vi } from 'vitest'
import { emailAction, emailTransport, fromFor, LOCAL_WORKER_SECRET, parseFrom, RESEND_API, sendEmail, workerAuthorized, workerSecret } from './email.ts'

const LOCAL = 'http://kong:8000'
const HOSTED = 'https://abc.supabase.co'

describe('emailTransport', () => {
  it('defaults to Mailpit locally and to disabled on the hosted project', () => {
    expect(emailTransport({ supabaseUrl: LOCAL, mailpitUrl: 'http://mailpit:8025' })).toBe('mailpit')
    expect(emailTransport({ supabaseUrl: HOSTED })).toBe('disabled')
    expect(emailTransport({ transport: 'disabled', supabaseUrl: LOCAL })).toBe('disabled')
  })

  it('needs a key for Resend', () => {
    expect(emailTransport({ transport: 'resend', resendKey: 're_123', supabaseUrl: HOSTED })).toBe('resend')
    expect(emailTransport({ transport: 'resend', resendKey: ' ', supabaseUrl: HOSTED })).toBe('unavailable')
  })

  it('never uses Mailpit on the hosted project, and treats a typo as unavailable', () => {
    expect(emailTransport({ transport: 'mailpit', mailpitUrl: 'http://mailpit:8025', supabaseUrl: HOSTED })).toBe('unavailable')
    expect(emailTransport({ transport: 'mailpit', supabaseUrl: LOCAL })).toBe('unavailable')
    expect(emailTransport({ transport: 'resned', resendKey: 're_1', supabaseUrl: HOSTED })).toBe('unavailable')
  })
})

describe('emailAction', () => {
  it('skips everything while email is disabled (the hosted default)', () => {
    expect(emailAction('disabled', 'payment_confirmed', 'confirmed')).toEqual({ action: 'skip', reason: 'Email is turned off (EMAIL_TRANSPORT=disabled).' })
    expect(emailAction('disabled', 'booking_created', 'pending_payment').action).toBe('skip')
  })

  it('skips a booking_created that a later event overtook, and sends the rest', () => {
    expect(emailAction('mailpit', 'booking_created', 'cancelled')).toEqual({ action: 'skip', reason: 'Overtaken: the booking is cancelled.' })
    expect(emailAction('resend', 'booking_created', 'confirmed')).toEqual({ action: 'send' })
    expect(emailAction('mailpit', 'booking_cancelled', 'cancelled')).toEqual({ action: 'send' })
  })
})

describe('worker secret', () => {
  it('refuses the committed local secret on the hosted project', () => {
    expect(workerSecret({ secret: LOCAL_WORKER_SECRET, supabaseUrl: LOCAL })).toBe(LOCAL_WORKER_SECRET)
    expect(workerSecret({ secret: LOCAL_WORKER_SECRET, supabaseUrl: HOSTED })).toBeNull()
    expect(workerSecret({ secret: 'real-secret', supabaseUrl: HOSTED })).toBe('real-secret')
    expect(workerSecret({ secret: '', supabaseUrl: LOCAL })).toBeNull()
  })

  it('checks the header', () => {
    expect(workerAuthorized('s3cret', 's3cret')).toBe(true)
    expect(workerAuthorized('s3cres', 's3cret')).toBe(false)
    expect(workerAuthorized(null, 's3cret')).toBe(false)
  })
})

describe('parseFrom', () => {
  it('reads "Name <address>" and bare addresses', () => {
    expect(parseFrom('Claudex Courts <hi@claudex.test>')).toEqual({ name: 'Claudex Courts', email: 'hi@claudex.test' })
    expect(parseFrom('hi@claudex.test')).toEqual({ name: '', email: 'hi@claudex.test' })
    expect(parseFrom(undefined).email).toBe('no-reply@claudex.test')
  })
})

const email = { to: 'gina@example.com', subject: 'S', html: '<p>H</p>', text: 'T' }
const response = (status: number, body = '') => ({ ok: status >= 200 && status < 300, status, text: async () => body })

describe('sendEmail', () => {
  it('sends through Resend with the outbox id as idempotency key', async () => {
    const fetchFn = vi.fn().mockResolvedValue(response(200, '{"id":"e1"}'))
    const result = await sendEmail(fetchFn, 'resend', { resendKey: 're_1', from: 'Claudex <hi@claudex.test>' }, email, 'row-1')
    expect(result).toEqual({ ok: true })
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe(RESEND_API)
    expect(init.headers).toMatchObject({ Authorization: 'Bearer re_1', 'Idempotency-Key': 'row-1' })
    expect(JSON.parse(init.body)).toMatchObject({ from: 'Claudex <hi@claudex.test>', to: ['gina@example.com'], subject: 'S' })
  })

  it('counts a Resend 409 (idempotency key reused) as sent', async () => {
    const fetchFn = vi.fn().mockResolvedValue(response(409, '{"name":"invalid_idempotent_request"}'))
    const result = await sendEmail(fetchFn, 'resend', { resendKey: 're_1' }, email, 'row-1')
    expect(result.ok).toBe(true)
  })

  it('reports other failures for a retry', async () => {
    expect(await sendEmail(vi.fn().mockResolvedValue(response(500, 'boom')), 'resend', { resendKey: 're_1' }, email, 'r')).toEqual({
      ok: false,
      error: 'Resend 500: boom',
    })
    const thrown = await sendEmail(vi.fn().mockRejectedValue(new Error('network down')), 'resend', { resendKey: 're_1' }, email, 'r')
    expect(thrown).toEqual({ ok: false, error: 'Send failed: network down' })
  })

  it("posts to Mailpit's send API locally", async () => {
    const fetchFn = vi.fn().mockResolvedValue(response(200, '{"ID":"m1"}'))
    const result = await sendEmail(fetchFn, 'mailpit', { mailpitUrl: 'http://mailpit:8025/' }, email, 'row-2')
    expect(result).toEqual({ ok: true })
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('http://mailpit:8025/api/v1/send')
    expect(JSON.parse(init.body)).toMatchObject({ To: [{ Email: 'gina@example.com' }], Subject: 'S', Text: 'T', From: { Email: 'no-reply@claudex.test' } })
  })
})

describe('fromFor', () => {
  const addr = 'bookings@mail.plotline.fit'
  it('puts the venue name on the bare sender address and round-trips through parseFrom', () => {
    const from = fromFor('Claudex Courts', addr)
    expect(from).toBe(`Claudex Courts <${addr}>`)
    expect(parseFrom(from)).toEqual({ name: 'Claudex Courts', email: addr })
  })
  it('uses only the address part when EMAIL_FROM is still in "Name <addr>" form', () => {
    expect(parseFrom(fromFor('Padel Hub', `Old Name <${addr}>`))).toEqual({ name: 'Padel Hub', email: addr })
  })
  it('falls back to the bare address when the venue name is empty or missing', () => {
    for (const name of [null, undefined, '', '   ']) expect(parseFrom(fromFor(name, addr))).toEqual({ name: '', email: addr })
  })
  it('falls back to the default address when the address is missing', () => {
    expect(parseFrom(fromFor('Padel Hub', null))).toEqual({ name: 'Padel Hub', email: 'no-reply@claudex.test' })
    expect(parseFrom(fromFor('Padel Hub', undefined)).email).toBe('no-reply@claudex.test')
  })
  it('sanitizes the venue name so it cannot break the header', () => {
    const from = fromFor('Evil" <x@y.z>\r\nBcc: a@b.c', addr)
    expect(from).not.toMatch(/[\r\n]/)
    const parsed = parseFrom(from)
    expect(parsed.email).toBe(addr)
    expect(parsed.name).not.toMatch(/[<>"\r\n]/)
    expect(from.match(/</g)).toHaveLength(1)
  })
  it('trims and caps the name at 60 characters', () => {
    const parsed = parseFrom(fromFor(`  ${'A'.repeat(100)}  `, addr))
    expect(parsed.name).toBe('A'.repeat(60))
    expect(parsed.email).toBe(addr)
  })
})

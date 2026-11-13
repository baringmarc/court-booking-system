// T26.6: fetchInvoicePdf and sendInvoice call the invoice-pdf Edge Function with { invoice_id, action }; a refusal
// becomes ApiError(message, httpStatus, functionCode) so the UI can branch on `hint`.
import { FunctionsHttpError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }))

const { supabase } = await import('../../lib/supabase')
// Cast until T26.6 adds the two functions, so the file type-checks while red.
const { fetchInvoicePdf, sendInvoice } = (await import('./api')) as unknown as {
  fetchInvoicePdf: (invoiceId: string) => Promise<Blob>
  sendInvoice: (invoiceId: string) => Promise<{ recipients: string[]; kind: 'send' | 'resend'; status: 'draft' | 'sent' }>
}

beforeEach(() => {
  vi.mocked(supabase.functions.invoke).mockReset()
})

function refusal(status: number, body: unknown) {
  return { data: null, error: new FunctionsHttpError(new Response(JSON.stringify(body), { status })) } as never
}

describe('fetchInvoicePdf (T26.6)', () => {
  it('invokes invoice-pdf with the pdf action and returns the Blob', async () => {
    const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' })
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: blob, error: null } as never)
    expect(await fetchInvoicePdf('inv-1')).toBe(blob)
    expect(supabase.functions.invoke).toHaveBeenCalledWith('invoice-pdf', { body: { invoice_id: 'inv-1', action: 'pdf' } })
  })

  it('throws ApiError(message, status, code) when the function refuses', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue(refusal(403, { code: 'forbidden', message: "You can't open this invoice." }))
    await expect(fetchInvoicePdf('inv-1')).rejects.toMatchObject({ name: 'ApiError', message: "You can't open this invoice.", code: '403', hint: 'forbidden' })
  })
})

describe('sendInvoice (T26.6)', () => {
  it('invokes invoice-pdf with the send action and returns recipients, kind and status', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: { ok: true, recipients: ['a@x.com', 'b@y.com'], kind: 'send', status: 'sent' }, error: null,
    } as never)
    expect(await sendInvoice('inv-1')).toEqual({ recipients: ['a@x.com', 'b@y.com'], kind: 'send', status: 'sent' })
    expect(supabase.functions.invoke).toHaveBeenCalledWith('invoice-pdf', { body: { invoice_id: 'inv-1', action: 'send' } })
  })

  it('passes a resend through unchanged', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: { ok: true, recipients: ['a@x.com'], kind: 'resend', status: 'sent' }, error: null,
    } as never)
    expect(await sendInvoice('inv-1')).toEqual({ recipients: ['a@x.com'], kind: 'resend', status: 'sent' })
  })

  it.each([
    [409, 'billing_details_missing', 'Add a Plotline payment account first.'],
    [409, 'no_recipients', 'This venue has no owner to send the invoice to.'],
    [409, 'invalid_status', 'A paid invoice is not sent.'],
    [502, 'send_failed', "We couldn't send the email."],
    [403, 'forbidden', 'Only platform admins send invoices.'],
  ])('maps the %s refusal %s to ApiError with the function code in hint', async (status, code, message) => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue(refusal(status, { code, message }))
    await expect(sendInvoice('inv-1')).rejects.toMatchObject({ name: 'ApiError', message, code: String(status), hint: code })
  })

  it('throws a connection ApiError when the function cannot be reached', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: null, error: new Error('network') } as never)
    await expect(sendInvoice('inv-1')).rejects.toMatchObject({ name: 'ApiError', message: expect.stringMatching(/could not reach the server/i) })
  })
})

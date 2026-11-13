// T26.7: fetchStatementInvoicePdf calls the invoice-pdf function the same way the console does; a refusal becomes
// ApiError(message, httpStatus, functionCode).
import { FunctionsHttpError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }))

const { supabase } = await import('../../lib/supabase')
// Cast until T26.7 adds the function, so the file type-checks while red.
const { fetchStatementInvoicePdf } = (await import('./api')) as unknown as {
  fetchStatementInvoicePdf: (invoiceId: string) => Promise<Blob>
}

beforeEach(() => {
  vi.mocked(supabase.functions.invoke).mockReset()
})

function refusal(status: number, body: unknown) {
  return { data: null, error: new FunctionsHttpError(new Response(JSON.stringify(body), { status })) } as never
}

describe('fetchStatementInvoicePdf (T26.7)', () => {
  it('invokes invoice-pdf with the pdf action and returns the Blob', async () => {
    const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' })
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: blob, error: null } as never)
    expect(await fetchStatementInvoicePdf('inv-1')).toBe(blob)
    expect(supabase.functions.invoke).toHaveBeenCalledWith('invoice-pdf', { body: { invoice_id: 'inv-1', action: 'pdf' } })
  })

  it('throws ApiError("We couldn\'t open the invoice PDF.") when the result is not a Blob', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { ok: true }, error: null } as never)
    await expect(fetchStatementInvoicePdf('inv-1')).rejects.toMatchObject({ name: 'ApiError', message: "We couldn't open the invoice PDF." })
  })

  it('throws ApiError(message, status, code) when the function refuses', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue(refusal(403, { code: 'forbidden', message: "You can't open this invoice." }))
    await expect(fetchStatementInvoicePdf('inv-1')).rejects.toMatchObject({ name: 'ApiError', message: "You can't open this invoice.", code: '403', hint: 'forbidden' })
  })

  it('throws a connection ApiError when the function cannot be reached', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: null, error: new Error('network') } as never)
    await expect(fetchStatementInvoicePdf('inv-1')).rejects.toMatchObject({ name: 'ApiError', message: expect.stringMatching(/could not reach the server/i) })
  })
})

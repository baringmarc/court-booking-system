import { describe, expect, it } from 'vitest'
import type { ExportBooking, ExportPayment } from './api'
import { bookingsCsv, csvCell, csvTime, paymentsCsv, toCsv } from './csv'

const TZ = 'Asia/Manila'
const lines = (text: string) => text.replace(/^\uFEFF/, '').split('\r\n')

describe('csvCell', () => {
  it('quotes every cell and doubles quotes inside', () => {
    expect(csvCell('Court 1')).toBe('"Court 1"')
    expect(csvCell('She said "hi"')).toBe('"She said ""hi"""')
    expect(csvCell('a, b')).toBe('"a, b"')
    expect(csvCell('line 1\nline 2')).toBe('"line 1\nline 2"')
    expect(csvCell(null)).toBe('""')
    expect(csvCell('')).toBe('""')
  })

  it('writes numbers as they are', () => {
    expect(csvCell(350)).toBe('"350"')
    expect(csvCell(12.5)).toBe('"12.5"')
  })

  it('defuses text that would start a formula', () => {
    for (const start of ['=', '+', '-', '@', '\t', '\r', '\n', '＝', '＋', '－', '＠']) {
      expect(csvCell(`${start}SUM(A1)`)).toBe(`"'${start}SUM(A1)"`)
    }
    expect(csvCell('  =1+1')).toBe(`"'  =1+1"`) // after leading spaces too
    expect(csvCell('+63 917 555 0000')).toBe(`"'+63 917 555 0000"`)
    expect(csvCell('a=b')).toBe('"a=b"') // only at the start
  })

  it('keeps the peso sign and other Unicode as is', () => {
    expect(csvCell('₱350 · Peña')).toBe('"₱350 · Peña"')
  })
})

describe('toCsv', () => {
  it('starts with a BOM and ends every line with CRLF', () => {
    const text = toCsv(['a', 'b'], [['1', 2]])
    expect(text.startsWith('\uFEFF')).toBe(true)
    expect(text).toBe('\uFEFF"a","b"\r\n"1","2"\r\n')
  })

  it('writes only the headers for an empty range', () => {
    expect(toCsv(['a'], [])).toBe('\uFEFF"a"\r\n')
  })
})

describe('csvTime', () => {
  it('writes the venue-local time', () => {
    expect(csvTime('2026-10-24T16:30:00.000Z', TZ)).toBe('2026-10-25 00:30')
    expect(csvTime(null, TZ)).toBeNull()
  })
})

const booking: ExportBooking = {
  reference_code: 'CB-ABC234', court_name: 'Court "A"', sport: 'badminton',
  slot_start: '2026-10-25T06:00:00.000Z', slot_end: '2026-10-25T08:00:00.000Z',
  status: 'confirmed', source: 'walk_in', expires_at: null,
  guest_name: '=HYPERLINK("x")', guest_phone: '+63 917 000 0000', guest_email: 'ana@example.com', total_amount: 700,
}

describe('bookingsCsv', () => {
  it('lists bookings by play time without contact details by default', () => {
    const [header, row, end] = lines(bookingsCsv([booking], { timeZone: TZ, currency: 'PHP', includeContact: false, now: new Date('2026-10-25T00:00:00Z') }))
    expect(header).toBe('"reference","court","sport","start (Asia/Manila)","end (Asia/Manila)","status","source","name","amount_php"')
    expect(row).toBe(`"CB-ABC234","Court ""A""","Badminton","2026-10-25 14:00","2026-10-25 16:00","Confirmed","Walk-in","'=HYPERLINK(""x"")","700"`)
    expect(end).toBe('')
  })

  it('adds phone and email when asked, defused', () => {
    const [header, row] = lines(bookingsCsv([booking], { timeZone: TZ, currency: 'PHP', includeContact: true, now: new Date('2026-10-25T00:00:00Z') }))
    expect(header).toContain('"name","phone","email","amount_php"')
    expect(row).toContain(`"'+63 917 000 0000","ana@example.com","700"`)
  })

  it('shows a played booking as completed', () => {
    const [, row] = lines(bookingsCsv([booking], { timeZone: TZ, currency: 'PHP', includeContact: false, now: new Date('2026-10-26T00:00:00Z') }))
    expect(row).toContain('"Completed"')
  })
})

describe('paymentsCsv', () => {
  const payment: ExportPayment = {
    booking_reference: 'CB-ABC234', method: 'gcash', amount: 350, reference_number: '1234 5678',
    received_at: '2026-10-25T03:15:00.000Z', review_status: 'approved',
  }

  it('lists payments by received time, accepted or refund due', () => {
    const text = paymentsCsv([payment, { ...payment, method: 'paymongo', review_status: 'rejected', reference_number: null }], { timeZone: TZ, currency: 'PHP' })
    expect(lines(text)).toEqual([
      '"booking reference","method","amount_php","reference number","received (Asia/Manila)","status"',
      '"CB-ABC234","GCash","350","1234 5678","2026-10-25 11:15","Accepted"',
      '"CB-ABC234","PayMongo","350","","2026-10-25 11:15","Refund due"',
      '',
    ])
  })

  it('writes just the header for an empty range', () => {
    expect(lines(paymentsCsv([], { timeZone: TZ, currency: 'PHP' }))).toHaveLength(2)
  })
})

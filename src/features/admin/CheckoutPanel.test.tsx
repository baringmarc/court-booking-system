// T33.6: the one "Checkout CB-<lead>" panel staff see for a booking group (SPEC §7 `/admin/bookings`, "Bookings in a group
// (M33; T33.4, reworked in T33.6)"; §10 2026-11-25 "Checkout panel"). Presentational: the customer and sums, the courts list
// with a Manage button per court (one open at a time, its own actions come from `renderCourt`), the payments and the
// proof once, and ONE review for the whole checkout. This replaces ReviewPanel's T33.4 `group` prop and its tests.
// Fixture: the lead CB-LEAD01 (Badminton 1, 7 AM–8 AM on Jan 7 in Manila, ₱350 + ₱10 fee = ₱360 due, the proof file on its
// payment) and CB-PART02 (Tennis Court, 11 PM–1 AM, ₱700 due, no fee): 2 courts, court price ₱1,050, checkout total ₱1,060.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import type { AdminBooking, AdminGroup, AdminPayment } from './api'
import { CheckoutPanel } from './CheckoutPanel'
import type { ProofLink } from './ReviewPanel'

const payment = (id: string, overrides: Partial<AdminPayment> = {}): AdminPayment => ({
  id, method: 'gcash', amount: 360, reference_number: '1234', storage_path: null, submitted_at: '2030-01-06T19:10:00.000Z',
  review_status: 'pending', review_note: null, reviewed_at: null, reviewed_by: null, provider_payment_id: null, provider_source: null,
  ...overrides,
})
const leadPayment = payment('pa', { amount: 360, storage_path: 'a/proof.png' })
const partPayment = payment('pb', { amount: 700 })

const lead: AdminBooking = {
  id: 'a', reference_code: 'CB-LEAD01', court_id: 'c1', court_name: 'Badminton 1', sport: 'badminton',
  slot_start: '2030-01-06T23:00:00.000Z', slot_end: '2030-01-07T00:00:00.000Z', status: 'payment_submitted', source: 'online',
  total_amount: 350, booking_fee: 10, amount_due: 360, expires_at: null, rejection_count: 0, guest_name: 'Gina Guest',
  guest_email: 'gina@example.com', guest_phone: '09171111111', created_at: '2030-01-06T15:00:00.000Z', payments: [leadPayment], refunds: [],
  cancelled_at: null, cancel_reason: null, cancelled_by_venue: false, parent_booking_id: null, booking_group_id: 'g1', group_lead_id: 'a',
}
const part: AdminBooking = {
  ...lead, id: 'b', reference_code: 'CB-PART02', court_id: 'c2', court_name: 'Tennis Court', sport: 'tennis',
  slot_start: '2030-01-07T15:00:00.000Z', slot_end: '2030-01-07T17:00:00.000Z', total_amount: 700, booking_fee: 0, amount_due: 700,
  payments: [partPayment], guest_name: 'Pat Other', guest_email: 'pat@example.com', guest_phone: '09172222222',
}
const group = (bookings: AdminBooking[] = [lead, part], leadRef = 'CB-LEAD01'): AdminGroup => ({ id: 'g1', lead_reference_code: leadRef, bookings })
const NOW = new Date('2030-01-06T20:00:00.000Z')

type Overrides = Partial<{
  group: AdminGroup; openId: string | null; proof: ProofLink; pending: boolean; error: unknown
}>

function renderPanel(overrides: Overrides = {}) {
  const onOpen = vi.fn()
  const onApprove = vi.fn()
  const onReject = vi.fn()
  const renderCourt = vi.fn((b: AdminBooking) => <div data-testid={`court-${b.id}`}>Actions of {b.reference_code}</div>)
  render(
    <CheckoutPanel group={overrides.group ?? group()} openId={overrides.openId ?? null} onOpen={onOpen} timeZone="Asia/Manila" currency="PHP"
      proof={overrides.proof ?? { state: 'ready', url: 'https://signed/proof' }} pending={overrides.pending ?? false} error={overrides.error ?? null}
      onApprove={onApprove} onReject={onReject} now={NOW} renderCourt={renderCourt} />,
  )
  return { onOpen, onApprove, onReject, renderCourt }
}
const panel = () => screen.getByRole('region', { name: 'Checkout CB-LEAD01' })
const courtsList = () => within(panel()).getByRole('list', { name: 'Bookings in this checkout' })
const fact = (label: string) => within(panel()).getByText(label, { selector: 'dt' }).nextElementSibling
const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('the heading, status and facts', () => {
  it('is the region and the h2 "Checkout CB-<lead>"', () => {
    renderPanel()
    expect(panel()).toBeInTheDocument()
    expect(within(panel()).getByRole('heading', { level: 2, name: 'Checkout CB-LEAD01' })).toBeInTheDocument()
  })

  it('shows the group’s status badge (groupDisplayStatus over the courts), not a court’s own', () => {
    // One court confirmed, one cancelled: the group reads "Confirmed"; the cancelled court's own badge stays in the list.
    renderPanel({ group: group([{ ...lead, status: 'confirmed' }, { ...part, status: 'cancelled' }]) })
    const outside = within(panel()).getAllByText('Confirmed').filter((el) => !courtsList().contains(el))
    expect(outside).toHaveLength(1)
    expect(outside[0]).toHaveClass('badge')
    expect(within(courtsList()).getByText('Cancelled')).toBeInTheDocument()
    expect(within(courtsList()).getAllByText('Confirmed')).toHaveLength(1)
  })

  it('says "Payment under review" for the group while any court is under review', () => {
    renderPanel()
    const outside = within(panel()).getAllByText('Payment under review').filter((el) => !courtsList().contains(el))
    expect(outside).toHaveLength(1)
  })

  it('shows Customer, Phone and Email from the lead booking, the court whose reference is lead_reference_code', () => {
    // Pat's court starts first here, but Gina's is the lead.
    renderPanel({ group: group([{ ...part, slot_start: '2030-01-06T05:00:00.000Z', slot_end: '2030-01-06T06:00:00.000Z' }, lead]) })
    expect(fact('Customer')).toHaveTextContent('Gina Guest')
    expect(fact('Phone')).toHaveTextContent('09171111111')
    expect(fact('Email')).toHaveTextContent('gina@example.com')
  })

  it('falls back to the first court when no court has the lead reference', () => {
    renderPanel({ group: group([lead, part], 'CB-NOPE') })
    expect(screen.getByRole('region', { name: 'Checkout CB-NOPE' })).toBeInTheDocument()
    const region = screen.getByRole('region', { name: 'Checkout CB-NOPE' })
    expect(within(region).getByText('Customer', { selector: 'dt' }).nextElementSibling).toHaveTextContent('Gina Guest')
  })

  it('sums Court price, Booking fee and Checkout total over the courts', () => {
    renderPanel()
    expect(fact('Court price')).toHaveTextContent('₱1,050')
    expect(fact('Booking fee')).toHaveTextContent('₱10')
    expect(fact('Checkout total')).toHaveTextContent('₱1,060')
  })

  it('has no Booking fee fact when the fee is 0', () => {
    renderPanel({ group: group([{ ...lead, booking_fee: 0, amount_due: 350 }, part]) })
    expect(within(panel()).queryByText('Booking fee', { selector: 'dt' })).not.toBeInTheDocument()
    expect(fact('Checkout total')).toHaveTextContent('₱1,050')
  })

  it('has no Rejections fact at 0', () => {
    renderPanel()
    expect(within(panel()).queryByText('Rejections', { selector: 'dt' })).not.toBeInTheDocument()
  })

  it('shows Rejections with the count when the checkout has been rejected before', () => {
    renderPanel({ group: group([{ ...lead, rejection_count: 2 }, { ...part, rejection_count: 0 }]) })
    expect(fact('Rejections')).toHaveTextContent('2')
  })
})

describe('the courts list', () => {
  it('lists each court by start then court id: name, time, amount due, status badge, reference, and a Manage button', () => {
    // Given out of order on purpose.
    renderPanel({ group: group([part, lead]) })
    const items = within(courtsList()).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Badminton 1')
    expect(items[0]).toHaveTextContent('7 AM–8 AM')
    expect(items[0]).toHaveTextContent('₱360')
    expect(items[0]).toHaveTextContent('Payment under review')
    expect(items[0]).toHaveTextContent('CB-LEAD01')
    expect(items[1]).toHaveTextContent('Tennis Court')
    expect(items[1]).toHaveTextContent('11 PM–1 AM')
    expect(items[1]).toHaveTextContent('₱700')
    expect(items[1]).toHaveTextContent('CB-PART02')
  })

  it('breaks a tie in start time by court id', () => {
    const sameStart = { ...part, slot_start: lead.slot_start, slot_end: lead.slot_end }
    renderPanel({ group: group([{ ...sameStart, court_id: 'c-b' }, { ...lead, court_id: 'c-a' }]) })
    const items = within(courtsList()).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('CB-LEAD01')
    expect(items[1]).toHaveTextContent('CB-PART02')
  })

  it('has a Manage button named "Manage <reference>" per court, closed (aria-expanded false), and no link anywhere in the list', () => {
    renderPanel()
    for (const ref of ['CB-LEAD01', 'CB-PART02']) {
      const button = within(courtsList()).getByRole('button', { name: `Manage ${ref}` })
      expect(button).toHaveTextContent('Manage')
      expect(button).toHaveAttribute('aria-expanded', 'false')
    }
    expect(within(courtsList()).queryAllByRole('link')).toHaveLength(0)
  })

  it('opens a court with its Manage button, calling onOpen with the court’s id', async () => {
    const { onOpen } = renderPanel()
    await userEvent.click(within(courtsList()).getByRole('button', { name: 'Manage CB-PART02' }))
    expect(onOpen).toHaveBeenCalledExactlyOnceWith('b')
  })

  it('renders nothing of any court’s own actions while none is open', () => {
    const { renderCourt } = renderPanel({ openId: null })
    expect(screen.queryByTestId('court-a')).not.toBeInTheDocument()
    expect(screen.queryByTestId('court-b')).not.toBeInTheDocument()
    expect(renderCourt).not.toHaveBeenCalled()
  })

  it('renders the open court’s own actions under that court only, and marks its button expanded', () => {
    renderPanel({ openId: 'b' })
    const items = within(courtsList()).getAllByRole('listitem')
    expect(within(items[1]).getByTestId('court-b')).toHaveTextContent('Actions of CB-PART02')
    expect(within(items[0]).queryByTestId('court-a')).not.toBeInTheDocument()
    expect(screen.queryByTestId('court-a')).not.toBeInTheDocument()
    expect(within(courtsList()).getByRole('button', { name: 'Manage CB-PART02' })).toHaveAttribute('aria-expanded', 'true')
    expect(within(courtsList()).getByRole('button', { name: 'Manage CB-LEAD01' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('clicking the open court’s button calls onOpen(null)', async () => {
    const { onOpen } = renderPanel({ openId: 'b' })
    await userEvent.click(within(courtsList()).getByRole('button', { name: 'Manage CB-PART02' }))
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('keeps one court open at a time when driven by its parent’s state', async () => {
    function Harness() {
      const [openId, setOpenId] = useState<string | null>('a')
      return (
        <CheckoutPanel group={group()} openId={openId} onOpen={setOpenId} timeZone="Asia/Manila" currency="PHP" proof={{ state: 'ready', url: 'u' }}
          pending={false} error={null} onApprove={vi.fn()} onReject={vi.fn()} now={NOW}
          renderCourt={(b) => <div data-testid={`court-${b.id}`}>Actions of {b.reference_code}</div>} />
      )
    }
    render(<Harness />)
    expect(screen.getByTestId('court-a')).toBeInTheDocument()
    await userEvent.click(within(courtsList()).getByRole('button', { name: 'Manage CB-PART02' }))
    expect(screen.queryByTestId('court-a')).not.toBeInTheDocument()
    expect(screen.getByTestId('court-b')).toBeInTheDocument()
    await userEvent.click(within(courtsList()).getByRole('button', { name: 'Manage CB-PART02' }))
    expect(screen.queryByTestId('court-b')).not.toBeInTheDocument()
  })

  it('writes the open court’s cancelled line first, "Cancelled by staff on <time>: <reason>", then its actions', () => {
    const cancelled = { ...part, status: 'cancelled' as const, cancelled_by_venue: true, cancelled_at: '2030-01-06T19:30:00.000Z', cancel_reason: 'Court maintenance' }
    renderPanel({ group: group([lead, cancelled]), openId: 'b' })
    const item = within(courtsList()).getAllByRole('listitem')[1]
    const line = within(item).getByText(/^Cancelled by staff on .*: Court maintenance$/)
    expect(line).toHaveTextContent('Jan 7, 3:30')
    expect(follows(line, within(item).getByTestId('court-b'))).toBe(true)
  })

  it('writes "by the customer" for a customer cancel, and shows no cancelled line for a court that is not open', () => {
    const cancelled = { ...part, status: 'cancelled' as const, cancelled_by_venue: false, cancelled_at: '2030-01-06T19:30:00.000Z', cancel_reason: 'Rain' }
    renderPanel({ group: group([lead, cancelled]), openId: 'a' })
    expect(screen.queryByText(/Cancelled by/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Rain/)).not.toBeInTheDocument()
  })

  it('writes the customer’s cancel line when that court is open', () => {
    const cancelled = { ...part, status: 'cancelled' as const, cancelled_by_venue: false, cancelled_at: '2030-01-06T19:30:00.000Z', cancel_reason: 'Rain' }
    renderPanel({ group: group([lead, cancelled]), openId: 'b' })
    expect(screen.getByText(/^Cancelled by the customer on .*: Rain$/)).toBeInTheDocument()
  })
})

describe('the payments, shown once for the checkout', () => {
  const online = (id: string, amount: number, overrides: Partial<AdminPayment> = {}) => payment(id, {
    method: 'paymongo', amount, storage_path: null, reference_number: null, review_status: 'approved', reviewed_at: '2030-01-07T02:20:00.000Z',
    provider_payment_id: 'pay_abc123', provider_source: 'paymaya', ...overrides,
  })
  const paidOnline = () => group([
    { ...lead, status: 'confirmed', payments: [online('r1', 360)] },
    { ...part, status: 'confirmed', payments: [online('r2', 700)] },
  ])

  it('lists a PayMongo payment once, its rows across the courts summed, with its id and paid time', () => {
    renderPanel({ group: paidOnline() })
    expect(within(panel()).getAllByRole('heading', { name: 'Online payments' })).toHaveLength(1)
    expect(within(panel()).getAllByText(/PayMongo · Maya · ₱1,060/)).toHaveLength(1)
    expect(within(panel()).getAllByText(/pay_abc123 · paid Mon, Jan 7, 10:20/)).toHaveLength(1)
    expect(within(panel()).getAllByText('Accepted')).toHaveLength(1)
  })

  it('has no Online payments block without a PayMongo payment', () => {
    renderPanel()
    expect(within(panel()).queryByRole('heading', { name: 'Online payments' })).not.toBeInTheDocument()
  })

  it('shows the "Check duplicate" note once when any court has a superseded proof', () => {
    const superseded = (id: string) => payment(id, { review_status: 'rejected', review_note: 'Paid online with PayMongo instead.', reviewed_by: null })
    renderPanel({ group: group([
      { ...lead, status: 'confirmed', payments: [superseded('s1'), online('r1', 360)] },
      { ...part, status: 'confirmed', payments: [superseded('s2'), online('r2', 700)] },
    ]) })
    const notes = within(panel()).getAllByRole('status')
    expect(notes).toHaveLength(1)
    expect(notes[0]).toHaveTextContent(/paid online after uploading a proof.*Check it for a duplicate payment/)
  })

  it('shows no duplicate note when staff rejected the proof', () => {
    renderPanel({ group: group([{ ...lead, status: 'confirmed', payments: [payment('x', { review_status: 'rejected', review_note: 'Blurry', reviewed_by: 'u1' })] }, { ...part, status: 'confirmed', payments: [] }]) })
    expect(within(panel()).queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('the proof and the one review', () => {
  it('shows ONE "Proof waiting for review" for the pending payment with the file, the amount summed over the group', () => {
    renderPanel()
    expect(within(panel()).getAllByRole('heading', { name: 'Proof waiting for review' })).toHaveLength(1)
    expect(within(panel()).getByText(/GCash · ₱1,060 · Ref 1234/)).toBeInTheDocument()
    expect(within(panel()).getByRole('img', { name: 'Proof of payment' })).toHaveAttribute('src', 'https://signed/proof')
    // Equal to the checkout total: no mismatch warning.
    expect(within(panel()).queryByRole('status')).not.toBeInTheDocument()
  })

  it('warns "Paid ₱1,050 but the total is ₱1,060." when the summed proof differs from the checkout total', () => {
    renderPanel({ group: group([{ ...lead, payments: [{ ...leadPayment, amount: 350 }] }, part]) })
    expect(within(panel()).getByRole('status')).toHaveTextContent('Paid ₱1,050 but the total is ₱1,060.')
  })

  it('says "No file attached" when the pending payment has no file', () => {
    const noFile = group([{ ...lead, payments: [{ ...leadPayment, storage_path: null }] }, part])
    renderPanel({ group: noFile })
    expect(within(panel()).getByText(/No file attached/)).toBeInTheDocument()
  })

  it('says "Loading proof…" while the file’s link loads', () => {
    renderPanel({ proof: { state: 'loading' } })
    expect(within(panel()).getByText('Loading proof…')).toBeInTheDocument()
  })

  it('says "This decides all 2 bookings at once." above Approve and confirm and Reject proof', () => {
    renderPanel()
    const note = within(panel()).getByText('This decides all 2 bookings at once.')
    expect(follows(note, within(panel()).getByRole('button', { name: 'Approve and confirm' }))).toBe(true)
    expect(follows(note, within(panel()).getByRole('button', { name: 'Reject proof' }))).toBe(true)
  })

  it('counts all the courts in that sentence: 3', () => {
    const third = { ...part, id: 'c', reference_code: 'CB-THIRD03', court_id: 'c3', slot_start: '2030-01-07T20:00:00.000Z', slot_end: '2030-01-07T21:00:00.000Z', payments: [payment('pc', { amount: 700 })] }
    renderPanel({ group: group([lead, part, third]) })
    expect(within(panel()).getByText('This decides all 3 bookings at once.')).toBeInTheDocument()
  })

  it('approves once through onApprove', async () => {
    const { onApprove } = renderPanel()
    await userEvent.click(within(panel()).getByRole('button', { name: 'Approve and confirm' }))
    expect(onApprove).toHaveBeenCalledOnce()
  })

  it('rejects once with the trimmed reason', async () => {
    const { onReject } = renderPanel()
    await userEvent.type(within(panel()).getByLabelText('Reason for rejecting'), '  Screenshot is cut off ')
    await userEvent.click(within(panel()).getByRole('button', { name: 'Reject proof' }))
    expect(onReject).toHaveBeenCalledExactlyOnceWith('Screenshot is cut off')
  })

  it('asks for a reason when rejecting without one, and does not call onReject', async () => {
    const { onReject } = renderPanel()
    await userEvent.click(within(panel()).getByRole('button', { name: 'Reject proof' }))
    expect(within(panel()).getByText('Give a reason so the player knows what to fix.')).toBeInTheDocument()
    expect(onReject).not.toHaveBeenCalled()
  })

  it('can be reviewed although the lead has no payment of its own, because another court has the pending one', () => {
    renderPanel({ group: group([{ ...lead, payments: [] }, { ...part, payments: [payment('pb', { amount: 1060, storage_path: 'b/proof.png' })] }]) })
    expect(within(panel()).getByRole('button', { name: 'Approve and confirm' })).toBeInTheDocument()
    expect(within(panel()).getByText(/GCash · ₱1,060/)).toBeInTheDocument()
  })

  it('offers the review when only one court is under review (the lead is already confirmed)', () => {
    renderPanel({ group: group([{ ...lead, status: 'confirmed', payments: [] }, part]) })
    expect(within(panel()).getByRole('button', { name: 'Approve and confirm' })).toBeInTheDocument()
  })

  it('offers no review once no court is under review, and says nothing is waiting', () => {
    const done = (b: AdminBooking) => ({ ...b, status: 'confirmed' as const, payments: [] })
    renderPanel({ group: group([done(lead), done(part)]) })
    expect(within(panel()).queryByRole('button', { name: 'Approve and confirm' })).not.toBeInTheDocument()
    expect(within(panel()).queryByRole('button', { name: 'Reject proof' })).not.toBeInTheDocument()
    expect(within(panel()).queryByRole('heading', { name: 'Proof waiting for review' })).not.toBeInTheDocument()
    expect(within(panel()).getByText('No proof is waiting for review.')).toBeInTheDocument()
    expect(within(panel()).queryByText(/This decides all/)).not.toBeInTheDocument()
  })

  it('offers no review when courts are under review but no payment is pending', () => {
    renderPanel({ group: group([{ ...lead, payments: [] }, { ...part, payments: [] }]) })
    expect(within(panel()).queryByRole('button', { name: 'Approve and confirm' })).not.toBeInTheDocument()
  })

  it('disables both buttons while a decision is pending', () => {
    renderPanel({ pending: true })
    expect(within(panel()).getByRole('button', { name: 'Approve and confirm' })).toBeDisabled()
    expect(within(panel()).getByRole('button', { name: 'Reject proof' })).toBeDisabled()
  })

  it('shows a review error as an alert', () => {
    renderPanel({ error: new ApiError('This booking has no payment waiting for review.', 'P0001', 'invalid_state') })
    expect(within(panel()).getByRole('alert')).toHaveTextContent('no payment waiting for review')
  })
})

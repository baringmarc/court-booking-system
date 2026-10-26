import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Slot } from '../booking/selection'
import type { Court } from '../catalog/api'
import { WalkInForm } from './WalkInForm'

const now = new Date('2030-01-07T02:30:00.000Z') // 10:30 Manila
const at = (h: number) => new Date(Date.UTC(2030, 0, 7, h - 8)).toISOString()
const slot = (court: string, h: number, status: Slot['status'], price = 400): Slot =>
  ({ court_id: court, slot_start: at(h), slot_end: at(h + 1), price, status, booker_first_name: null, open_play_session_id: null, block_key: null })
const courts = [{ id: 'A', name: 'Badminton 1' }, { id: 'B', name: 'Badminton 2' }] as Court[]
const slotsByCourt = new Map<string, Slot[]>([
  ['A', [slot('A', 9, 'past'), slot('A', 10, 'past'), slot('A', 11, 'free', 450), slot('A', 12, 'booked')]],
  ['B', [slot('B', 10, 'past'), slot('B', 11, 'free')]],
])

function renderForm(error: unknown = null) {
  const onSubmit = vi.fn()
  render(<WalkInForm courts={courts} slotsByCourt={slotsByCourt} now={now} timeZone="Asia/Manila" currency="PHP"
    pending={false} error={error} onSubmit={onSubmit} />)
  return onSubmit
}

describe('WalkInForm', () => {
  it('offers the slot in progress and later free slots, not ended or booked ones', () => {
    renderForm()
    const options = within(screen.getByLabelText('Start')).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['Choose…', '10 AM (now)', '11 AM'])
  })

  it('prefills the amount from the price and follows the number of hours until edited', async () => {
    renderForm()
    await userEvent.selectOptions(screen.getByLabelText('Start'), at(10))
    expect(screen.getByLabelText('Amount received')).toHaveValue(400)
    expect(within(screen.getByLabelText('Hours')).getAllByRole('option')).toHaveLength(2) // 10 and 11, then booked
    await userEvent.selectOptions(screen.getByLabelText('Hours'), '2')
    expect(screen.getByLabelText('Amount received')).toHaveValue(850)
    await userEvent.clear(screen.getByLabelText('Amount received'))
    await userEvent.type(screen.getByLabelText('Amount received'), '800')
    expect(screen.getByText('Price: ₱850')).toBeInTheDocument()
  })

  it('submits the walk-in with the amount received', async () => {
    const onSubmit = renderForm()
    await userEvent.selectOptions(screen.getByLabelText('Start'), at(10))
    await userEvent.selectOptions(screen.getByLabelText('Hours'), '2')
    await userEvent.clear(screen.getByLabelText('Amount received'))
    await userEvent.type(screen.getByLabelText('Amount received'), '800')
    await userEvent.type(screen.getByLabelText('Customer name'), ' Wendy ')
    await userEvent.selectOptions(screen.getByLabelText('Payment'), 'gcash')
    await userEvent.click(screen.getByRole('button', { name: 'Record walk-in' }))
    expect(onSubmit).toHaveBeenCalledWith({
      courtId: 'A', start: at(10), slots: 2, name: 'Wendy', phone: '', method: 'gcash', amount: 800, referenceNumber: '',
    })
  })

  it('requires a start time and a name, and shows server errors', async () => {
    const onSubmit = renderForm()
    await userEvent.click(screen.getByRole('button', { name: 'Record walk-in' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a court and a start time.')
    await userEvent.selectOptions(screen.getByLabelText('Start'), at(11))
    await userEvent.click(screen.getByRole('button', { name: 'Record walk-in' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the customer’s name.')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('resets the start time when the court changes', async () => {
    renderForm()
    await userEvent.selectOptions(screen.getByLabelText('Start'), at(11))
    await userEvent.selectOptions(screen.getByLabelText('Court'), 'B')
    expect(screen.getByLabelText('Start')).toHaveValue('')
  })
})

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { OpenPlaySession } from './api'
import { OpenPlayDialog } from './OpenPlayDialog'

const session: OpenPlaySession = {
  id: 'S1',
  title: 'Saturday open play',
  details: 'Bring your own paddle.\n₱150 per head.',
  links: [{ label: 'RSVP', url: 'https://forms.gle/abc' }, { label: 'Reclub', url: 'https://reclub.co/m/x' }],
  // 2030-01-05 13:00–15:00 Manila
  starts_at: '2030-01-05T05:00:00.000Z',
  ends_at: '2030-01-05T07:00:00.000Z',
  court_ids: ['A', 'B', 'gone'],
}
const names: Record<string, string> = { A: 'Pickleball 1', B: 'Pickleball 2' }
const ready = { isPending: false, isError: false, error: null, data: [session], refetch: vi.fn() }

function renderDialog(sessions = ready, onClose = vi.fn()) {
  render(
    <OpenPlayDialog sessionId="S1" sessions={sessions} courtName={(id) => names[id]} timeZone="Asia/Manila" onClose={onClose} />,
  )
  return onClose
}

describe('OpenPlayDialog', () => {
  it('opens as a dialog named by the session title, with its time, courts and details', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog', { name: 'Saturday open play' })
    expect(dialog).toHaveAttribute('open')
    expect(within(dialog).getByText('Sat, Jan 5 · 1 PM – 3 PM')).toBeInTheDocument()
    expect(within(dialog).getByText('Pickleball 1, Pickleball 2')).toBeInTheDocument()
    expect(within(dialog).getByText(/Bring your own paddle\./)).toHaveClass('pre-line')
    expect(within(dialog).getByText(/can't be booked online/)).toBeInTheDocument()
  })

  it('opens links in a new tab without giving it the page', () => {
    renderDialog()
    const rsvp = screen.getByRole('link', { name: 'RSVP (opens in a new tab)' })
    expect(rsvp).toHaveAttribute('href', 'https://forms.gle/abc')
    expect(rsvp).toHaveAttribute('target', '_blank')
    expect(rsvp).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })

  it('closes from its button and gives focus back to the slot that opened it', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const onClose = vi.fn()
    const { unmount } = render(
      <OpenPlayDialog sessionId="S1" sessions={ready} courtName={(id) => names[id]} timeZone="Asia/Manila" onClose={onClose} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount() // the page removes it on close
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('handles loading, error and a session that was removed', async () => {
    const { unmount } = render(
      <OpenPlayDialog sessionId="S1" sessions={{ ...ready, isPending: true, data: undefined }} courtName={() => undefined}
        timeZone="Asia/Manila" onClose={vi.fn()} />,
    )
    expect(screen.getByRole('dialog', { name: 'Open play' })).toBeInTheDocument()
    unmount()

    const refetch = vi.fn()
    const errored = render(
      <OpenPlayDialog sessionId="S1" sessions={{ ...ready, isError: true, error: new Error('Failed to fetch'), data: undefined, refetch }}
        courtName={() => undefined} timeZone="Asia/Manila" onClose={vi.fn()} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
    errored.unmount()

    renderDialog({ ...ready, data: [] })
    expect(screen.getByText('This open play session is no longer scheduled.')).toBeInTheDocument()
  })
})

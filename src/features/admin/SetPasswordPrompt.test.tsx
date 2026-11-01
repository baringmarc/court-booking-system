import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../auth/api', () => ({ setPassword: vi.fn() }))

import { setPassword } from '../auth/api'
import { SetPasswordPrompt } from './SetPasswordPrompt'

const mockSet = vi.mocked(setPassword)

async function fill(pw: string, confirm: string) {
  await userEvent.type(screen.getByLabelText('New password'), pw)
  await userEvent.type(screen.getByLabelText('Confirm password'), confirm)
}

describe('SetPasswordPrompt (T14.5b)', () => {
  beforeEach(() => {
    mockSet.mockReset()
  })

  it('shows the heading, both labelled fields and the actions', () => {
    render(<SetPasswordPrompt onDone={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Set your password' })).toBeInTheDocument()
    expect(screen.getByLabelText('New password')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set password' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument()
  })

  it('success: calls setPassword with the password, then onDone', async () => {
    mockSet.mockResolvedValue(undefined)
    const onDone = vi.fn()
    render(<SetPasswordPrompt onDone={onDone} />)
    await fill('longenough1', 'longenough1')
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }))
    expect(mockSet).toHaveBeenCalledWith('longenough1')
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('failure: shows the error in an alert and does not call onDone', async () => {
    mockSet.mockRejectedValue(new Error('New password should be different from the old password.'))
    const onDone = vi.fn()
    render(<SetPasswordPrompt onDone={onDone} />)
    await fill('longenough1', 'longenough1')
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('New password should be different from the old password.')
    expect(onDone).not.toHaveBeenCalled()
  })

  it('mismatch: shows "Passwords do not match" and does not call setPassword', async () => {
    const onDone = vi.fn()
    render(<SetPasswordPrompt onDone={onDone} />)
    await fill('longenough1', 'different123')
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match')
    expect(mockSet).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('too short (under 8 chars): does not call setPassword', async () => {
    const onDone = vi.fn()
    render(<SetPasswordPrompt onDone={onDone} />)
    await fill('short12', 'short12')
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }))
    expect(mockSet).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('skip: calls onDone without setting a password', async () => {
    const onDone = vi.fn()
    render(<SetPasswordPrompt onDone={onDone} />)
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
    expect(onDone).toHaveBeenCalledOnce()
    expect(mockSet).not.toHaveBeenCalled()
  })
})

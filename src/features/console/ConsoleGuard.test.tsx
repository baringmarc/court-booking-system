import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext, type AuthState } from '../auth/AuthContext'

vi.mock('./api', () => ({ fetchIsPlatformAdmin: vi.fn() }))
vi.mock('../auth/api', () => ({ signInWithPassword: vi.fn() }))

const { fetchIsPlatformAdmin } = await import('./api')
const { signInWithPassword } = await import('../auth/api')
const { ConsoleGuard } = await import('./ConsoleGuard')

function renderGuard(auth: AuthState) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}><AuthContext.Provider value={auth}>
      <ConsoleGuard><p>Console content</p></ConsoleGuard>
    </AuthContext.Provider></QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(fetchIsPlatformAdmin).mockReset()
  vi.mocked(signInWithPassword).mockReset()
})

describe('ConsoleGuard', () => {
  it('shows a loader while auth loads', () => {
    renderGuard(authState('anon', { loading: true }))
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('Console content')).not.toBeInTheDocument()
  })

  it('shows a loader while the platform-admin check is pending', () => {
    vi.mocked(fetchIsPlatformAdmin).mockReturnValue(new Promise(() => {}))
    renderGuard(authState('admin'))
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('Console content')).not.toBeInTheDocument()
  })

  it('shows a sign-in form to signed-out visitors and does not check platform admin', async () => {
    renderGuard(authState('anon'))
    expect(screen.getByRole('heading', { name: 'Platform console' })).toBeInTheDocument()
    expect(screen.queryByText('Console content')).not.toBeInTheDocument()
    vi.mocked(signInWithPassword).mockResolvedValue(undefined)
    await userEvent.type(screen.getByLabelText('Email'), 'ops@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'secret-pw')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(signInWithPassword).toHaveBeenCalledWith('ops@example.com', 'secret-pw')
    expect(fetchIsPlatformAdmin).not.toHaveBeenCalled()
  })

  it('shows a failed sign-in in an alert', async () => {
    renderGuard(authState('anon'))
    vi.mocked(signInWithPassword).mockRejectedValue(new Error('Invalid login credentials'))
    await userEvent.type(screen.getByLabelText('Email'), 'ops@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'bad')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials')
  })

  it('refuses a signed-in user who is not a platform admin, even a venue admin, and offers to log out', async () => {
    vi.mocked(fetchIsPlatformAdmin).mockResolvedValue(false)
    const auth = authState('admin')
    renderGuard(auth)
    expect(await screen.findByRole('heading', { name: 'Platform admins only' })).toBeInTheDocument()
    expect(fetchIsPlatformAdmin).toHaveBeenCalledWith('admin-id')
    expect(screen.queryByText('Console content')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }))
    expect(auth.signOut).toHaveBeenCalled()
  })

  it('renders its children for a platform admin', async () => {
    vi.mocked(fetchIsPlatformAdmin).mockResolvedValue(true)
    renderGuard(authState('player'))
    expect(await screen.findByText('Console content')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Platform admins only' })).not.toBeInTheDocument()
  })

  it('shows an error with retry when the check fails, not the refusal', async () => {
    vi.mocked(fetchIsPlatformAdmin).mockRejectedValueOnce(new Error('network down'))
    renderGuard(authState('player'))
    expect(await screen.findByText(/network down/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Platform admins only' })).not.toBeInTheDocument()
    vi.mocked(fetchIsPlatformAdmin).mockResolvedValue(true)
    await userEvent.click(screen.getByRole('button', { name: /retry|try again/i }))
    expect(await screen.findByText('Console content')).toBeInTheDocument()
  })
})

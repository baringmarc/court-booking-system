import type { User } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { needsPassword } from './needsPassword'

function user(over: { invited_at?: string; meta?: Record<string, unknown>; providers?: string[] }): User {
  const providers = over.providers ?? ['email']
  return {
    id: 'u1',
    email: 'owner@example.com',
    invited_at: over.invited_at,
    user_metadata: over.meta ?? {},
    app_metadata: { provider: providers[0], providers },
    identities: providers.map((p) => ({ provider: p, id: `${p}-id`, user_id: 'u1', identity_data: {}, last_sign_in_at: '', created_at: '', updated_at: '' })),
    aud: 'authenticated',
    created_at: '2030-01-01T00:00:00Z',
  } as unknown as User
}

describe('needsPassword (T14.5b)', () => {
  it('is false when signed out', () => {
    expect(needsPassword(null)).toBe(false)
  })
  it('is true for an invited email user who has not set a password', () => {
    expect(needsPassword(user({ invited_at: '2030-01-01T00:00:00Z' }))).toBe(true)
  })
  it('is false for a user who was not invited', () => {
    expect(needsPassword(user({}))).toBe(false)
  })
  it('is false once password_set is true', () => {
    expect(needsPassword(user({ invited_at: '2030-01-01T00:00:00Z', meta: { password_set: true } }))).toBe(false)
  })
  it('is still true when password_set is something other than true', () => {
    expect(needsPassword(user({ invited_at: '2030-01-01T00:00:00Z', meta: { password_set: 'yes' } }))).toBe(true)
  })
  it('is false for an invited user who signs in with Google only', () => {
    expect(needsPassword(user({ invited_at: '2030-01-01T00:00:00Z', providers: ['google'] }))).toBe(false)
  })
  it('is true for an invited user with both email and Google', () => {
    expect(needsPassword(user({ invited_at: '2030-01-01T00:00:00Z', providers: ['google', 'email'] }))).toBe(true)
  })
})

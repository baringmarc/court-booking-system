import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateUser = vi.fn()
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { updateUser: (...a: unknown[]) => updateUser(...a) } } }))

import { setPassword } from './api'

describe('setPassword (T14.5b)', () => {
  beforeEach(() => updateUser.mockReset())

  it('sets the password through supabase.auth.updateUser and flags password_set', async () => {
    updateUser.mockResolvedValue({ data: {}, error: null })
    await expect(setPassword('s3cret-pass')).resolves.toBeUndefined()
    expect(updateUser).toHaveBeenCalledWith({ password: 's3cret-pass', data: { password_set: true } })
  })

  it('throws the AuthError when Supabase rejects it', async () => {
    const err = new Error('Password should be at least 8 characters')
    updateUser.mockResolvedValue({ data: {}, error: err })
    await expect(setPassword('short')).rejects.toBe(err)
  })
})

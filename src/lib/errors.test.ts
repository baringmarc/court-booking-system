import { describe, expect, it } from 'vitest'
import { errorMessage, GENERIC_ERROR, NETWORK_ERROR } from './errors'
import { ApiError } from './queryClient'

describe('errorMessage', () => {
  it('passes our RPC messages through (P0001 with a hint)', () => {
    expect(errorMessage(new ApiError('This slot was just taken.', 'P0001', 'slot_unavailable'))).toBe('This slot was just taken.')
    expect(errorMessage(new ApiError('Online payment is unavailable.', '503', 'payments_unavailable'))).toBe('Online payment is unavailable.')
  })

  it('translates raw database errors from admin saves', () => {
    expect(errorMessage(new ApiError('new row for relation "courts" violates check constraint "courts_name_check"', '23514')))
      .toBe("Some values aren't valid. Check the form and try again.")
    expect(errorMessage(new ApiError('duplicate key value violates unique constraint "courts_name_key"', '23505')))
      .toBe('That would duplicate something that already exists. Use a different value.')
    expect(errorMessage(new ApiError('permission denied for table venue_settings', '42501')))
      .toBe("You don't have permission to do that. Try logging in again.")
    expect(errorMessage(new ApiError('JWT expired', 'PGRST301'))).toBe('Your session has expired. Please log in again.')
  })

  it("doesn't pass raw PostgREST hints through", () => {
    expect(errorMessage(new ApiError('Could not find the function public.foo', 'PGRST202', 'Perhaps you meant public.bar'))).toBe(GENERIC_ERROR)
  })

  it('never shows an unknown raw code', () => {
    expect(errorMessage(new ApiError('column "x" does not exist', '42703'))).toBe(GENERIC_ERROR)
    expect(errorMessage(new ApiError('boom', '500'))).toBe(GENERIC_ERROR)
  })

  it('says when the server could not be reached', () => {
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe(NETWORK_ERROR)
    expect(errorMessage(new ApiError('TypeError: NetworkError when attempting to fetch resource.', ''))).toBe(NETWORK_ERROR)
  })

  it('keeps our own readable errors, and falls back for anything else', () => {
    expect(errorMessage(new ApiError('The file courts/x.webp was not deleted.'))).toBe('The file courts/x.webp was not deleted.')
    expect(errorMessage(new Error("That file isn't a readable image."))).toBe("That file isn't a readable image.")
    expect(errorMessage('a string')).toBe(GENERIC_ERROR)
    expect(errorMessage(null, 'Could not load.')).toBe('Could not load.')
  })
})

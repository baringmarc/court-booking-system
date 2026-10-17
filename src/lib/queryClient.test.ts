import type { PostgrestSingleResponse } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { ApiError, unwrap } from './queryClient'

describe('unwrap', () => {
  it('returns data when there is no error', () => {
    const res = { data: [1, 2], error: null, count: null, status: 200, statusText: 'OK' } as PostgrestSingleResponse<number[]>
    expect(unwrap(res)).toEqual([1, 2])
  })

  it('throws an ApiError that keeps the code and hint', () => {
    const res = {
      data: null,
      error: { message: 'Sorry, that time was just booked.', code: 'P0001', hint: 'slot_unavailable', details: '', name: 'PostgrestError' },
      count: null,
      status: 400,
      statusText: 'Bad Request',
    } as unknown as PostgrestSingleResponse<null>
    const error = (() => {
      try {
        unwrap(res)
      } catch (e) {
        return e
      }
    })()
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ message: 'Sorry, that time was just booked.', code: 'P0001', hint: 'slot_unavailable' })
  })
})

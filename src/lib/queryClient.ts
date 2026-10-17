import { QueryClient } from '@tanstack/react-query'
import type { PostgrestSingleResponse } from '@supabase/supabase-js'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

/**
 * A Supabase/PostgREST error that keeps its machine-readable parts. Our RPCs raise P0001 with a
 * readable `message` and a stable code in `hint` (e.g. "slot_unavailable"); see RESEARCH.md.
 */
export class ApiError extends Error {
  readonly code: string | undefined
  readonly hint: string | undefined

  constructor(message: string, code?: string, hint?: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.hint = hint
  }
}

/** Throws Supabase/PostgREST errors (as ApiError) so React Query treats them as failures. */
export function unwrap<T>(res: PostgrestSingleResponse<T>): T {
  if (res.error) throw new ApiError(res.error.message, res.error.code || undefined, res.error.hint || undefined)
  return res.data
}

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

/** Throws Supabase/PostgREST errors so React Query treats them as failures. */
export function unwrap<T>(res: PostgrestSingleResponse<T>): T {
  if (res.error) throw new Error(res.error.message)
  return res.data
}

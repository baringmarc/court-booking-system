import { ApiError } from './queryClient'

export const GENERIC_ERROR = 'Something went wrong. Please try again.'
export const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.'

// Raw Postgres / PostgREST codes that reach the UI from table writes (admin forms) rather than from our RPCs.
const CODE_MESSAGES: Record<string, string> = {
  '42501': "You don't have permission to do that. Try logging in again.",
  PGRST301: 'Your session has expired. Please log in again.',
  PGRST303: 'Your session has expired. Please log in again.',
  PGRST116: 'That item no longer exists. Refresh the page and try again.',
  '23505': 'That would duplicate something that already exists. Use a different value.',
  '23503': "This is still in use elsewhere, so it can't be changed or removed.",
  '23514': "Some values aren't valid. Check the form and try again.",
  '23502': 'A required value is missing. Check the form and try again.',
  '22P02': "Some values aren't valid. Check the form and try again.",
  '22001': 'A value is too long. Shorten it and try again.',
  '22003': 'A number is out of range. Check the form and try again.',
  '22007': "A date or time isn't valid. Check the form and try again.",
  '22008': "A date or time isn't valid. Check the form and try again.",
  '23P01': 'That time overlaps something already scheduled.',
}

const NETWORK = /failed to fetch|networkerror|load failed|network request failed/i

/**
 * Text to show for an error. Our RPCs (P0001, with a hint) and our own errors are written for people and pass
 * through; raw database errors are translated; network failures get one clear line (SPEC §7: every async view
 * handles its error state).
 */
export function errorMessage(error: unknown, fallback = GENERIC_ERROR): string {
  if (!(error instanceof Error)) return fallback
  if (NETWORK.test(error.message)) return NETWORK_ERROR
  if (error instanceof ApiError) {
    // Ours: RPC business errors (P0001), and Edge Function errors (an HTTP status plus our code as hint).
    if (error.code === 'P0001' || (error.hint && /^\d{3}$/.test(error.code ?? ''))) return error.message
    // Raw PostgREST/Postgres errors, even ones with a hint ("Perhaps you meant…"), are translated or made generic.
    if (error.code) return CODE_MESSAGES[error.code] ?? fallback
  }
  return error.message || fallback
}

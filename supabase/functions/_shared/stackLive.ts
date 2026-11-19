// Request parsing and error mapping of the stack-live Edge Function (T29.5; contract: docs/PLATFORM.md §4 "Live stacks").
// Plain TypeScript with no Deno APIs, so Vitest and tsc check it with the app. The Turnstile token is checked by
// siteHttp.verifyTurnstile, not here.

export type StackLiveBody = { ok: true; courts: number; title: string | null } | { ok: false }
export type StackLiveError = 'invalid_input' | 'busy' | 'server_error'

export const MAX_COURTS = 12
export const MAX_TITLE = 60

export function parseStackLiveBody(raw: unknown): StackLiveBody {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false }
  const { courts, title } = raw as Record<string, unknown>
  if (typeof courts !== 'number' || !Number.isInteger(courts) || courts < 1 || courts > MAX_COURTS) return { ok: false }
  if (title === undefined || title === null) return { ok: true, courts, title: null }
  if (typeof title !== 'string') return { ok: false }
  const trimmed = title.trim()
  // Count code points, as Postgres char_length does.
  if ([...trimmed].length > MAX_TITLE) return { ok: false }
  return { ok: true, courts, title: trimmed === '' ? null : trimmed }
}

/** Maps a create_site_live_stack error hint to the reply's status and stable error code. */
export function stackLiveFailure(hint: string | null | undefined): { status: 400 | 409 | 500; error: StackLiveError } {
  if (hint === 'invalid_input') return { status: 400, error: 'invalid_input' }
  if (hint === 'busy') return { status: 409, error: 'busy' }
  return { status: 500, error: 'server_error' }
}

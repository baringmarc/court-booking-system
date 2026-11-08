// Error reporting for the Edge Functions (T16.3). Off unless the SENTRY_DSN secret is set.
// Each function imports `npm:@sentry/deno` itself and passes it in (this folder is also type-checked by the app's
// tsc, which can't resolve `npm:` specifiers). The SDK doesn't instrument Deno.serve, so every request gets its own
// scope, and events are flushed before the error leaves the handler (RESEARCH M16). No supabase-js integration:
// its breadcrumbs could carry row data. Every event goes through scrubEvent.
import { scrubEvent } from './sentryScrub.ts'

// The slice of @sentry/deno this wrapper uses.
export type SentrySdk = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Sentry's event type lives in the npm package
  init(o: { dsn: string; beforeSend: (e: any) => any; sendDefaultPii: boolean }): void
  withScope<T>(fn: (scope: { setTag(k: string, v: string): void }) => T): T
  captureException(err: unknown): string
  flush(timeoutMs?: number): Promise<boolean>
}

type Env = { get(key: string): string | undefined }

let initialised = false

function dsn(): string | undefined {
  return (globalThis as { Deno?: { env: Env } }).Deno?.env.get('SENTRY_DSN')?.trim() || undefined
}

export function withSentry<A extends unknown[]>(
  name: string,
  handler: (req: Request, ...rest: A) => Response | Promise<Response>,
  sdk?: SentrySdk,
): (req: Request, ...rest: A) => Promise<Response> {
  return async (req, ...rest) => {
    const key = dsn()
    if (!key || !sdk) return handler(req, ...rest)
    if (!initialised) {
      sdk.init({ dsn: key, sendDefaultPii: false, beforeSend: (event) => scrubEvent(event) })
      initialised = true
    }
    return sdk.withScope(async (scope) => {
      scope.setTag('function', name)
      try {
        return await handler(req, ...rest)
      } catch (err) {
        sdk.captureException(err)
        await sdk.flush(2000)
        throw err
      }
    })
  }
}

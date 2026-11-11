// Strips personal data from a Sentry event before it leaves the browser or an Edge Function (T16.3).
// The player app keeps an identical copy in src/lib/sentryScrub.ts (Edge Functions cannot import from src/): change both together.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
// Philippine mobiles: +63 917 123 4567, 0917-123-4567, 09171234567.
const PHONE = /(?:\+63[\s-]?|\b0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/g
// Guest links (#token=) and auth callbacks (#access_token=, #refresh_token=).
const TOKEN = /\b(access_token|refresh_token|token)=[^&#\s]+/g

function scrubString(s: string): string {
  return s.replace(EMAIL, '[email]').replace(PHONE, '[phone]').replace(TOKEN, '$1=[token]')
}

function withoutHash(url: unknown): unknown {
  return typeof url === 'string' ? url.split('#')[0] : url
}

function scrubValue(v: unknown): unknown {
  if (typeof v === 'string') return scrubString(v)
  if (Array.isArray(v)) return v.map(scrubValue)
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubValue(x)]))
  }
  return v
}

type Loose = Record<string, unknown>

export function scrubEvent<T extends object>(event: T): T {
  const out = { ...(event as Loose) }
  delete out.user

  if (out.request && typeof out.request === 'object') {
    const request = { ...(out.request as Loose) }
    delete request.cookies
    delete request.data
    delete request.headers
    if ('url' in request) request.url = withoutHash(request.url)
    out.request = request
  }

  if (Array.isArray(out.breadcrumbs)) {
    out.breadcrumbs = out.breadcrumbs.map((b: Loose) => {
      if (!b?.data || typeof b.data !== 'object') return b
      const data = { ...(b.data as Loose) }
      for (const key of ['url', 'from', 'to']) if (key in data) data[key] = withoutHash(data[key])
      return { ...b, data }
    })
  }

  return scrubValue(out) as T
}

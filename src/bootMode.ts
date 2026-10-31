import { resolveHost } from './lib/venueHost'

/** Which app this page loads: the platform console on `app.` hosts, the venue app everywhere else (T13.7). */
export function bootMode(hostname: string, search: string, storage: Pick<Storage, 'getItem' | 'setItem'>): 'console' | 'venue' {
  return resolveHost(hostname, search, storage).mode === 'console' ? 'console' : 'venue'
}

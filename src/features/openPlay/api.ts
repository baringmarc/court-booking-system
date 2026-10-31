import { supabase } from '../../lib/supabase'
import { unwrap } from '../../lib/queryClient'
import { currentVenueId } from '../../lib/currentVenue'
import { toLinks, type OpenPlayLink } from './session'

export type { OpenPlayLink } from './session'

/** A one-off open play session (T9.11c): public details plus the courts it blocks. */
export type OpenPlaySession = {
  id: string
  title: string
  details: string
  links: OpenPlayLink[]
  starts_at: string
  ends_at: string
  court_ids: string[]
}

export type OpenPlayInput = {
  courtIds: string[]
  start: string
  end: string
  title: string
  details: string
  links: OpenPlayLink[]
}

export const openPlayKeys = {
  all: () => [currentVenueId(), 'open-play'] as const,
  upcoming: () => [currentVenueId(), 'open-play', 'upcoming'] as const,
}

/** Sessions that haven't ended, soonest first. Public: /book's details, the admin list and the day view.
 *  The admin writes are in admin/api.ts, so they stay out of the public bundle. */
export async function fetchUpcomingOpenPlay(): Promise<OpenPlaySession[]> {
  const rows = unwrap(
    await supabase
      .from('open_play_sessions')
      .select('id, title, details, links, starts_at, ends_at, open_play_courts(court_id)')
      .eq('venue_id', currentVenueId())
      .gt('ends_at', new Date().toISOString())
      .order('starts_at'),
  )
  return rows.map(({ open_play_courts, links, ...session }) => ({
    ...session,
    links: toLinks(links),
    court_ids: open_play_courts.map((c) => c.court_id),
  }))
}

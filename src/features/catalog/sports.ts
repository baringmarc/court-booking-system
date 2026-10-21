// The four sports (a Postgres enum) and their labels. A leaf module so api.ts and sportOrder.ts can both use it.
import type { Enums } from '../../lib/database.types'

export type Sport = Enums<'sport'>

/** Enum order: the default sport order (venue_settings.sport_order defaults to it). */
export const SPORTS: Sport[] = ['badminton', 'pickleball', 'basketball', 'tennis']
export const SPORT_LABELS: Record<Sport, string> = {
  badminton: 'Badminton',
  pickleball: 'Pickleball',
  basketball: 'Basketball',
  tennis: 'Tennis',
}

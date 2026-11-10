import type { Promo } from './api'

export type PromoStatus = 'active' | 'upcoming' | 'ended' | 'paused'

/** The list badge. Dates are venue operating dates (YYYY-MM-DD, both ends inclusive); a paused promo never applies. */
export function promoStatus(promo: Pick<Promo, 'starts_on' | 'ends_on' | 'is_active'>, today: string): PromoStatus {
  if (!promo.is_active) return 'paused'
  if (promo.ends_on < today) return 'ended'
  if (promo.starts_on > today) return 'upcoming'
  return 'active'
}

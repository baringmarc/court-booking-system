// The built-in amenity catalog (T9.11g/h): keys match the venue_amenities check; labels and icons live here.
import {
  AirVent, Armchair, BriefcaseMedical, CircleCheck, Coffee, GlassWater, Lightbulb, Lock, Package, ShowerHead,
  SquareParking, Store, Table2, Toilet, UtensilsCrossed, Wifi, type LucideIcon,
} from 'lucide-react'
import type { Amenity } from './api'

export const AMENITIES = [
  { key: 'restrooms', label: 'Restrooms (CR)', icon: Toilet },
  { key: 'parking', label: 'Parking', icon: SquareParking },
  { key: 'showers', label: 'Showers', icon: ShowerHead },
  { key: 'canteen', label: 'Canteen', icon: UtensilsCrossed },
  { key: 'cafe', label: 'Café', icon: Coffee },
  { key: 'tables', label: 'Tables', icon: Table2 },
  { key: 'night_lights', label: 'Night lights', icon: Lightbulb },
  { key: 'wifi', label: 'Wi-Fi', icon: Wifi },
  { key: 'lockers', label: 'Lockers', icon: Lock },
  { key: 'aircon', label: 'Air-conditioned', icon: AirVent },
  { key: 'water_station', label: 'Water station', icon: GlassWater },
  { key: 'first_aid', label: 'First aid', icon: BriefcaseMedical },
  { key: 'equipment_rental', label: 'Equipment rental', icon: Package },
  { key: 'seating', label: 'Seating area', icon: Armchair },
  { key: 'pro_shop', label: 'Pro shop', icon: Store },
] as const satisfies readonly { key: string; label: string; icon: LucideIcon }[]

export type AmenityKey = (typeof AMENITIES)[number]['key']

/** Custom amenities get one generic icon. */
export const CUSTOM_AMENITY_ICON: LucideIcon = CircleCheck

export type ShownAmenity = { id: string; label: string; icon: LucideIcon }

/** What players see: switched-on built-ins in catalog order, then custom ones in the order they were added. */
export function shownAmenities(rows: Amenity[]): ShownAmenity[] {
  const builtIn = AMENITIES.flatMap((a) => {
    const row = rows.find((r) => r.builtin_key === a.key)
    return row ? [{ id: row.id, label: a.label, icon: a.icon }] : []
  })
  const custom = rows
    .filter((r) => r.custom_name)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map((r) => ({ id: r.id, label: r.custom_name!.trim(), icon: CUSTOM_AMENITY_ICON }))
  return [...builtIn, ...custom]
}

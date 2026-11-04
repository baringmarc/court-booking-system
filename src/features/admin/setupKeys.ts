import { currentVenueId } from '../../lib/currentVenue'

export const setupStatusKey = () => [currentVenueId(), 'admin-setup'] as const

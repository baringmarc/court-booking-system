import { SaveStatus } from '../../components/SaveStatus'
import { SPORT_LABELS, type VenueSettings } from '../catalog/api'
import { orderedSports } from '../catalog/sportOrder'
import type { Sport } from '../catalog/sports'
import { useSaveSportOrder } from './hooks'
import { SortableList } from './SortableList'

/** The order sports appear in on the home page, /book and the admin lists (venue_settings.sport_order, T9.4). */
export function SportOrderSection({ settings }: { settings: Pick<VenueSettings, 'sport_order'> }) {
  const save = useSaveSportOrder()
  const sports = orderedSports(settings.sport_order)

  return (
    <section className="card stack" aria-labelledby="sport-order-heading">
      <h2 id="sport-order-heading">Sport order</h2>
      <p className="muted small">The order sports appear in on the home page, the booking page and the court lists. Changes save right away.</p>
      <SortableList
        className="list order-list"
        label="Sports in order"
        items={sports.map((sport) => ({ id: sport, label: SPORT_LABELS[sport] }))}
        onReorder={(ids) => save.mutate(ids as Sport[])}
        renderItem={(item) => <span className="list-row">{item.label}</span>}
      />
      <SaveStatus isSuccess={save.isSuccess} error={save.error} />
    </section>
  )
}

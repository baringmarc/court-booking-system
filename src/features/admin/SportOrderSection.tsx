import { SaveStatus } from '../../components/SaveStatus'
import { SPORT_LABELS, type VenueSettings } from '../catalog/api'
import { moveItem, orderedSports } from '../catalog/sportOrder'
import { useSaveSportOrder } from './hooks'
import { MoveButtons } from './MoveButtons'

/** The order sports appear in on the home page, /book and the admin lists (venue_settings.sport_order, T9.4). */
export function SportOrderSection({ settings }: { settings: Pick<VenueSettings, 'sport_order'> }) {
  const save = useSaveSportOrder()
  const sports = orderedSports(settings.sport_order)

  return (
    <section className="card stack" aria-labelledby="sport-order-heading">
      <h2 id="sport-order-heading">Sport order</h2>
      <p className="muted small">The order sports appear in on the home page, the booking page and the court lists. Changes save right away.</p>
      <ol className="list order-list">
        {sports.map((sport, i) => (
          <li key={sport} className="order-row">
            <span className="list-row">{SPORT_LABELS[sport]}</span>
            <MoveButtons
              label={SPORT_LABELS[sport]}
              position={i}
              canMoveUp={i > 0}
              canMoveDown={i < sports.length - 1}
              onMove={(direction) => save.mutate(moveItem(sports, i, direction))}
            />
          </li>
        ))}
      </ol>
      <SaveStatus isSuccess={save.isSuccess} error={save.error} />
    </section>
  )
}

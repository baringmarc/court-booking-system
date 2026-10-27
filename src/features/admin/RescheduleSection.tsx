import { useState } from 'react'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { rangeLabel } from '../booking/moves'
import { useNow } from '../booking/useNow'
import { useCourts, useOperatingHours, useVenueSettings } from '../catalog/hooks'
import type { AdminBooking } from './api'
import { useRescheduleBooking } from './hooks'
import { RescheduleForm } from './RescheduleForm'
import { adminCanReschedule, endAfter, movedHours } from './reschedule'

type Props = {
  booking: AdminBooking
  /** Called with a sentence describing the move, once it's saved. */
  onMoved: (message: string) => void
}

/** "Reschedule" for a confirmed booking that hasn't ended (T10.10). The form loads the courts and hours only once opened. */
export function RescheduleSection({ booking, onMoved }: Props) {
  const now = useNow(30_000)
  const [open, setOpen] = useState(false)
  if (!adminCanReschedule(booking, now)) return null
  if (!open) {
    return <div><button type="button" className="btn btn-outline" onClick={() => setOpen(true)}>Reschedule</button></div>
  }
  return <OpenReschedule booking={booking} now={now} onMoved={onMoved} onClose={() => setOpen(false)} />
}

function OpenReschedule({ booking, now, onMoved, onClose }: Props & { now: Date; onClose: () => void }) {
  const settings = useVenueSettings()
  const courts = useCourts()
  const hours = useOperatingHours()
  const reschedule = useRescheduleBooking()

  if (settings.isPending || courts.isPending || hours.isPending) return <PageLoader />
  const failed = [settings, courts, hours].find((q) => q.isError)
  if (failed) return <ErrorMessage error={failed.error} onRetry={() => failed.refetch()} />
  if (!settings.data || !courts.data || !hours.data) return null

  const tz = settings.data.timezone
  return (
    <RescheduleForm
      booking={booking} courts={courts.data} hours={hours.data} settings={settings.data} now={now}
      pending={reschedule.isPending} error={reschedule.isError ? reschedule.error : null}
      onClose={() => { reschedule.reset(); onClose() }}
      // mutateAsync, not mutate's callbacks: a move often takes the booking out of the list's date filter, which
      // unmounts this panel before the refetch is done, and per-call callbacks don't run for an unmounted component.
      onSubmit={(input) => {
        reschedule.mutateAsync({ bookingId: booking.id, ...input }).then((moved) => {
          const court = courts.data.find((c) => c.id === input.courtId)
          const end = endAfter(input.start, movedHours(booking, input.fromStart))
          onMoved(
            `${booking.reference_code} moved to ${court?.name ?? 'the new court'}, ${rangeLabel(input.start, end, tz)}.` +
            (moved.continuationReference ? ` The moved hours are ${moved.continuationReference}.` : ''),
          )
          onClose()
        }, () => { /* shown by the form through reschedule.error */ })
      }}
    />
  )
}

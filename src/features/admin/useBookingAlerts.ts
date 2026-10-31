import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { bookingKeys } from '../booking/hooks'
import { useVenueSettings } from '../catalog/hooks'
import { adminKeys, subscribeToBookingChanges } from './api'
import { alertTitle, countsAsNew } from './bookingAlerts'

const onBookingsPage = (path: string) => path.startsWith('/admin/bookings')

/**
 * Live booking changes for the admin shell (T11.21, SPEC §10 2026-10-28). Every change refreshes the admin data. A
 * proof that came in or a hold paid online counts: on the Bookings nav link until that page is opened, and in the
 * tab title while the tab is in the background.
 */
export function useBookingAlerts(): { navCount: number } {
  const qc = useQueryClient()
  const { pathname } = useLocation()
  const venueName = useVenueSettings().data?.name ?? 'Admin'
  const [navCount, setNavCount] = useState(0)
  const [hiddenCount, setHiddenCount] = useState(0)
  // Read inside the subscription callback without resubscribing on every navigation.
  const pathRef = useRef(pathname)
  const titleRef = useRef<string | null>(null)

  useEffect(() => {
    pathRef.current = pathname
  }, [pathname])

  // Opening Bookings is seeing the news.
  if (onBookingsPage(pathname) && navCount !== 0) setNavCount(0)

  useEffect(() => {
    const refresh = () => {
      for (const queryKey of [adminKeys.allBookings, adminKeys.proofQueue, adminKeys.allEarnings, adminKeys.allMovedParts, bookingKeys.allAvailability()]) {
        void qc.invalidateQueries({ queryKey })
      }
    }
    return subscribeToBookingChanges({
      onChange: (change) => {
        refresh()
        if (!countsAsNew(change)) return
        if (!onBookingsPage(pathRef.current)) setNavCount((n) => n + 1)
        if (document.visibilityState === 'hidden') setHiddenCount((n) => n + 1)
      },
      onReconnect: refresh,
    })
  }, [qc])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') setHiddenCount(0)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    if (hiddenCount === 0) {
      if (titleRef.current !== null) {
        document.title = titleRef.current
        titleRef.current = null
      }
      return
    }
    if (titleRef.current === null) titleRef.current = document.title
    document.title = alertTitle(hiddenCount, venueName)
  }, [hiddenCount, venueName])

  return { navCount }
}

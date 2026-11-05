// T17.13: public scheduling follows effective periods for the selected court.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { createVenue, deleteVenue, serviceClient, venueDate } from './support/helpers.ts'

test('custom-only day, gaps, touching boundaries and overnight checkout', async ({ page }) => {
  const venue = await createVenue('public-schedule')
  const service = serviceClient()
  try {
    const date = venueDate(5)
    const [year, month, day] = date.split('-').map(Number)
    const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
    const { data: court, error: courtError } = await service.from('courts').select('id').eq('venue_id', venue.id).single()
    if (courtError) throw courtError
    // The schedule triggers use private helpers inaccessible to the service role.
    // Run fixture changes directly against the local Supabase database as postgres.
    execFileSync('sh', ['scripts/with-docker.sh', 'docker', 'exec', '-i',
      'supabase_db_court-booking-system', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
      input: `begin;
        update public.operating_hours set is_closed = true where venue_id = '${venue.id}' and day_of_week = ${dow};
        update public.court_schedule_modes set schedule_mode = 'custom' where court_id = '${court.id}';
        insert into public.court_open_periods (venue_id, court_id, day_of_week, start_minute, end_minute) values
          ('${venue.id}', '${court.id}', ${dow}, 360, 480),
          ('${venue.id}', '${court.id}', ${dow}, 480, 600),
          ('${venue.id}', '${court.id}', ${dow}, 1320, 1560);
        update public.venue_schedule_state set schedule_v2_active = true where venue_id = '${venue.id}';
        commit;`,
    })

    await page.goto(`${venue.url}/book?date=${date}&sport=tennis`)
    const seven = page.getByRole('button', { name: new RegExp(`^${venue.court}, 7 AM – 8 AM`) })
    const eight = page.getByRole('button', { name: new RegExp(`^${venue.court}, 8 AM – 9 AM`) })
    await expect(seven).toBeVisible()
    await expect(page.getByRole('rowheader', { name: '11 AM – 12 PM' })).toHaveCount(0)
    await seven.click()
    await eight.click()
    await expect(eight).toHaveAttribute('aria-pressed', 'true')
    await expect(seven).toHaveAttribute('aria-pressed', 'false')
    const overnight = page.getByRole('button', { name: new RegExp(`^${venue.court}, 1 AM – 2 AM \\(next day\\)`) })
    await overnight.click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible()
    const nextDay = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric' })
      .format(new Date(Date.UTC(year, month - 1, day + 1, 4)))
    await expect(page.getByRole('definition').filter({ hasText: nextDay })).toBeVisible()
  } finally {
    await deleteVenue(venue.id)
  }
})

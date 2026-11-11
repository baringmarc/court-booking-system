// T17.14: staff cannot select an open-play duration crossing effective periods.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { addVenueStaff, createPlayer, createVenue, deleteVenue, submitAdminLogin, pickDate, serviceClient, venueDate } from './support/helpers.ts'

test('open play follows the selected court periods and excludes gaps', async ({ page }) => {
  const venue = await createVenue('staff-schedule')
  const player = await createPlayer('staff-schedule')
  try {
    await addVenueStaff(venue.id, player.id)
    const date = venueDate(5)
    const [year, month, day] = date.split('-').map(Number)
    const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
    const { data: court, error } = await serviceClient().from('courts').select('id').eq('venue_id', venue.id).single()
    if (error) throw error
    execFileSync('sh', ['scripts/with-docker.sh', 'docker', 'exec', '-i', 'supabase_db_court-booking-system', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
      input: `begin;
        update public.court_schedule_modes set schedule_mode = 'custom' where court_id = '${court.id}';
        insert into public.court_open_periods (venue_id, court_id, day_of_week, start_minute, end_minute) values
          ('${venue.id}', '${court.id}', ${dow}, 600, 720),
          ('${venue.id}', '${court.id}', ${dow}, 720, 780),
          ('${venue.id}', '${court.id}', ${dow}, 840, 960);
        update public.venue_schedule_state set schedule_v2_active = true where venue_id = '${venue.id}';
        commit;`,
    })
    await page.goto(`${venue.url}/admin/open-play`)
    await submitAdminLogin(page, player.email, player.password)
    await expect(page).toHaveURL(/\/admin\/open-play$/)
    const form = page.getByRole('form', { name: 'Open play session' })
    await form.getByRole('checkbox', { name: new RegExp(venue.court) }).check()
    await pickDate(page, form, 'Date', date)
    const starts = form.getByRole('group', { name: 'Starts' })
    await expect(starts.getByRole('radio', { name: '1 PM', exact: true })).toHaveCount(0)
    await starts.getByRole('radio', { name: '11 AM', exact: true }).check()
    const durations = form.getByRole('group', { name: 'How long' })
    await expect(durations.getByRole('radio', { name: '1 hr', exact: true })).toBeVisible()
    await expect(durations.getByRole('radio', { name: '2 hrs', exact: true })).toHaveCount(0)
  } finally {
    await deleteVenue(venue.id)
  }
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()

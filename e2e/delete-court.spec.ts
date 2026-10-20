// T9.5: an admin deletes a court that was never booked; a booked court is refused and stays.
import { expect, test } from '@playwright/test'
import { createAdmin, E2E_PREFIX, logInAdmin, receiptPng, serviceClient } from './support/helpers.ts'

test('an admin deletes an unbooked court, and a booked court is refused', async ({ page }) => {
  const name = `${E2E_PREFIX} Delete ${Date.now()}`
  const { data: court, error } = await serviceClient()
    .from('courts').insert({ name, sport: 'tennis', default_hourly_rate: 500 }).select('id').single()
  if (error) throw error
  // A photo in the court's media folder: deleting the court removes the folder's files too.
  const folder = `courts/${court.id}`
  const { error: uploadError } = await serviceClient().storage
    .from('venue-media').upload(`${folder}/photo.png`, receiptPng().buffer, { contentType: 'image/png' })
  if (uploadError) throw uploadError

  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password, `/admin/courts/${court.id}`)
  await page.getByRole('button', { name: 'Delete court' }).click()
  await page.getByRole('button', { name: `Yes, delete ${name}` }).click()

  await expect(page).toHaveURL(/\/admin\/courts$/)
  await expect(page.getByRole('heading', { name: 'Courts & rates' })).toBeVisible()
  await expect(page.getByText(name)).toHaveCount(0)
  const { count } = await serviceClient().from('courts').select('id', { count: 'exact', head: true }).eq('id', court.id)
  expect(count).toBe(0)
  await expect.poll(async () => (await serviceClient().storage.from('venue-media').list(folder)).data?.length)
    .toBe(0)

  // Badminton 1 has demo bookings in the seed: it can only be archived.
  const { data: booked } = await serviceClient().from('courts').select('id').eq('name', 'Badminton 1').single()
  await page.goto(`/admin/courts/${booked!.id}`)
  await page.getByRole('button', { name: 'Delete court' }).click()
  await page.getByRole('button', { name: 'Yes, delete Badminton 1' }).click()
  await expect(page.getByRole('alert').filter({ hasText: "This court has bookings, so it can't be deleted." })).toBeVisible()
  await expect(page.getByText(/uncheck “Active” in Details above and save/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Badminton 1', level: 1 })).toBeVisible()
})

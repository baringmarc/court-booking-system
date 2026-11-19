// T29.7: an admin runs today's open play as a live stack from /admin/open-play. The confirm dialog opens a popup on
// plotline.fit (intercepted here: this test never reaches the real site) whose URL carries the code in the query and
// the secret in the fragment; the stack is then readable by anyone with the code (get_live_stack).
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { axeBothSchemes, createAdmin, E2E_PREFIX, logInAdmin, serviceClient, venueId } from './support/helpers.ts'
import { localSupabase } from './support/local.ts'

let originalLogo: string | null | undefined

test.afterEach(async () => {
  const db = serviceClient()
  // The stack keeps the session's title; its session link goes null when the session is deleted.
  const sessions = await db.from('open_play_sessions').delete().like('title', `${E2E_PREFIX}%`)
  if (sessions.error) throw sessions.error
  const stacks = await db.from('live_stacks').delete().like('title', `${E2E_PREFIX}%`)
  if (stacks.error) throw stacks.error
  if (originalLogo !== undefined) {
    const restore = await db.from('venue_settings').update({ logo_path: originalLogo }).eq('venue_id', await venueId())
    if (restore.error) throw restore.error
    originalLogo = undefined
  }
  const left = await db.from('live_stacks').select('id').like('title', `${E2E_PREFIX}%`)
  expect(left.data ?? []).toEqual([])
  const leftSessions = await db.from('open_play_sessions').select('id').like('title', `${E2E_PREFIX}%`)
  expect(leftSessions.data ?? []).toEqual([])
})

test('an admin runs open play as a stack: confirm, popup to plotline.fit with the secret in the fragment, readable by code', async ({ page, context }) => {
  const db = serviceClient()
  const vid = await venueId()
  const { data: settings, error: settingsError } = await db.from('venue_settings').select('name, logo_path').eq('venue_id', vid).single()
  if (settingsError) throw settingsError
  originalLogo = settings.logo_path
  const logoPath = `${vid}/logo/${crypto.randomUUID()}.png`
  const { error: logoError } = await db.from('venue_settings').update({ logo_path: logoPath }).eq('venue_id', vid)
  if (logoError) throw logoError

  // A session running now (today in venue time, not ended), made directly so it works at any hour of the day.
  const { data: court, error: courtError } = await db.from('courts').select('id').eq('venue_id', vid).eq('is_active', true).limit(1).single()
  if (courtError) throw courtError
  const title = `${E2E_PREFIX} Stack session ${Date.now()}`
  // Made as postgres: the links check calls private.valid_open_play_links, which the service role cannot execute.
  execFileSync('sh', ['scripts/with-docker.sh', 'docker', 'exec', '-i', 'supabase_db_court-booking-system', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
    input: `begin;
      insert into public.open_play_sessions (venue_id, title, details, links, starts_at, ends_at)
        values ('${vid}', '${title}', '', '[]'::jsonb, now() - interval '5 minutes', now() + interval '2 hours');
      insert into public.open_play_courts (session_id, court_id, venue_id, during)
        select id, '${court.id}', venue_id, tstzrange(starts_at, ends_at) from public.open_play_sessions
        where venue_id = '${vid}' and title = '${title}';
      commit;`,
  })

  // Nothing may reach the real marketing site.
  await context.route('https://plotline.fit/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }))

  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password, '/admin/open-play')
  const run = page.getByRole('button', { name: `Run ${title} as a stack` })
  await expect(run).toBeEnabled()
  await run.click()

  const dialog = page.getByRole('dialog', { name: 'Run this as a stack' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('newest device takes over')
  await expect(dialog.getByRole('button', { name: 'Not now' })).toBeFocused()
  expect(await axeBothSchemes(page), 'with the stack dialog open').toEqual([])

  const popupPromise = context.waitForEvent('page')
  await dialog.getByRole('button', { name: 'Open the stack' }).click()
  const popup = await popupPromise
  const url = new URL(popup.url())
  expect(url.origin).toBe('https://plotline.fit')
  expect(url.pathname).toBe('/paddle-stack')
  const code = url.searchParams.get('live')
  expect(code).toBeTruthy()
  expect(url.search).toBe(`?live=${encodeURIComponent(code!)}`)
  expect(url.hash).toMatch(/^#key=.+/)
  const secret = decodeURIComponent(url.hash.slice('#key='.length))
  expect(secret.length).toBeGreaterThan(8)
  expect(url.search).not.toContain(secret)
  await popup.close()

  // Anyone with the code can read the stack.
  const { url: apiUrl, publishableKey } = localSupabase()
  const anon = createClient(apiUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await anon.rpc('get_live_stack', { p_code: code! })
  expect(error).toBeNull()
  const stack = data as { title: string; courts: number; venue: { name: string; logo_path: string | null } }
  expect(stack.title).toBe(title)
  expect(stack.courts).toBeGreaterThan(0)
  expect(stack.venue.name).toBe(settings.name)
  expect(stack.venue.logo_path).toBe(logoPath)
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, type Locator, type Page } from '@playwright/test'
import { localSupabase } from './local.ts'

/** Everything a test creates is tagged so global teardown can remove it. */
export const E2E_PREFIX = 'E2E'
export const E2E_EMAIL_DOMAIN = 'example.com'
export const PASSWORD = 'e2e-password-123'

export function uniqueEmail(kind: string) {
  return `e2e-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@${E2E_EMAIL_DOMAIN}`
}

/** Service client for test setup and teardown only (local secret key). */
export function serviceClient() {
  const { url, secretKey } = localSupabase()
  return createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** Creates a confirmed account with the default player role. */
export async function createPlayer(kind = 'player') {
  const email = uniqueEmail(kind)
  const { data, error } = await serviceClient().auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  if (error) throw error
  return { id: data.user.id, email, password: PASSWORD }
}

/** Creates a confirmed user and promotes them to admin (admins are promoted in the database, SPEC §2). */
export async function createAdmin() {
  const user = await createPlayer('admin')
  const { error } = await serviceClient().from('profiles').update({ role: 'admin', full_name: `${E2E_PREFIX} Admin` }).eq('id', user.id)
  if (error) throw error
  return { email: user.email, password: user.password }
}

/** Fills and submits the /admin/login form (the page must already show it). */
export async function submitAdminLogin(page: Page, email: string, password: string) {
  await expect(page.getByRole('heading', { name: 'Admin log in' })).toBeVisible()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
}

/** Opens an admin page signed out, signs in through /admin/login and waits to land back on that page. */
export async function logInAdmin(page: Page, email: string, password: string, path = '/admin') {
  await page.goto(path)
  await submitAdminLogin(page, email, password)
  await expect(page.getByRole('navigation', { name: 'Admin' })).toBeVisible()
  await expect.poll(() => {
    const url = new URL(page.url())
    return url.pathname + url.search
  }).toBe(path)
}

/**
 * Email confirmation is on locally (as on the hosted project), so sign-ups get a confirmation email.
 * Reads it from the local Mailpit and returns the verification link.
 */
export async function confirmationLink(email: string): Promise<string> {
  const { mailpitUrl } = localSupabase()
  let id: string | undefined
  await expect.poll(async () => {
    const res = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
    const body = (await res.json()) as { messages: { ID: string }[] }
    id = body.messages[0]?.ID
    return id
  }, { message: `confirmation email for ${email}` }).toBeTruthy()
  const res = await fetch(`${mailpitUrl}/api/v1/message/${id}`)
  const { Text } = (await res.json()) as { Text: string }
  const link = Text.match(/https?:\/\/\S+\/auth\/v1\/verify\?\S+/)?.[0]
  if (!link) throw new Error(`No verification link in the confirmation email for ${email}`)
  return link
}

/** Waits for an email to `to` whose subject matches, in the local Mailpit, and returns its plain text. */
export async function emailText(to: string, subject: RegExp): Promise<string> {
  const { mailpitUrl } = localSupabase()
  let id: string | undefined
  await expect.poll(async () => {
    const res = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)
    const body = (await res.json()) as { messages: { ID: string; Subject: string }[] }
    id = body.messages.find((m) => subject.test(m.Subject))?.ID
    return id
  }, { message: `email "${subject}" to ${to}` }).toBeTruthy()
  const res = await fetch(`${mailpitUrl}/api/v1/message/${id}`)
  return ((await res.json()) as { Text: string }).Text
}

/**
 * Runs the send-emails worker once, so a queued email arrives now instead of at the next minute's cron tick. The
 * secret is the local one in supabase/functions/.env (the e2e stack's, never the linked project's).
 */
export async function runEmailWorker() {
  const env = Object.fromEntries(
    readFileSync('supabase/functions/.env', 'utf8').split('\n').map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter((m): m is RegExpMatchArray => m !== null).map((m) => [m[1], m[2].trim()]),
  )
  const res = await fetch(`${localSupabase().url}/functions/v1/send-emails`, { method: 'POST', headers: { 'x-worker-secret': env.EMAIL_WORKER_SECRET ?? '' } })
  expect(res.status, 'send-emails worker').toBe(200)
}

/** A venue-local date (Asia/Manila) `days` from today, as YYYY-MM-DD. */
export function venueDate(days: number) {
  return new Date(Date.now() + days * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
}

/**
 * Picks `date` (YYYY-MM-DD) in the DatePicker named `label` inside `scope` (T10.3), or in /book's date strip (its
 * group is "Date", T11.4a): opens the calendar dialog ("Choose a date…" or "Jump to date"), goes forward month by
 * month until the day shows, and clicks it. The dialog closes on a pick.
 */
export async function pickDate(page: Page, scope: Page | Locator, label: string, date: string) {
  await scope.getByRole('group', { name: label }).getByRole('button', { name: /^(Choose a date|Jump to date)/ }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('grid') })
  await expect(dialog.getByRole('grid')).toBeVisible()
  const [y, m, d] = date.split('-').map(Number)
  const month = new Date(Date.UTC(y, m - 1, d)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })
  const day = dialog.getByRole('button', { name: new RegExp(`${month} ${d}(st|nd|rd|th), ${y}`) })
  for (let i = 0; i < 24 && !(await day.isVisible()); i++) await dialog.getByRole('button', { name: /next month/i }).click()
  await day.click()
  await expect(dialog).toBeHidden()
}

/** Selects the first free slot on `court` and continues to checkout. Returns the slot's accessible name. */
export async function pickFirstFreeSlot(page: Page, { date, sport, court }: { date: string; sport: string; court: string }) {
  await page.goto(`/book?date=${date}&sport=${sport}`)
  const slot = page.getByRole('button', { name: new RegExp(`^${court}, .*₱`) }).first()
  await expect(slot).toBeVisible()
  const name = (await slot.getAttribute('aria-label')) ?? ''
  await slot.click()
  await expect(slot).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible()
  return name
}

/** A tiny valid PNG (real magic bytes, so the Edge Function's sniffing accepts it). */
export function receiptPng() {
  return {
    name: 'receipt.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
  }
}

export async function uploadProof(page: Page) {
  await page.getByLabel('Paid with').selectOption('gcash')
  await page.getByLabel(/Receipt screenshot/).setInputFiles(receiptPng())
  await page.getByRole('button', { name: 'Submit proof of payment' }).click()
  await expect(page.getByText(/We're checking your payment/)).toBeVisible()
}

/**
 * Switches the colour scheme for an axe check and waits until no transition is running. Colours ease over 150 ms
 * since T11.4, so axe right after the switch would read a half-faded colour that no one sees at rest.
 */
export async function setColorScheme(page: Page, colorScheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme })
  // A string, because the e2e tsconfig has no DOM types.
  // Only transitions: an endless animation (a loading spinner) never stops running.
  await page.waitForFunction("document.getAnimations().filter((a) => a instanceof CSSTransition).every((a) => a.playState !== 'running')")
}

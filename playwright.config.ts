import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'
import { localSupabase } from './e2e/support/local.ts'

// E2E runs Vite against the LOCAL Supabase stack (`npx supabase start`). Env vars set here take
// precedence over .env, which points at the linked project.
const supabase = localSupabase()
const PORT = 5179
// Every flow runs under the demo venue's subdomain (T13.9): Chromium resolves *.localhost to loopback, and the app
// reads the venue from the host. `app.localhost` (console) and other venues' hosts use full URLs in their specs.
export const VENUE_HOST = `http://claudex-courts.localhost:${PORT}`
// The marketing site (T17.30's showcase journey) runs from the sibling checkout when there is one, like check:drift.
const SITE_DIR = '../plotline-site'
const hasSite = existsSync(`${SITE_DIR}/package.json`)
const SITE_PORT = 5180

export default defineConfig({
  testDir: 'e2e',
  testIgnore: hasSite ? [] : ['showcase-feed.spec.ts'],
  // One worker: the flows book real slots, so desktop and phone must not race for the same one.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // A systemic break (a bad deploy of the app, a down stack) fails every flow, each after its own 60 s timeout. Stop after a few.
  maxFailures: 5,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalTeardown: './e2e/support/teardown.ts',
  use: {
    baseURL: VENUE_HOST,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Mobile-first is a requirement: run every flow at 360px too.
    { name: 'phone', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 780 } } },
  ],
  webServer: [
    {
      command: `npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        VITE_SUPABASE_URL: supabase.url,
        VITE_SUPABASE_PUBLISHABLE_KEY: supabase.publishableKey,
      },
    },
    ...(hasSite ? [{
      command: `npx vite --port ${SITE_PORT} --strictPort --host 127.0.0.1`,
      cwd: SITE_DIR,
      url: `http://127.0.0.1:${SITE_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_SUPABASE_URL: supabase.url, VITE_SUPABASE_PUBLISHABLE_KEY: supabase.publishableKey },
    }] : []),
  ],
})

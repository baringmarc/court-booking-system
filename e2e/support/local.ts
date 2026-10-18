// Connection details of the LOCAL Supabase stack, read at runtime from `supabase status`
// (so no keys live in the repo). E2E tests never run against the linked project.
import { execSync } from 'node:child_process'

export type LocalSupabase = { url: string; publishableKey: string; secretKey: string; mailpitUrl: string }

let cached: LocalSupabase | null = null

export function localSupabase(): LocalSupabase {
  if (cached) return cached
  let out = ''
  try {
    out = execSync('sh scripts/with-docker.sh npx supabase status -o env', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    // handled below
  }
  const env = Object.fromEntries(
    out
      .split('\n')
      .map((line) => line.match(/^([A-Z_]+)="?([^"]*)"?$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => [m[1], m[2]]),
  )
  if (!env.API_URL?.startsWith('http://127.0.0.1') || !env.PUBLISHABLE_KEY || !env.SECRET_KEY || !env.MAILPIT_URL) {
    throw new Error('E2E tests need the full local Supabase stack. Start it with: npx supabase start')
  }
  cached = { url: env.API_URL, publishableKey: env.PUBLISHABLE_KEY, secretKey: env.SECRET_KEY, mailpitUrl: env.MAILPIT_URL }
  return cached
}

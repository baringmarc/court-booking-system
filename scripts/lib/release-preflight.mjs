// T27.8: the pure parts of the release preflight (scripts/release-preflight.mjs). They read the Supabase CLI's
// `migration list` and `functions list` output (whose shape varies between JSON and a text table with the CLI's
// output and agent detection) and compare it with the migrations and function folders at the release commit.

const VERSION = /^\d{14}$/

/** The JSON value in CLI output, skipping noise lines such as the "new version available" notice. */
function parseJsonOutput(text) {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => /^\s*[[{]/.test(line))
  if (start === -1) return undefined
  try {
    return JSON.parse(lines.slice(start).join('\n'))
  } catch {
    return undefined
  }
}

const clean = (cell) => String(cell ?? '').replace(/`/g, '').trim()

/** Migration versions applied on the target, from `supabase migration list` (JSON or text table). */
export function parseMigrationList(text) {
  const json = parseJsonOutput(text)
  if (json && Array.isArray(json.migrations)) {
    return json.migrations.map((m) => clean(m?.remote)).filter((v) => VERSION.test(v))
  }
  const versions = []
  for (const line of text.split('\n')) {
    const cells = line.split('|')
    if (cells.length < 3) continue
    const remote = clean(cells[1])
    if (VERSION.test(remote)) versions.push(remote)
  }
  return versions
}

/** Deployed function slugs, from `supabase functions list` (a JSON array or `{ functions: [...] }`). */
export function parseFunctionList(text) {
  const json = parseJsonOutput(text)
  const list = Array.isArray(json) ? json : Array.isArray(json?.functions) ? json.functions : []
  return list.map((f) => clean(f?.slug || f?.name)).filter(Boolean)
}

/** Versions of the migration files in supabase/migrations/. */
export function localMigrationVersions(fileNames) {
  return fileNames
    .filter((name) => name.endsWith('.sql'))
    .map((name) => name.slice(0, 14))
    .filter((v) => VERSION.test(v))
}

/** Function folders in supabase/functions/, without `_shared` and other `_`/`.` names. */
export function localFunctionNames(dirNames) {
  return dirNames.filter((name) => name && !name.startsWith('_') && !name.startsWith('.'))
}

const missing = (local, remote) => {
  const present = new Set(remote)
  return [...new Set(local)].filter((item) => !present.has(item)).sort()
}

/** What the release commit has that the target lacks. Remote-only items are not failures. */
export function comparePreflight({ localMigrations, remoteMigrations, localFunctions, remoteFunctions }) {
  const missingMigrations = missing(localMigrations, remoteMigrations)
  const missingFunctions = missing(localFunctions, remoteFunctions)
  return { ok: missingMigrations.length === 0 && missingFunctions.length === 0, missingMigrations, missingFunctions }
}

/** The report printed by the script, naming the project ref it checked (L6). */
export function formatReport({ ref, result }) {
  const lines = [`Release preflight against project ref ${ref}`]
  if (result.missingMigrations.length) {
    lines.push('Migrations missing on the target (push them first):')
    for (const version of result.missingMigrations) lines.push(`  - ${version}`)
  }
  if (result.missingFunctions.length) {
    lines.push('Edge Functions missing on the target (deploy them first):')
    for (const name of result.missingFunctions) lines.push(`  - ${name}`)
  }
  lines.push(
    result.ok
      ? `PREFLIGHT PASSED for ${ref}: every migration and Edge Function at the release commit is on the target.`
      : `PREFLIGHT FAILED for ${ref}: don't release this frontend until the items above are on the target.`,
  )
  return lines.join('\n')
}

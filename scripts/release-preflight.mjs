// T27.8 Release preflight: `npm run preflight:release -- --project-ref <ref> [--commit <rev>]`.
// Fails (exit 1), listing each item, when a migration in supabase/migrations/ or an Edge Function folder in
// supabase/functions/ (not _shared) at the release commit (default HEAD) is missing on the target project.
// Read-only: it only runs `supabase migration list` and `supabase functions list` with --project-ref. It never
// links, pushes or deploys, so the CLI link stays on staging. It prints the ref it checked (CLAUDE.md L6).
import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'
import {
  comparePreflight, formatReport, localFunctionNames, localMigrationVersions, parseFunctionList, parseMigrationList,
} from './lib/release-preflight.mjs'

function arg(name) {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}

const ref = arg('--project-ref')
const commit = arg('--commit') ?? 'HEAD'
if (!ref || !/^[a-z0-9]{20}$/.test(ref)) {
  console.error('Usage: npm run preflight:release -- --project-ref <20-character project ref> [--commit <rev>]')
  process.exit(2)
}

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 })

/** Entries of a folder at the release commit (from git, not the working tree). */
function entriesAt(dir, { dirsOnly = false } = {}) {
  const out = run('git', ['ls-tree', ...(dirsOnly ? ['-d'] : []), '--name-only', commit, `${dir}/`])
  return out.split('\n').filter(Boolean).map((path) => basename(path))
}

const localMigrations = localMigrationVersions(entriesAt('supabase/migrations'))
const localFunctions = localFunctionNames(entriesAt('supabase/functions', { dirsOnly: true }))

let remoteMigrationsText, remoteFunctionsText
try {
  remoteMigrationsText = run('npx', ['supabase', 'migration', 'list', '--project-ref', ref])
  remoteFunctionsText = run('npx', ['supabase', 'functions', 'list', '--project-ref', ref, '-o', 'json'])
} catch (error) {
  console.error(`Could not read project ${ref} with the Supabase CLI:\n${error.stderr || error.message}`)
  process.exit(2)
}
const remoteMigrations = parseMigrationList(remoteMigrationsText)
const remoteFunctions = parseFunctionList(remoteFunctionsText)
if (remoteMigrations.length === 0 || remoteFunctions.length === 0) {
  // An empty read is far more likely a CLI output change than an empty project: refuse rather than guess.
  console.error(`Read ${remoteMigrations.length} migrations and ${remoteFunctions.length} functions from ${ref}; refusing to judge an empty read.`)
  process.exit(2)
}

const result = comparePreflight({ localMigrations, remoteMigrations, localFunctions, remoteFunctions })
console.log(`Commit ${run('git', ['rev-parse', '--short', commit]).trim()}: ${localMigrations.length} migrations, ${localFunctions.length} functions.`)
console.log(`Target ${ref}: ${remoteMigrations.length} migrations applied, ${remoteFunctions.length} functions deployed.`)
console.log(formatReport({ ref, result }))
process.exit(result.ok ? 0 : 1)

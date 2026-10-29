#!/usr/bin/env node
// Drift check: fails when docs or site copy restate a business fact differently from docs/facts.json.
//
//   npm run check:drift
//
// Looks in this repo's docs/facts.json, or in ../court-booking-system/docs/facts.json (for plotline-site).
// Scans tracked Markdown files and src/config/. Lines that are clearly history are skipped:
// strikethrough (~~…~~) or wording like "replaced", "replaces", "previously", "used to".
// Tests aren't scanned: they use other amounts on purpose.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const factsPath = [join(root, 'docs', 'facts.json'), join(root, '..', 'court-booking-system', 'docs', 'facts.json')].find(existsSync)

if (!factsPath) {
  console.log('check:drift: docs/facts.json not found here or in ../court-booking-system. Skipped (clone both repos side by side to check).')
  process.exit(0)
}

const facts = JSON.parse(readFileSync(factsPath, 'utf8'))
const fee = facts.bookingFee.amount
const cur = facts.currency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const files = execFileSync('git', ['ls-files', '*.md', 'src/config/**'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !/(\.test\.|node_modules|\.agents\/)/.test(f))

const HISTORY = /~~|\breplac(ed|es|ing)\b|\bpreviously\b|\bused to\b|\bearlier plan\b|\bwas ₱/i

// Ways a booking fee amount gets restated in prose and copy.
const FEE_PATTERNS = [
  new RegExp(`${cur}\\s?(\\d[\\d,]*)\\s*(?:booking fee|per (?:confirmed )?(?:online )?(?:booking|transaction))`, 'gi'),
  new RegExp(`booking fee (?:of )?${cur}\\s?(\\d[\\d,]*)`, 'gi'),
  new RegExp(`price\\s*\\+\\s*${cur}\\s?(\\d[\\d,]*)`, 'gi'),
]

const problems = []

for (const file of files) {
  const lines = readFileSync(join(root, file), 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (HISTORY.test(line)) return
    const where = `${file}:${i + 1}`
    for (const re of FEE_PATTERNS) {
      for (const m of line.matchAll(re)) {
        const n = Number(m[1].replace(/,/g, ''))
        if (n !== fee) problems.push(`${where}: says a ${facts.currency}${n} booking fee; facts.json says ${facts.currency}${fee}. "${m[0]}"`)
      }
    }
    for (const r of facts.retired ?? []) {
      const m = line.match(new RegExp(r.pattern, 'i'))
      if (m) problems.push(`${where}: "${m[0]}" is retired pricing (replaced by ${r.replacedBy}). Update it, or strike it through if it's history.`)
    }
  })
}

// plotline-site: the config every price on the page is built from.
const pricingTs = join(root, 'src', 'config', 'pricing.ts')
if (existsSync(pricingTs)) {
  const m = readFileSync(pricingTs, 'utf8').match(/bookingFee:\s*(\d+)/)
  if (m && Number(m[1]) !== fee) problems.push(`src/config/pricing.ts: bookingFee is ${m[1]}; facts.json says ${fee}.`)
}

if (problems.length) {
  console.error(`check:drift: ${problems.length} statement(s) disagree with ${relative(root, factsPath)}:\n`)
  for (const p of problems) console.error(`- ${p}`)
  console.error('\nFix the statement, or if the fact itself changed, update facts.json first (that is a decision: record it in SAAS-PLAN / SPEC §10).')
  process.exit(1)
}
console.log(`check:drift: ${files.length} files agree with facts.json (booking fee ${facts.currency}${fee}).`)

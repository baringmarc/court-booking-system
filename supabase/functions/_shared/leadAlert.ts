// The "new lead" alert that site-contact emails to staff (T15.3, RESEARCH M15). Plain TypeScript with no Deno APIs, so
// Vitest and tsc check it. LEAD_ALERT_TO is a comma-separated list of addresses; unset means no alert. The alert is
// best-effort: sendLeadAlert never throws, so a failed send can't lose the lead.
import { sendEmail, type Transport } from './email.ts'
import { escapeHtml } from './emailTemplates.ts'
import type { Contact } from './siteForms.ts'

export type Lead = Contact & { id: string }
type SendConfig = Parameters<typeof sendEmail>[2]
type FetchFn = Parameters<typeof sendEmail>[0]

const EMAIL = /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/

export function leadAlertRecipients(value: string | null | undefined): string[] {
  return (value ?? '').split(',').map((a) => a.trim()).filter((a) => EMAIL.test(a))
}

const oneLine = (value: string) => value.replace(/[\r\n]+/g, ' ').trim()

export function leadAlertEmail(lead: Lead): { subject: string; html: string; text: string } {
  const rows: [string, string][] = [
    ['Name', `${lead.firstName} ${lead.lastName}`],
    ['Email', lead.email],
    ['Phone', lead.phone],
    ['Venue', lead.venueName],
    ['Location', lead.location],
    ['Courts', String(lead.courts)],
  ]
  if (lead.facebook) rows.push(['Facebook', lead.facebook])
  if (lead.message) rows.push(['Message', lead.message])
  return {
    subject: `New lead: ${oneLine(lead.venueName)} (${oneLine(lead.location)})`,
    text: rows.map(([k, v]) => `${k}: ${v}`).join('\n'),
    html: `<p>A new lead is waiting in the console.</p><table>${rows
      .map(([k, v]) => `<tr><th align="left">${k}</th><td>${escapeHtml(v)}</td></tr>`)
      .join('')}</table>`,
  }
}

export async function sendLeadAlert(deps: {
  lead: Lead
  to: string | null | undefined
  transport: Transport
  config: SendConfig
  fetchFn: FetchFn
  log?: (message: string) => void
}): Promise<'sent' | 'skipped' | 'failed'> {
  const log = deps.log ?? (() => {})
  try {
    const recipients = leadAlertRecipients(deps.to)
    if (recipients.length === 0) {
      log('site-contact: LEAD_ALERT_TO is not set, no lead alert sent')
      return 'skipped'
    }
    if (deps.transport !== 'resend' && deps.transport !== 'mailpit') {
      log(`site-contact: email transport is ${deps.transport}, no lead alert sent`)
      return 'skipped'
    }
    const email = leadAlertEmail(deps.lead)
    let failed = false
    for (const to of recipients) {
      const result = await sendEmail(deps.fetchFn, deps.transport, deps.config, { to, ...email }, `lead-alert-${deps.lead.id}-${to}`)
      if (!result.ok) {
        failed = true
        log(`site-contact: lead alert to ${to} failed: ${result.error}`)
      }
    }
    return failed ? 'failed' : 'sent'
  } catch (e) {
    log(`site-contact: lead alert failed: ${e instanceof Error ? e.message : String(e)}`)
    return 'failed'
  }
}

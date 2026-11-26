// The owner's inbox for the first chapter: a generic mail app (no real provider's look) showing the real invite
// email, built by the invite-venue-owner function's own template (`ownerEmail` in supabase/functions/_shared/
// ownerInvite.ts, imported from the master worktree), with the real invite link behind its button.
import { readFileSync } from 'node:fs'
export async function inboxHtml({ worktree, base, inviteUrl, venueName }) {
  const { ownerEmail, ownerGuideUrl, OWNER_GUIDE_FILE } = await import(`${worktree}/supabase/functions/_shared/ownerInvite.ts`)
  const tile = `data:image/svg+xml;base64,${readFileSync(`${worktree}/src/assets/plotline-tile.svg`).toString('base64')}`
  const mail = ownerEmail({
    kind: 'invite', venueName, venueUrl: `${base}/admin`, link: inviteUrl, guideUrl: ownerGuideUrl(base),
    venueAddress: new URL(base).host, venueStatus: 'draft', role: 'owner',
  })
  const others = [
    ['Meralco', 'Your November bill is ready', 'Nov 25'],
    ['Paddle Pals PH', 'Saturday open play sign-ups', 'Nov 24'],
    ['Court Supply Co.', 'Your order has shipped', 'Nov 22'],
    ['Jun (Barangay league)', 'Re: court schedule for December', 'Nov 21'],
  ]
  const row = (from, subject, when, active = false) => `
    <div class="row${active ? ' active' : ''}"><div class="from">${from}</div><div class="subj">${subject}</div><div class="when">${when}</div></div>`
  return `<!doctype html><html><head><meta charset="utf-8"><title>Inbox</title><style>
  * { box-sizing: border-box; }
  body { margin: 0; height: 100vh; display: grid; grid-template-columns: 200px 330px 1fr; font: 14px/1.45 -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #222; background: #fff; }
  .side { background: #f3f4f6; padding: 18px 12px; border-right: 1px solid #e3e5e8; }
  .compose { background: #fff; border: 1px solid #d9dce1; border-radius: 12px; padding: 10px 14px; font-weight: 600; margin-bottom: 18px; }
  .folder { padding: 7px 12px; border-radius: 8px; color: #444; display: flex; justify-content: space-between; }
  .folder.on { background: #e3e8ef; font-weight: 700; color: #111; }
  .list { border-right: 1px solid #e3e5e8; overflow: hidden; }
  .list h2 { margin: 0; padding: 18px 18px 10px; font-size: 18px; }
  .row { padding: 12px 18px; border-bottom: 1px solid #eef0f2; display: grid; grid-template-columns: 1fr auto; column-gap: 8px; }
  .row .from { font-weight: 600; } .row .subj { grid-column: 1 / 3; color: #555; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .when { color: #888; font-size: 12px; grid-row: 1; grid-column: 2; }
  .row.active { background: #e8eef7; } .row.active .from, .row.active .subj { color: #111; font-weight: 700; }
  .read { overflow: auto; padding: 26px 36px 40px; }
  .read h1 { font-size: 22px; margin: 0 0 16px; font-weight: 700; }
  .meta { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
  .meta img { width: 40px; height: 40px; border-radius: 10px; }
  .meta .who b { display: block; } .meta .who span { color: #777; font-size: 13px; } .meta .time { margin-left: auto; color: #888; font-size: 13px; }
  .attach { display: inline-flex; align-items: center; gap: 10px; border: 1px solid #dfe2e6; border-radius: 10px; padding: 8px 14px; margin: 4px 0 18px; }
  .attach i { width: 28px; height: 34px; background: #c4623e; border-radius: 4px; color: #fff; font: 700 9px/34px sans-serif; text-align: center; font-style: normal; }
  .attach span { color: #777; font-size: 12px; display: block; }
  .body { max-width: 600px; font-size: 15px; } .body a:not([style]) { color: #4c6b3c; }
  </style></head><body>
  <nav class="side"><div class="compose">✎ Compose</div>
    <div class="folder on">Inbox <span>1</span></div><div class="folder">Starred</div><div class="folder">Sent</div><div class="folder">Drafts</div><div class="folder">Archive</div></nav>
  <section class="list"><h2>Inbox</h2>${row('Plotline', mail.subject, '9:14 AM', true)}${others.map((o) => row(...o)).join('')}</section>
  <article class="read">
    <h1 id="subject">${mail.subject}</h1>
    <div class="meta"><img src="${tile}" alt=""><div class="who"><b>Plotline</b><span>to me</span></div><div class="time">9:14 AM</div></div>
    <div class="attach" id="attachment"><i>PDF</i><div>${OWNER_GUIDE_FILE}<span>Venue owner guide</span></div></div>
    <div class="body">${mail.html}</div>
  </article>
  </body></html>`
}

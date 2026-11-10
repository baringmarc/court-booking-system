# Admin tour pictures

Real screenshots of the admin pages, for the tabbed admin tour on plotline-site (its T4.1). Made by `scripts/admin-tour.mjs`; never edit the PNGs by hand.

## Make or refresh them

```bash
npx supabase start        # the LOCAL stack must be running (the script refuses any other API URL)
npm run tour:shots        # captures, then copies to ../plotline-site/public/admin-tour/ when that repo is checked out
node scripts/admin-tour.mjs --check   # only checks that every file exists and is within its size budget
```

The script adds synthetic demo data (made-up players with `…+tour@example.com` emails, a ₱10 booking fee, generated court illustrations, three open play sessions, a generated GCash receipt), shows it with the browser clock frozen at 9 AM on the venue's today so the result doesn't depend on when it runs, then removes everything, restores the venue info and the booking fee, and checks that nothing is left. It needs a database with the normal demo seed (`npm run db:reset:local`); anything else in the local database shows up in the pictures.

Re-capture whenever an admin page in the table below changes enough to show, and always before a plotline-site release that changes the tour.

## The files

Names are stable: plotline-site refers to them. Desktop is 1280 × 800 at 1×; phone is 360 × 760 at 2×. Light mode, the default `plotline` colours. Budgets: 230 KB per desktop file, 260 KB per phone file (the check fails above them).

| File | Page | What it must show |
| --- | --- | --- |
| `dashboard-desktop.png` | Dashboard | Proofs to review, Today's bookings, Next booking, the top of Earnings |
| `earnings-desktop.png` | Dashboard, Earnings | "This month": collected, the revenue split with Plotline's ₱10 fees, booked hours |
| `bookings-desktop.png` | Bookings | A booking list and a payment proof open for review, with the receipt and Approve |
| `schedule-desktop.png` | Schedule | Opening hours (bottom of the tab) with Week at a glance |
| `open-play-desktop.png` | Open Play | Upcoming sessions |
| `courts-desktop.png` | Courts | Courts grouped by sport, with their hourly rates |
| `reports-desktop.png` | Reports (the fee statement) | This month's fees so far and the month's totals |
| `settings-desktop.png` | Settings | The five settings categories |
| `dashboard-phone.png` | Dashboard | The same cards on a phone |
| `bookings-phone.png` | Bookings | A payment proof under review on a phone |

## Rules for what is in a picture

- Demo data only: no real customers, staff accounts, tokens or addresses.
- Nothing production lacks on the day it ships. The M18–M20 migrations are on staging only (the Handoff), so the pictures show no walk-ins, no promos in use and the default colour preset. Check this again before a release.
- No walk-ins and no staff-account screens.

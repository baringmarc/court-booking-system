# Admin tour pictures and demo video

Real screenshots of the admin pages and a short demo video, for the tabbed admin tour on plotline-site (its T4.1 and T4.2). Made by `scripts/admin-tour.mjs` and `scripts/admin-demo-video.mjs`; never edit the files by hand.

## Make or refresh them

```bash
npx supabase start        # the LOCAL stack must be running (the script refuses any other API URL)
npm run tour:shots        # captures, then copies to ../plotline-site/public/admin-tour/ when that repo is checked out
node scripts/admin-tour.mjs --check   # only checks that every file exists and is within its size budget

brew install ffmpeg       # once: the video needs ffmpeg and ffprobe on the PATH
npm run tour:video        # records the demo video, then copies it to plotline-site as above
node scripts/admin-demo-video.mjs --check   # files present, within budget, captions match the script
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

## The demo video

About 70 seconds, 1280 × 720, silent, with a caption per scene burned into the picture. The scenes and captions are in `docs/demo-script.md` ("Admin demo (scripted)"). Budget: 6 MB per video file, 200 KB for the poster.

| File | What it is |
| --- | --- |
| `admin-demo.mp4` | H.264, plays everywhere; the source Safari and iOS use |
| `admin-demo.webm` | VP9, smaller; list it first in `<video>` |
| `admin-demo-poster.jpg` | The frame shown before play (the Dashboard with the first caption) |
| `admin-demo.vtt` | The same captions as a WebVTT track, for `<track kind="captions">` |

The recording saves one real change to the demo venue (Sunday closes at 11 PM) and puts it back afterwards; the script checks the opening hours are what they were. If the run is interrupted (Ctrl-C) between that save and the end, the demo data is still removed but Sunday may stay an hour longer: set it back on `/admin/schedule`, or run `npm run db:reset:local`. Re-record when a page it visits changes: Dashboard, Bookings (review and reschedule), Schedule.

## Rules for what is in a picture or the video

- Demo data only: no real customers, staff accounts, tokens or addresses.
- Nothing production lacks on the day it ships. The M18–M20 migrations are on staging only (the Handoff), so the pictures show no walk-ins, no promos in use and the default colour preset. Check this again before a release.
- No walk-ins and no staff-account screens.

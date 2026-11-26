# Video #18: Set up your venue (owner walkthrough)

Idea #18 in `../video-ideas.md`, started 2026-11-26. A narrated tutorial for an owner Plotline has just invited: from the invite email to a published venue, then a tour of Settings and the day-to-day pages.

## Decisions (the user's calls, 2026-11-26)

- **One 16:9 video with YouTube chapters** (`chapters.txt`): 4:53 as built (draft v1, 2026-11-26). Short clips can be cut from the chapters later.
- **Desktop admin only** (1280 × 800 browser window), since owners usually set up on a laptop.
- **Scope:** setup, all five Settings sections, and a quick tour of the daily pages (Dashboard with a receipt approval, Bookings, Open Play, Reports).
- **Voice:** Kokoro `af_heart`, the AI voice of #17, run locally (`~/.local/share/plotline-tts/`, see `../what-is-plotline/plan.md`). The narrator speaks for Plotline and never claims to be a person; the outro says "Narrated with an AI voice · Example venue and data".
- **Venue: Dinkhaus Pickleball** (fictional, as in #2, #4, #13 and #17), owner "Rina Dizon" (`rina.dizon@example.com`).

## What is real and what is staged

- **Real:** the app (served from an `origin/master` worktree, `dba035b` at recording, with its own `npm ci`), the invite email's text (built by `ownerEmail` from `supabase/functions/_shared/ownerInvite.ts` in that worktree), the invite link (a real `generateLink` invite for the owner), and every click after it. The draft starts as the console leaves it: `create_venue` (name, subdomain, timezone) and the owner's membership, with no courts, hours or payment details.
- **Staged:** the mail app around the email (a generic inbox at `mail.example.com`, no provider's look); the invite link's verify step happens off camera (the local auth server only redirects to its allow list, so its tokens are moved onto `https://dinkhaus.plotline.fit/admin`, where production sends them); the recording browser maps `dinkhaus.plotline.fit` to the local server; the uploaded images are drawn (court photos, a banner, the logo, and a QR pattern that encodes nothing); the bookings in the last chapter are example data added after the owner publishes, with "Example receipt for a demo" on the receipt. Every app frame carries an "Example data" tag.
- **One reload:** right after **Publish venue**, master's dashboard keeps the availability it fetched while the venue was a draft, so "Today's courts" says "This venue is not taking bookings right now" until the page reloads. The recording reloads there rather than film it (reported to the user as an app bug, 2026-11-26).

## Rules this video follows (from `../video-ideas.md`)

- Fees: "Venues pay no setup or monthly fee: players add a ₱10 booking fee to each online booking, and Plotline invoices you monthly for the fees you collected" (`docs/facts.json`).
- Payments: "GCash, Maya or bank". PayMongo is never mentioned (the Payment Setup page's "Online payments: Off" line is on screen but not narrated).
- Confirmation isn't automatic: the receipt is opened, checked and approved (**Approve and confirm**).
- Only what's deployed: master at recording time. Re-record (step 2 below) after any change to these screens.

## Chapters and script

`narration.json` holds every line (caption and spoken spelling). The chapters: 1 Your invite email · 2 Choose a password · 3 Your setup checklist · 4 Add your courts · 5 Opening hours · 6 Payment details · 7 Publish your venue · 8 Your settings · 9 Day to day, between a title card (with the chapter list) and an outro card ("Questions? Reply to your invite email, or message us on Facebook.").

## Storyboard as built (draft v1, 4:53)

| Time | Chapter | On screen |
|---|---|---|
| 0:00 | Title card | "Set up your venue.", "From your invite email to a live booking page, in about 5 minutes.", the nine chapters listed |
| 0:15 | 1 Your invite email | The generic inbox, the real email's subject, the attached owner guide, the one-use note, the click on **Set up your account** |
| 0:37 | 2 Choose a password | **Set your password**: both fields typed, the "/admin/login" hint, **Set password** |
| 0:54 | 3 Your setup checklist | The dashboard's "Set up your venue" (0 of 5 done), "Players can't book until the venue is published.", the Fix buttons, Fix on courts |
| 1:12 | 4 Add your courts | Court 1 (Pickleball, ₱400, a description), **Create court**, two photos uploaded; Courts 2 and 3 tagged "Sped up ×4" |
| 1:36 | 5 Opening hours | Fix → Schedule, Monday 7 AM–11 PM, **Copy to every day**, Add a break, **Review & save** → **Save changes**, then the Prices, Promos and Closures tabs |
| 2:17 | 6 Payment details | Settings → Payment Setup: GCash, Dinkhaus Pickleball, 0917 555 0188, the QR uploaded, **Add account**; **Use example**, **Save instructions** |
| 2:42 | 7 Publish your venue | The completed checklist, **Publish venue**, the sidebar's "Share your booking site" QR card, then the live home page |
| 3:04 | 8 Your settings | The five cards; Venue Profile (city and address saved), Booking Rules, Website Appearance (Court Green, a banner, the logo, four amenities), Policies & Waivers |
| 3:51 | 9 Day to day | The dashboard with example bookings, **Review proofs** → the receipt → **Approve and confirm** → confirmed, the Bookings filters, Open Play, Reports (this month's fees) |
| 4:42 | Outro | "You're ready for bookings.", "Questions? Reply to your invite email, or message us on Facebook.", plotline.fit, the AI-voice note |

Every line is a burned-in caption except the outro's last one, whose words are on the card itself.

## How it is made

| File | What |
|---|---|
| `owner-setup-16x9.mp4` | The video |
| `chapters.txt` | YouTube chapter timestamps (written by `render.mjs`) |
| `narration.json` | The script, by chapter |
| `voice.py` | Voices the script with Kokoro into `rec/voice/` (a WAV per line, `durations.json`, `preview.wav`) |
| `stage.mjs` | The master worktree, the HTTPS dev server and the recording browser; makes the draft and always cleans up |
| `demo-venue.mjs` | The draft and invite (`createDraft`), the uploaded images, the example bookings (`addExampleBookings`), and the checked cleanup (`removeVenue`) |
| `inbox.mjs` | The generic inbox around the real invite email |
| `recorder.mjs` | Chrome screencast frames, marks, each frame's address, camera focus points and click times |
| `record.mjs` | The owner's actions, one take per chapter, each line paced to its voice |
| `timeline.mjs` | Scenes, footage segments (each line's footage fitted to its voice), the camera, captions |
| `index.html` | The composition; `renderAt(t)` draws a frame |
| `audio.mjs` | The voice, levelled and limited, over a quiet F major bed that ducks under it, with chapter chimes and click ticks |
| `render.mjs`, `stills.mjs`, `sheet.mjs` | Frame capture and mux (about −16 LUFS), still checks, contact sheets of a take |
| `app.css`, `logo.svg` | From `../what-is-plotline/` |
| `rec/` (not committed) | Recordings, voice, soundtrack, the drawn images, the TLS certificate |

## Rebuild

```bash
# 1. Voice (only when narration.json changes)
~/.local/share/plotline-tts/venv/bin/python brag-output/owner-setup/voice.py

# 2. Footage (local stack running; about 6 minutes, the first run longer for npm ci)
node scripts/with-lock.mjs node brag-output/owner-setup/record.mjs

# 3. Sound and pictures
python3 -m http.server 8765 --bind 127.0.0.1        # from the repo root
node brag-output/owner-setup/audio.mjs
node brag-output/owner-setup/render.mjs
```

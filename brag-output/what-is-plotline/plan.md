# Video #17: What is Plotline? (narrated walkthrough)

Idea #17 in `../video-ideas.md` ("Founder walkthrough"), started 2026-11-25. Draft v1 rendered the same day with two hooks; the user chose **hook A** and asked for the walk-in feature, which v2 adds (hook B's renders were removed; its text stays in `narration.json`).

## Decisions (the user's calls, 2026-11-25)

- **No founder on camera, an AI narrator instead.** So it is not a founder video any more: the narrator speaks for Plotline ("we set up your venue with you") and never gives a name or claims to be a person. The outro says "Narrated with an AI voice · Example venue and data", and the post should carry the platform's AI label (TikTok's AI-generated content setting, Meta's AI info). The "give the brand a face" goal moves to #8 and #11, which use real people.
- **The voice:** Kokoro `af_heart` (US female; the user chose it over `am_michael`). Kokoro is open source (Apache-2.0) and runs locally: no account, no cost, no script sent anywhere. Installed outside the repo in `~/.local/share/plotline-tts/` (a Python 3.12 venv made with `uv`, `kokoro-onnx`, and the v1.0 model files from the kokoro-onnx releases).
- **Real app recording**, not the HTML-mirrored UI of #1, #2, #4 and #13.
- **English** narration and captions. Two hooks were tried with everything else the same; the user chose **A** ("Is 7 PM free?… your phone never stops") over B ("What is Plotline?").
- **Walk-ins (v2, the user's request):** a scene shows the owner recording a walk-in from the dashboard, with "Walk-ins have no booking fee", and the fee card adds "Walk-ins you record at the desk: no booking fee." The video treats walk-ins as on for every venue, as the user plans; **today they are off by default** and Plotline switches them on per venue in the console (SPEC §5.8), so that should change before the video is posted, or venues won't find the **+ Walk-in** button. The recording turns them on for Dinkhaus with the service role.
- **Venue: Dinkhaus Pickleball** (fictional; Court Green theme, Pasig, as in #2, #4 and #13), created in the local database for each recording and deleted afterwards.
- **Formats:** 16:9 (1920×1080) for YouTube and a pinned post, with the admin on a desktop; 9:16 (1080×1920), with the admin on a phone. About 84–87 s.

## Script changes after the user's approval

- "your name, your logo, your colors" became "your name, your courts, your colors": the venue's booking page doesn't show its logo (the logo appears on live stacks, the open-slots picture and link previews), so the shot couldn't back the word.
- The intro, payment and fee lines were each split in two (same words), so the pictures can change between the halves.

## Rules this video follows (from `../video-ideas.md`)

- Fees: "Venues pay ₱0" always comes with "no setup fee, no monthly fee". The fee card shows the player paying the venue ₱810 (court ₱800 + booking fee ₱10) and Plotline invoicing the ₱10 fees at the end of the month; Plotline never takes money out of a payment on screen (`docs/facts.json`).
- Payments: "GCash, Maya or bank". No PayMongo or card payments.
- Confirmation isn't automatic: receipt uploaded → "Payment under review" → the owner taps **Approve and confirm** → confirmed.
- Call to action: "Message us for a walkthrough". No free trial or sign-up claims.
- Fictional data only, and every recording carries an "Example data" tag. The QR code is a pattern that encodes nothing, and the receipt says "Example receipt for a demo".
- Only what's deployed: the app is served from an `origin/master` worktree (`0afa69a`, which production runs; `develop` is the same commit), never from the working tree.
- Captions carry the story with the sound off: every narration line is a burned-in caption, except where the same words are already on screen (the hook, the fee card, the outro).

## Facts checked in the product (2026-11-25)

- Guests book without an account; checkout asks for a name and email and the venue's waiver.
- An uploaded receipt makes the booking `payment_submitted`, which still holds the slot, and the page says "The venue checks payments by hand. We'll email you when it's confirmed."
- **Approve and confirm** confirms it and emails the player.
- Hours, prices, moving a booking with a reason and the earnings split are in `/admin`.
- Walk-ins (§5.8): **+ Walk-in** on the dashboard opens a form (court, start, hours, customer name, payment, cash by default, and the amount prefilled with the court price, "Price: ₱400"); **Record walk-in** confirms it at once. Walk-ins carry no booking fee and aren't invoiced.
- **Post open slots** (M31) is on master and UI only; the picture and caption carry the venue's booking address (`https://dinkhaus.plotline.fit/book` in the recording).
- Venues are created by Plotline staff (`create_venue`), the owner is invited, and the dashboard's setup checklist lists what's left (courts, rates, hours, a payment account, payment instructions).

## How the footage is made

`record.mjs` drives the real app with Playwright and records it through Chrome's screencast at 2× (the browser runs with `--force-device-scale-factor=2`, otherwise the frames come out at CSS-pixel size):

1. `stage.mjs` fetches `origin/master`, checks out a detached worktree (`PLOTLINE_MASTER_WORKTREE`, default `$TMPDIR/plotline-master`) sharing the repo's `node_modules`, and serves it with Vite over HTTPS with a throwaway self-signed certificate. The recording browser maps `dinkhaus.plotline.fit` to that server (`--host-resolver-rules`) and accepts the certificate, so every address the app prints reads as in production. Nothing outside that browser is affected.
2. `demo-venue.mjs` makes Dinkhaus with `create_venue` as a platform admin, as the console does: a draft with three ₱400 courts, drawn court photos, the logo and amenities, but no payment account. The setup takes are recorded then. It then adds the GCash account (fake QR) and instructions, publishes the venue, sets the platform booking fee to ₱10 and adds example bookings (today, tomorrow, a receipt waiting, and paid bookings earlier this month).
3. The takes: `setup-desktop`, `setup-phone`, `player` (phone: home, Book now, tomorrow, Court 1 7–9 PM, checkout, QR, receipt, under review), `admin-desktop` and `admin-phone` (the dashboard, approving the player's receipt, a walk-in for Joey Santos at ₱400, schedule, prices, moving a booking, this month's earnings, Post open slots). The phone take approves a fresh copy of the player's booking, since the desktop take already approved the first.
4. Afterwards every row and file Dinkhaus made is deleted, the booking fee is put back, and the script checks that nothing is left ("Cleanup checked").

Run it inside the local-stack lock so no test run shares the database meanwhile.

## Files

| File | What |
|---|---|
| `what-is-plotline-16x9.mp4`, `what-is-plotline-9x16.mp4` | The video (hook A) |
| `poster-16x9.jpg`, `poster-9x16.jpg` | Cover frames (the hook's headline) |
| `share-copy.txt` | Post caption, short version, disclosure, hashtags |
| `narration.json` | The script: a caption and a spoken spelling per line, both hooks |
| `voice.py` | Voices the script with Kokoro into `rec/voice/` (a WAV per line, `durations.json`, `preview.wav`) |
| `demo-venue.mjs`, `stage.mjs`, `recorder.mjs`, `record.mjs` | The recording (above) |
| `timeline.mjs` | Scenes, shots, narration and caption times, shared by the pictures and the sound |
| `index.html` | The composition: `?r=169` or `?r=916`, `&hook=A` or `B`; `renderAt(t)` draws a frame |
| `audio.mjs` | The soundtrack: the voice, levelled and limited, over a quiet F major bed at 100 BPM that ducks under it, with dings, taps and a chime |
| `render.mjs`, `stills.mjs`, `sheet.mjs` | Frame capture and mux (loudness normalized to about −15 LUFS), still checks, contact sheets of a take |
| `app.css`, `logo.svg` | Copied from `../keep-the-chat/` (the app's styles, Dinkhaus's logo) |
| `rec/` (not committed) | Recordings, voice, soundtracks, the TLS certificate |

## Rebuild

```bash
# 1. Voice (only when narration.json changes)
~/.local/share/plotline-tts/venv/bin/python brag-output/what-is-plotline/voice.py

# 2. Footage (local stack running; about 3 minutes)
node scripts/with-lock.mjs node brag-output/what-is-plotline/record.mjs      # or name takes: … record.mjs admin-desktop admin-phone

# 3. Sound and pictures, per format and hook
python3 -m http.server 8765 --bind 127.0.0.1                                  # from the repo root
node brag-output/what-is-plotline/audio.mjs 169 A
node brag-output/what-is-plotline/render.mjs 169 A                           # 169|916; hook B renders get a -hookB suffix
```

## Storyboard as built (16:9, hook A; about 86 s)

| Scene | Narration | On screen |
|---|---|---|
| Hook A | "Is 7 PM free?" "How do I pay?" "Are we confirmed?" If you run a court venue, your phone never stops. | Espresso. A chat thread: the three questions pop in on their words, then a stream of Taglish messages, faster and faster, an unread count climbing. "Your phone never stops." |
| Intro | Plotline is online booking for your courts. Players book and pay on your venue's own page, and you run it all from one dashboard. | Cream. Tile, wordmark, tagline, "Online booking for your courts."; the dashboard and the booking page as a device pair, with the two labels |
| Your page | This is your page: your name, your courts, your colors. | Phone: Dinkhaus's home page, scrolling to the courts |
| Pick a time | Players see which courts are free and pick a time. No account needed. | Phone: Book now, tomorrow, the evening rows, Court 1 at 7 and 8 PM, the selection bar (₱800 + booking fee ₱10 = ₱810) |
| Pay and upload / Held while you check | They pay by GCash, Maya or bank with your QR code, and upload the receipt. Their time is held while you check it. | Phone: checkout (fast), Booking reserved, the GCash QR, the receipt attached, Submit, "Payment under review", the booking page |
| Your dashboard | On your side, the dashboard shows today's courts and every payment waiting for you. | Desktop: the dashboard, zooming to Proofs to review (2) |
| Approve | Open the receipt, check it and approve. The booking is confirmed, and the player gets an email. | Desktop, zoomed: the receipt, **Approve and confirm**, "… is confirmed." |
| Walk-ins | Someone walks in? Record it right from your dashboard. Walk-ins have no booking fee. | Desktop, zoomed: **+ Walk-in**, Court 2 at 6 PM, "Joey Santos", cash, 400 ("Price: ₱400") with a "No booking fee" chip, **Record walk-in**, "Walk-in … recorded and confirmed." (9:16: the headline "Walk-ins, no fee.") |
| Run your venue | Set your own hours and prices, move a booking when it rains, and see what you earned. | Desktop: Schedule, Prices, a move to Court 2 ("Rain: Court 1 is wet"), this month's earnings, one shot per phrase |
| Open slots | And each morning, post your open slots to Facebook in a few taps. | Desktop, zoomed: Post open slots, the picture and caption, Download picture |
| Fee | Venues pay ₱0: no setup fee, no monthly fee. Players add a ₱10 booking fee to each online booking, and we invoice you monthly for the fees you collected. | Cream fee card: "Venues pay ₱0." "No setup fee. No monthly fee." "When a player books online: They pay you ₱810" then "We invoice the ₱10 fees", then "Walk-ins you record at the desk: no booking fee." |
| Setup | We set up your venue with you, and a checklist walks you through the rest. | Desktop: a new venue's "Set up your venue" checklist (3 of 5 done) |
| CTA | Message us for a walkthrough: plotline.fit | Espresso: tile and wordmark, "Message us for a walkthrough.", plotline.fit, the AI-voice note |

In 9:16 the admin scenes use the phone take in the same phone frame, with the headline above it.

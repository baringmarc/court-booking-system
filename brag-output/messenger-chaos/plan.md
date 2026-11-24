# Video #1: Messenger chaos vs. Plotline ("The 7 PM problem")

Idea #1 in `../video-ideas.md`. Draft v1 rendered 2026-11-24. Draft v2 (same day): the clash is 1.5 s longer, with a typing indicator and a zoom into the apology, because in v1 "Sorry po, na-double book" was on screen for only half a second. v2 approved 2026-11-24.

## Files

| File | What |
|---|---|
| `messenger-chaos-9x16.mp4` | 1080×1920, 25 s, for Reels, TikTok, Stories |
| `messenger-chaos-4x5.mp4` | 1080×1350, 25 s, for the Facebook and Instagram feed |
| `poster-9x16.jpg`, `poster-4x5.jpg` | Cover frames (the message pile-up at 5.95 s) |
| `share-copy.txt` | Post caption, short version, hashtags |
| `index.html` | The animation; `?r=916` or `?r=45` picks the format, `renderAt(t)` draws a frame |
| `audio.mjs` → `music.wav` | The soundtrack, synthesized (no licensed music) |
| `render.mjs`, `stills.mjs` | Frame capture and still checks |
| `caveat-600.woff2` | Caveat handwriting font (SIL Open Font License) for the logbook |

## Rebuild

```bash
python3 -m http.server 8765 --bind 127.0.0.1      # from the repo root
node brag-output/messenger-chaos/audio.mjs
node brag-output/messenger-chaos/render.mjs 916   # and 45
```

The page reuses `../work/app.css` (the app's real styles) and the repo's `@fontsource` fonts, so run it from this repo.

## Storyboard as built (120 BPM, cuts on the beat)

| Time | Scene | On screen | Sound |
|---|---|---|---|
| 0–2 | Hook (espresso) | "7 PM. Court 2." A generic chat inbox, unread count climbing | Tense D minor groove, a ding per message |
| 2–6 | Pile-up | "Every day, the same questions." 11 player messages pop up as big cards, faster and faster; the inbox reaches 47 unread and the phone shakes | Dings speed up to sixteenths, riser |
| 6–8 | Logbook | "So you write it down." A handwritten page; 7PM Ct 2 is written for Paolo and later for Mark. Red circles, "Twice." | Pen strokes, a stab on "Twice." |
| 8–11.5 | Clash | "Then 7 PM comes." Mark (8.5 s): "Ma'am, may naglalaro na po sa Court 2? 😅" The owner types (9.0 s), then "Sorry po, na-double book 🙏" (9.5 s). At 9.75 s the camera punches in on the apology with a shake, the bubble gets a red outline and the edges darken; a slow creep holds it to 11.5 s | Music stops at 8.5 s; one dry ding; typing ticks; a ding and a sad low drop on the apology; a low hit on the zoom, a dark drone and a slow heartbeat |
| 11.5–13 | Turn (cream) | "What if players just booked it themselves?" | Opens into warm F major |
| 13–15 | Book | "Players see what's free." Court 2 at 7 PM shows Booked (Paolo); the player picks Court 1, 7–9 PM; ₱800 + ₱10 = ₱810 | Groove, taps |
| 15–17 | Pay | "They pay by GCash, Maya or bank." Venue QR, receipt attached, Submit, "Payment under review" | Taps, two-note |
| 17–20 | Approve | "You approve in one tap." Review card → Approve and confirm → Confirmed; the player's phone shows Confirmed | Chime |
| 20–22.5 | Fee | "Venues pay ₱0." "No setup fee. No monthly fee." "Players add a ₱10 booking fee." | Groove |
| 22.5–25 | Outro (espresso) | Plotline tile and wordmark, "Put your venue on Plotline.", plotline.fit | Final hit, ring-out |

In the code, the book, pay and approve scenes keep their v1 times and play 1 s later (`renderAt` and `audio.mjs` use an offset), so their numbers read 1 s earlier than this table.

## Choices that follow the backlog rules

- The chat app is generic: no Messenger blue, logo, layout or sound. "Messenger" appears only in the caption.
- Confirmation is shown as review → approve → Confirmed, never automatic.
- "₱0" is paired with "No setup fee. No monthly fee." No revenue card, so nothing looks like Plotline taking money from the venue.
- No double-booking promise: the Plotline half shows the taken slot as Booked, and the player picks a free one.
- All names, references, amounts and receipts are fictional. Claudex Courts is the demo venue.

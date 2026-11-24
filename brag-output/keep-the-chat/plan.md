# Video #13: Can I still use Messenger? ("Keep the chat")

Idea #13 in `../video-ideas.md`. Draft v1 rendered 2026-11-24 with two hooks; the user chose hook A the same day and hook B was removed.

## Decisions

- Carried over from #1, #2 and #4 (the user's earlier calls): English headlines, Taglish chat bubbles, players address the front desk as "Ma'am", a **generic chat look** (no Messenger blue, logo, layout or sound; "Messenger" appears only in the post caption), music with UI sounds and no voiceover, 9:16 plus 4:5, the fictional venue **Dinkhaus Pickleball** (Court Green theme, city given as Pasig).
- 20 s: the journey has four steps (ask, reply with the link, book and pay, approve).
- Two hooks were tried with everything else identical; the user chose **A** "Your players already message your page. That's okay." (the backlog's hook) over **B** "Keep the chat. Skip the back-and-forth."

## Facts checked in the product (2026-11-24)

- Plotline has no Messenger integration and no "copy booking link" button in the admin, so the owner just pastes the link like any saved reply. The video never shows Plotline sending or reading messages.
- The link preview is real (T30.7, `worker/venueCard.ts`, on `origin/master`): for `<slug>.plotline.fit/book` it gives the title "Dinkhaus Pickleball · Book a court" and the description "Book Pickleball courts at Dinkhaus Pickleball in Pasig."; with a logo and no banner the image is the logo. How the card looks depends on the chat app, so the card in the video is generic.
- Booking without an account, the selection bar text, the payment page (pay within, the venue's GCash QR, Upload your proof), "Payment under review", the admin's **Approve and confirm** and Confirmed come from the same app screens as #1.
- Production runs `master` at `027d015`.

## Files

| File | What |
|---|---|
| `keep-the-chat-9x16.mp4`, `keep-the-chat-4x5.mp4` | The video, 20 s |
| `poster-9x16.jpg`, `poster-4x5.jpg` | Cover frames (the hook at 2.8 s) |
| `share-copy.txt` | Post caption, short version, hashtags |
| `index.html` | The animation; `?r=916` or `?r=45` picks the format, `renderAt(t)` draws a frame |
| `app.css`, `logo.svg` | Copied from `../open-slots/` (the app's styles, Dinkhaus's logo) |
| `audio.mjs` → `music.wav` | The soundtrack, synthesized with the earlier videos' instruments |
| `render.mjs`, `stills.mjs` | Frame capture and still checks |

## Rebuild

```bash
python3 -m http.server 8765 --bind 127.0.0.1         # from the repo root
node brag-output/keep-the-chat/audio.mjs
node brag-output/keep-the-chat/render.mjs 916        # and 45
```

## Storyboard as built (120 BPM, cuts on the beat)

| Time | Scene | On screen | Sound |
|---|---|---|---|
| 0–3 | Hook (espresso) | A generic chat thread with Carlo D.: "Hi po! Available pa po Court 2 mamayang 7PM?", then "How much po per hour?". "Your players already message your page. That's okay." (the last words in rose) | A calm F major bed, a soft ding per message |
| 3–7 | The reply (cream) | "Reply with your booking link." The owner types, sends "Hi po! Check and book here po 👇", then the link with its preview card (logo, "Dinkhaus Pickleball · Book a court", the description, `dinkhaus.plotline.fit`). "One tap opens your schedule." A tap on the link | Groove starts; typing ticks, two send swoops, a three-note rise for the card, a tap |
| 7–12 | Book and pay (cream) | "They see what's free." Dinkhaus's booking page: Court 2 at 7 PM pulses (Booked), the player picks Court 1 at 7 PM, `Court ₱400 + booking fee ₱10 = ₱410`, Continue. "They book and pay on their own." Pay within 59:48, the GCash QR, receipt.jpg attached, Submit, "Payment under review" | Taps, a low note on the taken slot, a two-note on review |
| 12–15.5 | Approve (cream) | "You approve in one tap." The review card (DKH-8RW, ₱410, Carlo D., the receipt) → **Approve and confirm** → Confirmed. "And the chat ends happy." The chat again: "Confirmed na po! Salamat Ma'am 🙏 See you sa Sat 🏓" | A rising chime, a ding |
| 15.5–17.5 | Fee (cream) | "Venues pay ₱0." "No setup fee. No monthly fee." "Players add a ₱10 booking fee." | A hit |
| 17.5–20 | Outro (espresso) | "Keep the chat. Add your link." Plotline tile and wordmark, "Put your venue on Plotline.", plotline.fit | Final hit, ring-out |

## Choices that follow the backlog rules

- No Messenger integration is implied: the owner pastes a link, and the chat app is generic.
- The player asked for a slot that's taken; the page shows it Booked and they pick a free one. No double-booking promise.
- Confirmation is shown as proof → under review → the venue approves → Confirmed. The player's "Confirmed na po!" comes after the approval.
- "₱0" comes with "No setup fee. No monthly fee."
- All names, references, amounts and receipts are fictional.

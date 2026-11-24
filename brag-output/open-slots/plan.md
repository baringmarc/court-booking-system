# Video #2: Your daily open-slots post in a few taps

Idea #2 in `../video-ideas.md`. Draft v1 rendered 2026-11-24 with two hooks; the user chose hook A the same day and hook B was removed.

## Decisions (the user, 2026-11-24)

- The picture and caption come from the app's real code, with fictional data.
- The post at the end is a generic page post, not Facebook's look. "Facebook" appears only in the caption and in the app's own dialog text.
- English headlines. Two hooks were tried; the user chose A ("Still typing your open slots every morning?") over B ("6:41 AM. Typing again.").
- Today only, no Tomorrow.
- Music with typing and tap sounds, no voiceover. 9:16 plus 4:5. 15 s.
- A fictional venue: **Dinkhaus Pickleball** (`dinkhaus.plotline.fit`, Court Green theme, 6 courts, Sat, Nov 28). A web search found no venue by that name.

## Files

| File | What |
|---|---|
| `open-slots-9x16.mp4`, `open-slots-4x5.mp4` | The video, 15 s |
| `poster-9x16.jpg`, `poster-4x5.jpg` | Cover frames (the hook at 2.9 s) |
| `share-copy.txt` | Post caption, short version, hashtags |
| `picture.png`, `caption.txt` | Drawn by `src/features/admin/slotsImage.ts` (`renderSlotsImage`, `buildCaption`, `buildCourtRanges`) |
| `make-picture.html`, `make-picture.mjs` | Feed that code the fictional Dinkhaus data through Vite and save the two files above |
| `logo.svg` | The fictional venue's logo |
| `index.html` | The animation; `?r=916` or `?r=45` picks the format, `renderAt(t)` draws a frame |
| `app.css` | The app's `src/index.css` copied on 2026-11-24, font paths pointed at `/node_modules` |
| `audio.mjs` → `music.wav` | The soundtrack, synthesized with #1's instruments |
| `render.mjs`, `stills.mjs` | Frame capture and still checks |

## Rebuild

```bash
npx vite --port 5199 --strictPort                 # from the repo root, only to redraw the picture
node brag-output/open-slots/make-picture.mjs
python3 -m http.server 8765 --bind 127.0.0.1      # from the repo root
node brag-output/open-slots/audio.mjs
node brag-output/open-slots/render.mjs 916        # and 45
```

## Storyboard as built (120 BPM)

| Time | Scene | On screen | Sound |
|---|---|---|---|
| 0–3 | Hook (espresso) | "Still typing your open slots every morning?" A generic "New post" composer: the owner types the day's slots by hand, mistypes "2-4", backspaces, and is still on Court 4 when the scene cuts | A quiet D minor bed, a clock on the beat, a click per key |
| 3–5 | Dashboard (cream) | "Now it's one button: Post open slots." Dinkhaus's Today's courts card; tap **Post open slots** | F major groove starts; tap |
| 5–6.7 | Dialog | "Your free courts, drawn for you." "Post your open courts", Today · Sat, Nov 28, "Drawing the picture…", then the real picture | Four-note rise as it appears |
| 6.7–8.5 | Download, copy | "Download the picture. Copy the caption." The dialog scrolls to the caption; Download picture → "Saved to Photos"; Copy caption → "Copied" | Taps |
| 8.5–12 | Post | "Post it on your page." A generic page post with the caption and picture; likes count up; comments "Nag-reserve na po kami 5PM 🙌" and "Court 3, 8PM. See you! 🏓". At 11 s the picture lifts out and fills the frame (all of it in 4:5) | Likes, two comment notes, a hit at 11.5 s |
| 12–15 | Outro (espresso) | "Your open slots, in a few taps." Plotline tile and wordmark, "Put your venue on Plotline.", plotline.fit | Final hit, ring-out |

## Choices that follow the backlog rules

- Plotline doesn't post anything: the owner downloads, copies and posts. The video says "in a few taps", never a timed claim.
- The dialog and dashboard use the app's real classes, styles and words (`PostOpenSlotsDialog.tsx`, `DashboardPage.tsx`), inside a phone frame. The "Saved to Photos" toast stands in for the phone's own download notice.
- The composer and the page post are generic: no Facebook blue, logo or layout.
- The comment says "reserved", not "confirmed": a reservation still waits for the venue's approval.
- All names, references and bookings are fictional.

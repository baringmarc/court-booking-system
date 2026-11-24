# Video #4: The ₱0 math, explained ("What's the catch?")

Idea #4 in `../video-ideas.md`. Draft v1 rendered 2026-11-24 with two hooks; the user chose hook A the same day and hook B was removed.

## Decisions

- Carried over from #1 and #2 (the user's earlier calls): English headlines, music with UI sounds and no voiceover, 9:16 plus 4:5, the app's real UI and the Plotline palette, the fictional venue **Dinkhaus Pickleball** (Court Green theme) from #2.
- 20 s, the top of the backlog's 15–20 s range: the whole money flow needs five steps.
- Two hooks were tried with everything else identical; the user chose **A** "Venues pay ₱0. What's the catch?" (the backlog's hook) over **B** "Venues pay ₱0. So who pays?".

## Facts checked in the product (2026-11-24)

- The fee: `docs/facts.json`: ₱10 per confirmed online booking, paid by the player; venues pay ₱0 setup, ₱0 monthly.
- The booking page's selection bar says `Court ₱400 + booking fee ₱10 = ₱410` (`src/features/booking/SelectionBar.tsx`, `formatMoney` drops the decimals for whole amounts).
- Invoices: a draft for each venue-local month after it ends (`private.generate_invoices`, SPEC §10 2026-11-01), sent by Plotline staff, emailed with the PDF (T26.4). The video's invoice copies the PDF's layout and labels (`supabase/functions/_shared/invoicePdf.ts`): number `<SLUG>-<YYYYMM>` (`DINKHAUS-202611`), Bill To, Balance Due, Billing Month, Invoice Date, Due Date (7 days' grace by default), the Booking fees row as Qty × Rate, amounts as `PHP 320.00` (the PDF fonts have no ₱). The email asks owners to pay by GCash or bank transfer.
- Production runs `master` at `027d015`, which includes M26 (invoices) and the Reports page.

## Files

| File | What |
|---|---|
| `whats-the-catch-9x16.mp4`, `whats-the-catch-4x5.mp4` | The video, 20 s |
| `poster-9x16.jpg`, `poster-4x5.jpg` | Cover frames (the hook at 2.1 s) |
| `share-copy.txt` | Post caption, short version, hashtags |
| `index.html` | The animation; `?r=916` or `?r=45` picks the format, `renderAt(t)` draws a frame |
| `app.css`, `logo.svg` | Copied from `../open-slots/` (the app's styles, Dinkhaus's logo) |
| `audio.mjs` → `music.wav` | The soundtrack, synthesized with #1's and #2's instruments |
| `render.mjs`, `stills.mjs` | Frame capture and still checks |

## Rebuild

```bash
python3 -m http.server 8765 --bind 127.0.0.1           # from the repo root
node brag-output/whats-the-catch/audio.mjs
node brag-output/whats-the-catch/render.mjs 916        # and 45
```

## Storyboard as built (120 BPM, cuts on the beat)

| Time | Scene | On screen | Sound |
|---|---|---|---|
| 0–2.5 | Hook (espresso) | "Venues pay", a huge "₱0" slams in, then "What's the catch?"; the "?" wobbles | A low hit on ₱0, a questioning two-note rise |
| 2.5–6.5 | The booking (cream) | "A player books a ₱400 hour." Dinkhaus's booking page; the player taps Court 1, 7 PM; the selection bar shows `Court ₱400 + booking fee ₱10 = ₱410`. "They add a ₱10 booking fee." The bar lifts out of the phone and "+ booking fee ₱10" is highlighted | F major groove starts; tap; a rising three-note on the highlight |
| 6.5–10.5 | The payment (cream) | "They pay your venue ₱410." A ₱410 pill travels from the player (Mika J.) to Dinkhaus Pickleball, "GCash, Maya or bank" on the arrow. "₱400 is your court revenue." It splits into ₱400 "Court revenue, yours to keep" and ₱10 "Booking fee, paid by the player" | A coin on landing, a hit on the split |
| 10.5–14.5 | Month end (cream) | "Once a month, Plotline sends one invoice." November: 32 ₱10 chips pop in, then fly into the invoice's Booking fees row (32 × PHP 10.00 = PHP 320.00), which lights up. "Just the ₱10s your players paid." Tagged "Example" | A rising run of 32 ticks, a coin as they land |
| 14.5–17 | The answer (cream) | "Venues pay ₱0." "No setup fee. No monthly fee." "Players add ₱10 per confirmed online booking." | A hit, a brighter chord |
| 17–20 | Outro (espresso) | "Simple math. No surprises." Plotline tile and wordmark, "Put your venue on Plotline.", plotline.fit | Final hit, ring-out |

## Choices that follow the backlog rules

- Plotline never takes money out of a payment: the player pays the venue the whole ₱410, and the fees go on a monthly invoice. Nothing shows a revenue split being cut by Plotline.
- "₱0" always comes with "No setup fee. No monthly fee."
- Payments say "GCash, Maya or bank". The invoice's own payment line says "GCash or bank transfer", as the real invoice email does.
- The 32 bookings and the invoice are tagged "Example"; no results claim.
- No "Sign up free": the call to action is "Put your venue on Plotline."
- Venue cancellations credited (a second invoice line that can lower the total) are left out to keep the math to one line; the caption doesn't claim the invoice is always exactly 32 × ₱10.
- All names, references and amounts are fictional.

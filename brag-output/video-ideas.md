# Plotline marketing video ideas

Backlog of video ideas to come after the first launch video (`plotline-video.mp4`, plan in `brag-plan.md`). Build them one at a time and tick each one off below.

Saved 2026-11-24. Revised 2026-11-24 after a review: product claims corrected, owner-question videos added, order changed.

## Status

| # | Idea | Audience | Status |
|---|---|---|---|
| 0 | Vertical cutdowns of the launch video | Owners | Not started (check readability first) |
| 1 | Messenger chaos vs. Plotline | Owners | **Done 2026-11-24** (v2 approved: longer clash, zoom on the apology) (`messenger-chaos/`) |
| 2 | Your daily open-slots post in a few taps | Owners | **Done 2026-11-24** (hook A chosen) (`open-slots/`) |
| 3 | Two people can't reserve the same court and time | Owners | Not started |
| 4 | The ₱0 math, explained | Owners | **Done 2026-11-24** (hook A chosen) (`whats-the-catch/`) |
| 5 | Advertise your quiet hours | Owners | Not started |
| 6 | Make it easier for regulars to return | Owners | Not started |
| 7 | Your venue, your page | Owners | Not started |
| 8 | A day at the front desk | Owners | Not started |
| 9 | Booking shouldn't take 20 messages | Players | Not started |
| 10 | Live stacks for open play | Organizers and players | Not started |
| 11 | Real owner: one specific change | Owners (trust) | Waiting for a real venue and permission |
| 12 | We set it up with you | Owners (trust) | Not started (check what's deployed first) |
| 13 | Can I still use Messenger? | Owners | **Done 2026-11-24** (hook A chosen) (`keep-the-chat/`) |
| 14 | A booking comes in after hours | Owners | Not started |
| 15 | Owner FAQ series | Owners | Not started |
| 16 | From a Facebook post to a booking | Owners | Not started |
| 17 | Founder walkthrough: what is Plotline? | Owners | Not started |

**Suggested order:** #1 (the owner's problem), #2 (a concrete feature), #4 (the "what's the catch?" answer), #13 (meets owners where they already work), #17 (something to send an interested owner). Cut shorter versions from the strongest of these afterwards. #0 only after checking the launch video's text still reads in a vertical crop.

## Fix before posting the current poster

`brag.jpg` puts "Venues pay ₱0." next to "− Plotline fees −₱600", subtracted from the owner's revenue, so it reads as if Plotline takes ₱600 from the venue's money. A relabel alone isn't enough. Either show the real flow (players pay the venue the court price plus ₱10; the venue later remits the collected ₱10 fees on Plotline's monthly invoice; no setup or monthly fee), or use a frame without the revenue split.

## Rules for every video

- **Fees** (from `docs/facts.json`): venues pay no setup fee and no monthly fee. Players add a ₱10 booking fee per confirmed online booking. The player pays the venue the whole amount, and Plotline invoices the venue monthly for the collected fees. Pair "Venues pay ₱0" with "no setup or monthly fee", and never show Plotline taking the fee out of a payment on the spot.
- **Payments:** say "GCash, Maya or bank". Online card payments (PayMongo) are off by default and the marketing site no longer mentions them.
- **Confirmation isn't automatic:** proof submitted → under review → the venue approves → confirmed.
- **Call to action:** "Put your venue on Plotline" or "Message us for a walkthrough". There is no free trial and no self-serve signup, so never "Sign up free". Live stacks get their own call to action ("Try a live stack"), separate from venue sales.
- **Results:** label any filled-up grid or busier schedule as an illustration. Never put numbers like "+30% bookings" on screen unless a real venue can back them up.
- **Only film what's deployed:** before filming a screen (owner manual, invite email, new features), check production has that version.
- **Data:** fictional names, references and amounts only, never production data.
- **Look:** the app's real UI, Fraunces and DM Sans, the Plotline palette (cream, espresso, sage, terracotta), as in the launch video.
- **Sound and captions:** design for both. Captions and visuals carry the story with the sound off, and sound or voice adds to it when on.
- **Formats:** 9:16 for Reels, TikTok and Stories, plus 4:5 (1080×1350) for the Facebook and Instagram feed. 16:9 only for longer pieces meant for YouTube or a pinned post.
- **Real people when possible:** a founder, front-desk staff or a consenting owner makes it more credible than interface footage alone.

## How we judge them

- Count **qualified owner messages and walkthrough requests**, not just views. Ask every new lead where they first heard of Plotline.
- Watch retention and drop-off to see where people leave. Test length per video instead of a fixed rule.
- For each video, try **two opening hooks** with the rest unchanged, so the result is easy to read.

## The ideas

### 0. Vertical cutdowns of the launch video
- **What:** three 6–10s 9:16 cuts from the existing video: the hook ("An empty court earns ₱0." with the grid filling), the one-tap approve, and the fee frame (with the poster fix above).
- **Check first:** the launch video is 16:9, so its text and UI may be too small or cut off in a vertical crop. It may need re-laying out in `work/index.html` rather than a crop.

### 1. Messenger chaos vs. Plotline ("The 7 PM problem")
- **Hook:** "7 PM. Court 2." over an inbox whose unread count climbs.
- **Story:** problem → solution → outcome. Chats pile up, the owner double-books 7 PM, then players book themselves on the venue's page and the owner approves the receipt in one tap.
- **Decisions made (2026-11-24):**
  - Chat bubbles in Taglish, headlines in English.
  - A **generic chat look**: no Messenger blue, logo or layout. "Messenger" appears only in the post caption.
  - Pickleball.
  - 9:16 master plus a 4:5 version. About 25s, no longer.
  - Music plus notification dings that speed up. No voiceover.
  - Players address the front desk as "Ma'am".
  - Same pipeline as the launch video: real UI, 120 BPM, cuts on the beat.
- **Storyboard draft:**

| Time | Beat | On screen |
|---|---|---|
| 0–2s | Hook | A phone with a chat inbox. The unread count climbs 1 → 47. "7 PM. Court 2." |
| 2–8s | Chaos | Player messages pile up, a ding on each beat, getting faster. A handwritten logbook flashes past. |
| 8–10s | The clash | Two players both got "ok po" for 7 PM. The logbook shows 7 PM written twice, circled in red. The music cuts out. |
| 10–11s | Turn | Cut to cream: "What if they just booked it themselves?" |
| 11–19s | Plotline | The venue's own page. 7 PM shows as Booked, the player picks 8 PM, scans the QR, uploads the receipt ("under review"). The owner taps **Approve and confirm**, the player's page turns Confirmed. The unread count drops to 0. |
| 19–22s | Fee | "Venues pay ₱0." with "No setup or monthly fee." (per the fee rule above) |
| 22–25s | Outro | "Put your venue on Plotline." plotline.fit |

- **Chat lines (drafts for the user to check):**
  - Players asking:
    1. "Hi po! Available pa po Court 2 mamayang 7PM?"
    2. "How to book?" (user's example)
    3. "How much per hour?" (user's example)
    4. "is 6PM-8PM available?" (user's example)
    5. "Ano mode of payment nyo?" (user's example)
    6. "Pwede po GCash?"
    7. "Pa-reserve po 7–9PM, 4 kami 🏓"
    8. "Sent na po 🙏" + a GCash receipt screenshot
    9. "Na-receive nyo na po ba?"
    10. "Hello po? Confirmed na po ba kami?"
    11. "May open play po ba kayo sa Sat?"
  - The clash:
    - Owner to player A: "Ok po, reserved na kayo 7PM 👍"
    - Owner to player B: the same reply, sent twice
    - Player B, arriving at 7: "Ma'am, may naglalaro na po sa Court 2? 😅"
    - Owner: "Sorry po, na-double book 🙏"

### 2. Your daily open-slots post in a few taps (M31)
- **Hook:** "Still typing your open slots on Facebook every morning?"
- **Shows:** Post open slots on `/admin` → the 1080×1350 image in the venue's colors and logo → Download picture → Copy caption → the owner pastes both into a post on the venue's Facebook page.
- **Accuracy:** Plotline doesn't post to Facebook; the owner posts it by hand. Say "in a few taps", not "in 10 seconds", unless a real attempt has been timed.
- **Format:** 15s.
- **Decisions made (2026-11-24):** English headlines; two hooks tried, "Still typing your open slots every morning?" chosen over "6:41 AM. Typing again."; Today only; the picture and caption drawn by the app's own code; a generic page post, not Facebook's look; fictional venue Dinkhaus Pickleball; music with typing and tap sounds, no voiceover; 9:16 plus 4:5. As built: `open-slots/plan.md`.

### 3. Two people can't reserve the same court and time
- **Hook:** "Two players. One 8 PM slot."
- **Shows:** one player reserves the slot; the other then sees it unavailable. Caption: "Once it's reserved, no one else can take it."
- **Accuracy:** a reservation waiting for payment holds the slot (60 minutes by default) but isn't a confirmed booking yet. Don't claim "the first tap wins" or "never double-booked".
- **Format:** 10s loop.

### 4. The ₱0 math, explained
- **Hook:** "What's the catch?"
- **Shows the whole flow:** a ₱400 court hour. The player pays the venue ₱410. ₱400 is the venue's court revenue. At the end of the month, Plotline's invoice asks the venue to remit the ₱10 fees it collected. No setup fee, no monthly subscription fee.
- **Format:** 15–20s.
- **Why:** answers the first objection, and makes the later invoice unsurprising.
- **As built (2026-11-24):** 20 s, Dinkhaus Pickleball, the selection bar's real `Court ₱400 + booking fee ₱10 = ₱410`, an invoice drawn like the real PDF (32 × PHP 10.00, tagged "Example"). Two hooks tried; A "Venues pay ₱0. What's the catch?" chosen over B "Venues pay ₱0. So who pays?". As built: `whats-the-catch/plan.md`.

### 5. Advertise your quiet hours (promo rates, M19)
- **Hook:** "Your 2 PM is empty. Again."
- **Shows:** the owner sets a Tue–Thu 2–5 PM promo on `/admin/schedule`, and the promo price and label appear on the player's grid.
- **Accuracy:** a promo helps advertise a quiet time; it doesn't guarantee bookings. If slots fill on screen, label it "Illustration".
- **Format:** 15s.

### 6. Make it easier for regulars to return (M30)
- **Hook:** "Same players, same time, every week?"
- **Shows:** the reminder email the evening before play, then **Same time next week** on the booking page; the player chooses it and books the next free week.
- **Accuracy:** nothing rebooks automatically. Don't say "autopilot".
- **Format:** 20s.

### 7. Your venue, your page
- **Hook:** "Your courts. Your name. Your colors."
- **Shows:** the theme presets swapping, the venue logo, `yourvenue.plotline.fit`, and the link preview with the venue's name and photo when the link is pasted in a chat.
- **Accuracy:** colors come from the presets, not any color you like, and the address is a Plotline subdomain (custom domains are only planned). Leave out Add to Home Screen until the Android and iPhone logo checks in T30.8 are done.
- **Format:** 15s.

### 8. A day at the front desk
- **Hook:** "Here's what running a venue looks like now."
- **Story:** follow one person through three interruptions Plotline helps with (for example: "is 7 PM free?", a receipt to check, a regular who wants next week), not a tour of features.
- **Format:** 45–60s, 16:9 and 9:16, for YouTube or a pinned Facebook post. Best with a real staff member.

### 9. Booking shouldn't take 20 messages
- **Hook:** POV: "you just want to play at 7."
- **Shows:** pick a slot → pay by the venue's QR → upload the receipt → "under review" → the venue approves → Confirmed, with the calendar file in the confirmation email → the reminder email the evening before.
- **Accuracy:** confirmation waits for the venue's approval. The calendar file is an attachment, not an automatic calendar invite.
- **Format:** 15s. Made for venues to repost on their own pages.

### 10. Live stacks for open play (M29)
- **Hook:** "No more crowding around the whiteboard."
- **Shows:** the organizer creates a stack and shares the QR; players scan it and watch the board, Up next and standings update on their phones; the share cards.
- **Accuracy:** players only view; the organizer's device controls everything. "No sign-in" applies to organizers on plotline.fit.
- **Call to action:** "Try a live stack", separate from venue sales.
- **Format:** 20–30s.

### 11. Real owner: one specific change
- **What:** 30–45s with a real owner and a quick look at their venue page. Ask for a specific story ("What did you do before, and what changed?"), not a general endorsement.
- **Accuracy:** no numbers on screen unless the venue can back them up.
- **When:** once a real venue is live and agrees to appear.

### 12. We set it up with you
- **Hook:** "Is this hard to set up?"
- **Shows:** the invite email, the setup checklist, the owner manual PDF, then the venue live.
- **Why:** turns "no self-serve signup" into a selling point.
- **Check first:** the owner manual and invite email are being revised; film only the version that's on production.

### 13. Can I still use Messenger?
- **Hook:** "Your players already message your page. That's okay."
- **Shows:** a player asks in chat, the owner replies with the booking link, the player checks availability and books.
- **Accuracy:** Plotline has no Messenger integration; this is just replying with a link. Generic chat look, as in #1.
- **Why:** handles a likely objection and pairs naturally with #1.
- **As built (2026-11-24):** 20 s, Dinkhaus Pickleball, the owner pastes the booking link (no copy-link button exists) and the venue's real link preview text shows; the player books a free slot, pays, waits for review; the owner approves and the player replies "Confirmed na po!". Two hooks tried; A "Your players already message your page. That's okay." chosen over B "Keep the chat. Skip the back-and-forth.". As built: `keep-the-chat/plan.md`.

### 14. A booking comes in after hours
- **Hook:** "11 PM. Your front desk is closed. Bookings aren't."
- **Shows:** a player checks the schedule at night, reserves and submits the receipt; the next morning staff review it and approve.
- **Accuracy:** the slot is held while the venue reviews; it isn't confirmed until staff approve.

### 15. Owner FAQ series
- **What:** one question per short video, answered on screen: "Who pays the ₱10?", "How do payments work?", "Who sets up my venue?", "Can my staff use it?"
- **Why:** turns repeated sales questions into content. Start only with answers verified in the product.

### 16. From a Facebook post to a booking
- **Shows:** the open-slots image (#2) on a fictional venue's page, the booking link, a player choosing an open slot.
- **Why:** joins #2 and #9 into one journey that's easy to follow.

### 17. Founder walkthrough: what is Plotline?
- **What:** a person introduces Plotline in one sentence, then shows a booking page and the owner dashboard, and ends with "Message us for a walkthrough."
- **Why:** gives the brand a face, and works as a pinned introduction or something to send an interested owner.
- **Format:** 60–90s, 16:9 plus a 9:16 cut.

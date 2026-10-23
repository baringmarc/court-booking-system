# Demo video script

A walkthrough of Claudex Courts, about 3 to 4 minutes. Record it at 1080p, with one browser window for the player (phone size, 390 × 844 in device mode) and one for staff (desktop). Use the local stack with demo data (`npm run screenshots` shows how to set it up), or the live demo in PayMongo test mode.

**Before recording:**
- Pick a date 3 days ahead with free pickleball slots, and create an open play session on it (10 AM to 12 PM).
- Set the venue's address, a few amenities and social links in `/admin/settings`.
- Have an admin account signed in on the desktop window.

---

## 1. The venue (0:00 to 0:30), phone

**On screen:** the home page. Scroll past the hours, the amenity chips and the courts. Tap a court photo to open the full-screen viewer, swipe once, then close it. Show the Location card with the map, and open a "Good to know" panel.

**Narration:** "Claudex Courts is a booking app for a single multi-sport venue. Players see the courts, the amenities, where the venue is and its policies, all set by the staff in the admin area."

## 2. Picking a time (0:30 to 1:05), phone

**On screen:** Book now, then switch to Pickleball and go 3 days ahead. Point at the legend. Tap an "Open play" slot to show the details dialog with the RSVP link, then close it. Tap 1 PM, then 2 PM, to extend the selection. Show the selection bar with the total.

**Narration:** "The grid is live. Each slot shows its time range and price. Booked, closed and open play slots look different in more than colour. Open play can't be booked here; it shows the session's details and links instead. Prices come from the server, by day and hour."

## 3. Checking out and paying (1:05 to 1:50), phone

**On screen:** Continue to checkout, and fill in the guest details. Point at the cancellation policy link. Confirm. On the booking page, tap "Pay online with PayMongo", show "Taking you to PayMongo…", and pay with a test method on PayMongo's page. Come back to "Payment received. Your booking is confirmed."

**Narration:** "Guests don't need an account. The times are held while they pay. Online payments go through PayMongo's hosted checkout in test mode, and a signed webhook confirms the booking on its own. The guest's private link lives in the URL fragment, so it never reaches a server log."

## 4. Paying manually (1:50 to 2:20), phone, then desktop

**On screen:** a second booking, paid by uploading a receipt image. Switch to the desktop admin: Bookings, open the proof, and approve it. The guest's page now shows Confirmed.

**Narration:** "Players can also pay by GCash or bank transfer and upload a receipt. Staff see the proof next to the amount, approve it or reject it with a reason, and the player can upload again."

## 5. Running the venue (2:20 to 3:10), desktop

**On screen:**
- The dashboard: today's courts with full names, the proofs to review and today's takings.
- "+ Walk-in": record one.
- Open play: create a session, and show the error when it overlaps a booking.
- Schedule: set a day that closes at 2 AM, and point out "closes next day".
- Settings: tick an amenity.

**Narration:** "The admin area is a separate, lazy-loaded app shell. Walk-ins, open play, overnight hours and the venue's details are all managed here. The rules are enforced in Postgres: an exclusion constraint makes double booking impossible, and every write goes through a checked RPC."

## 6. How it's built (3:10 to 3:40), desktop

**On screen:** briefly show the repo: the migrations folder, a pgTAP test, `npm run verify` passing in a terminal, and the Playwright report at phone size.

**Narration:** "It's built with React, TypeScript and Supabase. Row Level Security is on every table, there are pgTAP tests for each rule acting as a guest, a player and an admin, and Playwright runs every flow at desktop and phone sizes with accessibility checks. Thanks for watching."

# Demo video script

A walkthrough of Claudex Courts, about 4 to 5 minutes. Record it at 1080p, with one browser window for the player (phone size, 390 × 844 in device mode) and one for staff (desktop). Use the local stack with demo data (`npm run screenshots` shows how to set it up), or the live demo in PayMongo test mode.

**Before recording:**
- Pick a date 3 days ahead with free pickleball slots, and create an open play session on it (10 AM to 12 PM).
- Set the venue's Maps link, a few amenities, social links, a waiver and one or two payment accounts with QR codes in `/admin/settings`.
- Have an admin account signed in on the desktop window.
- Have one confirmed booking for later today or tomorrow (book it, upload a proof, approve it) to reschedule in scene 6, and a few paid bookings so the earnings have numbers. Use `npm run db:reset:local` first if the local data is cluttered with test runs.

---

## 1. The venue (0:00 to 0:30), phone

**On screen:** the home page. Scroll past the hours, the amenity chips and the courts. Tap a court photo to open the full-screen viewer, swipe once, then close it. Point at the address with its pin (it opens Google Maps) and the quick facts under the venue name, and open a "Good to know" panel.

**Narration:** "Claudex Courts is a booking app for a single multi-sport venue. Players see the courts, the amenities, where the venue is and its policies, all set by the staff in the admin area, in the venue's own color preset."

## 2. Picking a time (0:30 to 1:05), phone

**On screen:** Book now, then open the date calendar, pick the day 3 days ahead, and switch to Pickleball. Point at the legend and at the open play session, which is one block over its two hours. Tap an "Open play" slot to show the details dialog with the RSVP link, then close it. Tap 1 PM, then 2 PM, to extend the selection. Show the selection bar with the total.

**Narration:** "The grid is live. Each slot shows its time range and price. Booked, closed and open play slots look different in more than colour. Open play can't be booked here; it shows the session's details and links instead. Prices come from the server, by day and hour."

## 3. Checking out and paying (1:05 to 1:50), phone

**On screen:** Continue to checkout, and fill in the guest details (the mobile number is optional). Point at the booking fee line, the cancellation policy link and the waiver checkbox. Confirm. On the booking page, tap "Pay online with PayMongo", show "Taking you to PayMongo…", and pay with a test method on PayMongo's page. Come back to "Payment received. Your booking is confirmed."

**Narration:** "Guests don't need an account. The times are held while they pay. Online payments go through PayMongo's hosted checkout in test mode, and a signed webhook confirms the booking on its own. The guest's private link lives in the URL fragment, so it never reaches a server log."

## 4. Paying manually (1:50 to 2:20), phone, then desktop

**On screen:** a second booking, paid by uploading a receipt image. Switch to the desktop admin: Bookings, open the proof, and approve it. The guest's page now shows Confirmed.

**Narration:** "Players can also pay by GCash or bank transfer: they scan the venue's QR code, upload a receipt and say which account they paid with. Staff see the proof next to the amount (and the account), approve it or reject it with a reason, and the player can upload again."

## 5. Running the venue (2:20 to 3:15), desktop

**On screen:**
- The dashboard: today's courts with full names (a booking is one block over its hours), the proofs to review, and the earnings. Switch between Today, This week and This month, point at Total revenue, Your earnings and Plotline fees, the collected total per method, the change from the period before, the occupancy table and the daily bars, then use "Export bookings (CSV)" and "Export payments (CSV)".
- Leave the tab in the background while a guest books: the title shows the new-booking count. (Walk-ins are hidden unless `VITE_FEATURE_WALK_INS=true`, so skip them.)
- Open play: create a session, and show the error when it overlaps a booking.
- Schedule: set a day that closes at 2 AM, and point out "closes next day".
- Settings: pick a website color preset and drag a court into a new order.

**Narration:** "The admin area is a separate, lazy-loaded app shell. The dashboard shows what came in, by payment method, and how full the courts are. Walk-ins, open play, overnight hours and the venue's details are all managed here. The rules are enforced in Postgres: an exclusion constraint makes double booking impossible, and every write goes through a checked RPC."

## 6. Moving a booking (3:15 to 3:55), desktop, then phone

**On screen:** Admin → Bookings, open the confirmed booking, and press "Reschedule". Pick tomorrow and another pickleball court (only same-sport courts are offered, and only starts where every hour is free) and a start hour, then save without a reason to show the message. Type "Rain: the court is wet" and save. Switch to the player's phone window and reload the booking's private link: it shows "Schedule changes" with the new time and the reason. Open Mailpit to show the email.

If the booking has already started (do this with a booking made for the current hour, inserted locally), choose "Move from" the next hour: the first hour stays, and the rest becomes its own booking with its own reference, which the player sees in "Schedule changes" ("1 hour moved to …").

**Narration:** "Rain happens. Staff can move a confirmed booking to another court or time, and the player sees why. The price and payment don't change. If the booking has already started, only the rest moves, as a separate booking that shares the same private link, so nothing already played is rewritten. Every change is kept in a history table, and the player gets an email."

## 7. How it's built (3:55 to 4:25), desktop

**On screen:** briefly show the repo: the migrations folder, a pgTAP test, `npm run verify` passing in a terminal, and the Playwright report at phone size.

**Narration:** "It's built with React, TypeScript and Supabase. Row Level Security is on every table, there are pgTAP tests for each rule acting as a guest, a player and an admin, and Playwright runs every flow at desktop and phone sizes with accessibility checks. Thanks for watching."

# Plotline audit: competitors, gaps and what to build next

*Audit date: 20 November 2026, Asia/Manila. Scope: court-booking-system and plotline-site as one product, plus Philippine competitors. Live copy: [Claude doc](https://claude.ai/artifact/XBv3Rn1fVQuyom8fD4cnm9). Roadmap board: [Whiteboard](https://claude.ai/artifact/6qafxoU8Wmu76s5foKuiCn).*

## Bottom line

Plotline's engineering is well ahead of its market proof: the product is strong, and the biggest risk is that no venue is using it yet. Six findings matter most.

1. **Land two or three pilot venues before building anything else.** The repo has 29 milestones, about 630 unit tests and roughly 800 database tests, and no live venue. Every feature decision below gets better once a real owner uses it daily. Offer concierge setup and waived fees for the first three months in exchange for a case study.
2. **The Philippine market is more crowded than your docs assume.** [Taradula](https://taradula.com/list-your-venue) is live in Cebu and Bohol with ₱0 setup, ₱0 monthly and a ₱15 player fee, which is almost your model on your home turf. "No setup fee" is no longer an edge. Sparrk, Onda Fit, Sports360 and Pickleballer target the same owners.
3. **Fix distribution before features.** A venue's booking link currently shares as a blank card titled "Plotline" in Messenger and Facebook, because the page is an empty app shell. Owners and players share links in exactly those apps. A small Cloudflare Worker change fixes it.
4. **Four features would give Plotline a real edge:** an AI check of GCash and bank payment screenshots, open play with sign-up and payment tied into Paddle Stack, reminders, and recurring bookings with prepaid packs. The first two are things no competitor I found offers.
5. **A ₱10 flat fee is thin.** It is about 1.3% of a ₱750 booking. A mid-sized venue produces roughly ₱2,300 a month in fees, so you need 30 or more venues, or more revenue layers, to make this a livelihood.
6. **Several gaps would bite on first real traffic.** Resend's free plan caps sending at 100 emails a day (re-check), the runbook is unwritten, uptime checks were postponed and restores are proven only locally, there is no refund ledger or offboarding process, and Plotline's business registration needs confirming before you invoice.

## Baseline: what is already strong

Plotline's back office is deeper than most local competitors, and Milestone 27 fixed most of what the 12 Nov product review found. I read both repos (SPEC, TASKS, schema, routes, Edge Functions, marketing config) and the saved review; I did not run the apps or the test suite.

**Strong today**

- **Correctness:** an exclusion constraint makes double booking impossible, prices are computed on the server, and every table has row-level security.
- **Player flow:** guest checkout with no account, a private booking link that stays out of server logs, manual proof upload with QR and copy buttons, and slot states that do not rely on colour alone.
- **Owner tools:** a setup checklist, schedule with breaks and promo rates, earnings by payment method, CSV export, rescheduling that keeps history, staff invites, and statements with PDF invoices.
- **Brand per venue:** its own `<slug>.plotline.fit` address and six colour presets. Taradula and Sparrk offer a link or a listing, not a styled page.
- **Paddle Stack:** a free open-play queue with six formats, a TV board, live sharing by QR and share cards. I did not find a comparable free tool from any competitor.
- **Operations:** a platform console, lead tracking, monthly invoices, nightly backups, Sentry and a release preflight.

**Already fixed since 12 Nov (do not redo)**

- Fee-inclusive total in the slot selection bar, and "Reserve and continue to payment" wording with the cancellation cutoff shown at checkout.
- Booking page with three status steps and payment first, one guided payment path, and "Try this time again" after an expired hold.
- Slot grid visible sooner on phones, and an owner dashboard that opens on today with working deep links.
- PayMongo promises removed from the marketing site, plus a sitemap and share tags for Paddle Stack.

## Competitive landscape

At least five Philippine products now court the same venue owners, and most use the same pattern: free for the venue, a small fee on the player. All figures below are what each vendor publishes; I did not test any product hands-on.

| Product | What it is | Cost to the venue (as published) | Worth noting |
| --- | --- | --- | --- |
| [Taradula](https://taradula.com/list-your-venue) | Booking links plus a search listing, Cebu and Bohol first | ₱0 setup, ₱0 monthly, ₱15 player fee per online booking (venue may absorb it), invoiced weekly | Players pay the owner's own GCash and upload proof, the same as you. Has recurring weekly bookings, store credit for rain-outs, open play with price and capacity, limited staff logins, a QR code and printable slot poster, and Google city pages. Its page text claims 495 players while its live counters show zero. |
| [Sparrk](https://www.sparrk.ph/) | Court discovery plus open play and club events | Free listing; 5% convenience fee per paid booking, venue chooses how much to cover; payouts through a Sparrk wallet | Lists 38 venues in 28 cities. Court queue board, multi-session passes, and "Rallie", an AI assistant that answers players on Messenger and takes payment in chat. |
| Onda Fit ([Tatler](https://www.tatlerasia.com/lifestyle/sports/onda-fit-pickleball), [Freeman](https://www.philstar.com/bansa/2026/06/12/2534694/pickleball-boom-fuels-sports-tech-growth-philippines)) | Booking, payments, members and analytics, with player matching | Not published | The Courts of Cebu reports over 2,300 bookings since April 2026, from sponsored coverage. Claims BSP, BIR and Data Privacy Act compliance, waitlists and email plus SMS confirmations. Also live at Thirsty Pickle in Cebu. |
| Sports360 ([example listing](https://reclub.co/m/PUXEOG)) | App with open play and court booking | Not found | Venues post Sports360 links inside their Reclub meets and send players there to pay. I could not open its own pages. |
| [Pickleballer](https://huntscreens.com/products/pickleballer) | Directory plus open play, coaches and DUPR logging | Not published | A third-party listing claims 336 venues in 105 cities. I did not verify it on the vendor's site. |
| [Reclub](https://help.reclub.co/hc/reclub-help/articles/1765845878-how-to-book-a-court-on-reclub) | Social app where hosts organise meets | Not a booking tool | Its help centre says it does not support court booking. Philippine venues post "Court Reserved" meets and ask for GCash proof in the chat, which is a manual reservation log. |
| [Playtomic](https://playtomic.com/clubs/prosmash-alabang) | European padel and racket platform | Subscription tiers; commission set in the sales agreement | A Manila club lists membership tiers there. A rival's page claims a 4% commission, so treat that figure as unverified. |
| [CourtReserve](https://courtreserve.com/) | US club management suite | Subscription; DUPR sync is a [US$25 a month add-on](https://intercom.help/courtreserve/en/articles/8265424-dupr-set-up-dupr-integration) | Claims 2,300+ facilities. Shows what a mature feature set looks like: reminders, packs, access control, Reserve with Google. |

**What the pattern says**

- **Players live on Reclub and Facebook.** Reclub does no booking, so venues improvise with meets, GCash numbers and screenshots in chat. That manual proof handling is the exact pain Plotline removes, and these venues are your best leads.
- **Pricing has converged.** Taradula's ₱15 and Sparrk's 5% leave Plotline's ₱10 only ₱5 cheaper than the closest match. That is not a reason to switch on its own.
- **Open play is where everyone is building.** Sparrk, Sports360, Pickleballer and Taradula all handle sign-ups and payment per player. Plotline's open play is an announcement with external links.

**Market size.** Pickleball started in Cebu in 2016. The federation reported [more than 200 registered clubs and 13,000 members in 2025](https://tribune.net.ph/2026/06/23/the-meteoric-rise-of-pickleball-in-phl), community leaders now estimate 300 or more clubs, and the IP office puts it at [roughly 400](https://www.ipophil.gov.ph/news/pickleballs-next-shot-rules-ip-rights-and-the-road-to-the-olympics/). SM runs [102 courts in 32 malls](https://www.theasianaffairs.com/pickleball-courts-in-metro-manila/), which is a big operator you should not chase. Clubs are not venues, and badminton and basketball add more courts, so treat the venue count as unknown until you count it.

## Feature gap grid

Plotline leads on owner reporting and venue branding and trails on everything that brings players back. "Not stated" means the vendor pages I read do not mention it, not that it is absent.

| Feature | Plotline | Taradula | Sparrk | Onda Fit |
| --- | --- | --- | --- | --- |
| Manual GCash or bank proof, owner approves | Yes | Yes | Not stated | Not stated |
| Online payment (GCash, Maya, card, QR Ph) | No, test mode only | No | Yes | Yes |
| Venue-branded page and own address | Yes, themes and subdomain | Personal link | Listing only | Not stated |
| Players can discover venues | No | Yes, search and city pages | Yes | Yes |
| Recurring weekly bookings | No | Yes | Not stated | Not stated |
| Store credit or prepaid passes | No | Credit for rain-outs | Passes | Not stated |
| Open play with sign-up, price and capacity | No, announcement only | Yes | Yes, pay to join | Partial |
| On-court queue and standings tool | Yes, Paddle Stack | Not stated | Yes, queue board | Not stated |
| Waitlist for full slots | No | Not stated | Not stated | Yes |
| Limited staff permissions | Partial, roles exist, same rights | Yes | Not stated | Not stated |
| Reminders before play | No | Not stated | Not stated | Confirmations by email and SMS |
| AI assistant on Messenger | No | No | Yes | Not stated |
| Walk-ins in the same calendar | Yes, off by default | Yes | Yes | Not stated |
| Earnings and reports | Deep | CSV and peak slots | Not stated | Claims analytics |
| Fee on players | ₱10 per booking | ₱15 per booking | 5% with a minimum | Not published |

Sources are the vendor pages linked in the previous section. For Plotline I checked the code and SPEC: there is no reminder email type (only five booking events), no recurring or waitlist code, and open play stores a title, details and up to three links.

## Winning venue owners

Owners switch when you remove work they do by hand and show proof from a venue like theirs, so land pilots first and polish second. Plotline has no self-serve signup, which makes your own onboarding the product. Effort labels are my estimates for one developer.

| Move | Why it works | Effort |
| --- | --- | --- |
| Recruit from Reclub meets and Facebook groups | Hosts there already post "Court Reserved" and chase GCash screenshots in chat. Pitch one thing: approve payments in one tap instead of reading screenshots. | Low, your time |
| Set up each pilot yourself on the same day | Page live with their colours, courts, hours and payment QR before they have to decide. Same-day setup beats any feature list. | Low |
| Offer founding terms to the first 2–3 venues | A fee-free first three months, as in the bottom line, plus a drafted launch announcement. This is your call; it costs little at pilot volume. | Low |
| Turn each pilot into proof | The review form on the marketing site only has demo data today. Log bookings, hours saved and no-shows for one real venue, then publish it. | Low |
| Make venue links preview properly | The app's `index.html` has a fixed title and no description, so a link pasted in Messenger shows a generic card. Set title, description and image per venue at the edge, since the app already runs on Cloudflare Workers. | Medium |
| Add a real call to action | The site config has an empty `bookCallUrl`, so visitors only get the contact form and a Messenger link. Add a 15-minute call link. | Low |
| Write two search pages | The sitemap lists four URLs. Add pages for pickleball and badminton venue owners, and one on replacing Reclub meets and screenshots. | Low |

**Pitch honestly on price.** Taradula charges ₱15 and Sparrk 5%, so ₱10 is cheaper but not a reason to switch alone. Lead with the proof workflow, the venue-branded page and Paddle Stack. I did not check whether a printable QR poster exists in the owner tools; Taradula offers one, so confirm before the first pitch.

## Winning players

Players arrive through a venue's own link, so the job is to make that link easy to share and give players reasons to come back. These items are ordered by value for effort.

- **Reminders and a calendar file.** Email has five booking events and no reminder. Add a reminder the day before and an `.ics` attachment on the confirmation. This cuts "where do I go?" messages and late cancellations.
- **Book again.** A "same time next week" button on the booking page and in the email. It is cheap, and it shows how many players would use recurring bookings before you build them.
- **Install on the home screen.** The app has no web manifest, so "Add to Home Screen" gives a plain bookmark. A manifest and icons are a small job and fit the no-native-app rule.
- **Waitlist on full slots.** Players tap "tell me if this opens" and get an email when a cancellation frees it. Onda Fit lists waitlists, so players may start to expect them.
- **Better link previews.** Same fix as in the owner section: each venue link should show the venue name and a photo when pasted into Messenger or Viber.
- **A venue directory, later.** The `public_venues` read already exists. A city page on plotline.fit would match what Taradula and Sparrk do, but with two or three venues it looks empty. Revisit at about ten.

The largest player draw is open play with sign-up and payment, covered in the next section.

## Unique features worth building

Four ideas combine pieces Plotline already has in ways competitors do not, and one solo developer can build each. None of the competitors I found offers all of them. Sizes are my estimates, not measured.

| Feature | What it does | Why it is different | Size |
| --- | --- | --- | --- |
| AI payment-proof checker | Reads the uploaded GCash or Maya screenshot, extracts amount, reference number and time, and compares them to the booking. Flags mismatches and reused reference numbers. Staff still tap approve. | Taradula and Sparrk leave proof checking to the owner. Fake or reused screenshots are the main risk of manual payment. Same pattern as the Gemini verification you built at NativeCamp. | Medium |
| Open play to Paddle Stack in one flow | Open play gets sign-up, capacity, price and payment per player. Everyone who joined is loaded into the queue board when the session starts. | Others sell the join; none I found carry players into the on-court queue. It also multiplies billable events per venue. | Medium |
| Fill-my-empty-slots tool | The owner dashboard shows tomorrow's empty hours and drafts a Facebook or Messenger post, a share card and a promo link, using the promos and share cards that already exist. | Turns reporting into revenue for the owner. Taradula shows peak slots but stops at the chart. | Small to medium |
| Release and replace | A one-tap "I can't make it" link frees the slot, notifies the waitlist and updates the board. | Pairs reminders with the waitlist so cancellations become rebookings. | Medium |

**The proof checker, in more detail**

- It only suggests; a person approves, so a wrong read costs a tap, not money.
- Duplicate detection needs a table of used reference numbers per venue. That is plain SQL and catches the commonest fraud.
- Keep the screenshot private in storage and delete it by the venue's retention rule, given the Data Privacy Act.
- Check the vendor's current per-image price before promising margins.

**Larger bets to hold back**

- A Messenger booking assistant like Sparrk's Rallie needs a Meta app review and ongoing conversation design. Defer it until you have venues that ask.
- Player ratings or DUPR sync are the US direction, and CourtReserve charges extra for them. Philippine venues do not ask for it yet in anything I read.

## Business model

The flat ₱10 fee is easy to explain but small, so grow the number of billable events per venue rather than the price of each one. Revenue below uses the assumptions from the bottom line: a ₱750 average booking and about 230 confirmed online bookings per venue per month.

| Venues | Fee revenue per month | Note |
| --- | --- | --- |
| 3 pilots | ₱6,900 | Proof, not income |
| 10 | ₱23,000 | Covers hosting and email, not a salary |
| 30 | ₱69,000 | Rough livelihood line for one person |
| 100 | ₱230,000 | Needs sales help, not just self-serve |

These are gross figures before tax, hosting and email. I did not price Supabase, Cloudflare or Resend plans, so check them before you model profit.

**What the repo already decided, and why it matters**

- **Invoice-only billing.** The plan (2026-10-26) bills venues monthly and does not split payments. You carry the collection risk, limited by a 7-day grace period and then suspension.
- **Each venue uses its own PayMongo account.** Plotline never holds player money, so you avoid payout, chargeback and refund liability. This is the right call for a solo operator.
- **The fee is non-refundable once a booking is confirmed**, unless the venue cancels.

**What online payment costs the venue**

PayMongo's percentage applies to the whole total, fee included, and the venue absorbs it. Manual proof costs nothing, so online payment is an upgrade the owner pays for, not a free extra. Rates are from [PayMongo's pricing page](https://www.paymongo.com/pricing) as I researched them; confirm before quoting, since VAT may apply.

| Method | Rate | On a ₱760 charge (₱750 plus ₱10 fee) |
| --- | --- | --- |
| QR Ph | 1.34% | ₱10.18 |
| GCash | 2.23% | ₱16.95 |
| Card | 3.125% + ₱13.39 | ₱37.14 |

The owner's cost per online payment can exceed your fee. Pitch online payment as optional, and keep manual proof as the free default.

**Revenue levers, in order**

1. **Open-play join fee.** A session of 12 players is 12 billable events instead of one. A small per-join fee, say ₱5 as a value to test, is easier to justify than raising the court fee.
2. **Recurring bookings and packs.** A four-week series is four events and locks in regular groups, which also makes the venue harder to lose.
3. **Paid add-ons that cost real money.** SMS reminders or the AI checker could be priced at cost plus margin. Keep the core free to match Taradula and Sparrk.
4. **Featured listings, later.** Only once a directory has about ten venues and real traffic.
5. **Avoid a wallet or payouts.** Sparrk runs one. It brings banking rules and liability that the current design deliberately avoids.

**Collections.** Taradula invoices weekly; you invoice monthly. For the first venues, send the running statement mid-month so nothing surprises the owner. Consider prepaid credit later, and ask an accountant whether it raises any compliance question.

Any price change goes into `docs/facts.json` first as a recorded decision, then `npm run check:drift` keeps both repos in step.

## What is missing

Most gaps are operational: they will not show in a demo but will hurt in the first month of real invoicing and traffic. Status comes from TASKS.md, SPEC and the ops docs as of today.

| Gap | Why it matters | Status in the repo | Suggested action |
| --- | --- | --- | --- |
| No Plotline payment account for invoices | Venues cannot pay a statement without one | TASKS says production has none; add it on the console Billing page. A real send has not been tried in Gmail or Outlook | Add the account, then send yourself a test invoice before the first month closes |
| Business registration and tax | You need it before invoicing real venues | Not a repo item | Ask an accountant about DTI, BIR registration, receipts and VAT or percentage tax |
| Runbook and uptime checks | One person cannot remember every step at 2 a.m. | T16.4 (uptime) and T16.5 (runbook) are postponed. Backups run nightly and restore is proven locally only. The 17 Nov region move mentions a StatusCake setup, so confirm it is live | Write the runbook, then restore a production dump onto staging once |
| Email volume | One venue's 230 bookings at about three emails each is roughly 690 a month, so about four venues fill 3,000 | Resend free limits were researched on 2026-10-18 and not rechecked. Reminders add more | Recheck the plan, and budget a paid tier before the fourth venue |
| Refund tracking | Venues refund by hand and nothing records whether it happened | M27 deferred it. "Refund due" shows for late PayMongo payments, and cancel-after-payment shows a "settle outside the app" note | Add a refund status (owed, settled, method, date) without moving money |
| Staff permissions | A front-desk hire should not see earnings or settings | M27 deferred it. Roles exist but carry the same rights | Add a front-desk role: calendar and payment approval only |
| Reminders | No reminder email exists | M27 deferred it | Promote it, as described under winning players |
| Venue offboarding | A venue that leaves needs a final invoice, an export and a freed address | Only unused venues can be deleted | Add a short offboarding checklist to the runbook |
| Online payment readiness | Only QR Ph was paid for real in tests; GCash, Maya and card are untested | M7 carry-over. The onboarding test payment in the plan is unchecked | Test each method before the first venue switches online payment on |

**Small items to tidy later**

- A deleted venue's pending file cleanups are retried only by a later delete, with no scheduled drain (T17.27).
- Open M26 minors: the invoice's averaged Rate row, Print leaving out the charge list, and `invoice_sends.provider_id` always null.
- Venue-side privacy: payment screenshots hold names and account details, so set a retention rule before adding the AI checker.

## Roadmap

Run four phases in order with a gate between each, so every new layer is built on proof from the one before. Week counts are my estimates for one full-time developer. A drawn version is on the [roadmap Whiteboard](https://claude.ai/artifact/6qafxoU8Wmu76s5foKuiCn).

| Phase | Timing | Items |
| --- | --- | --- |
| 1. Land pilots | Weeks 1 to 2 | Billing account live; business registration; link previews; book-a-call link; pilot setup in a day; runbook and uptime check |
| Gate 1 | | 2 to 3 pilots live, first statement sent |
| 2. Keep players | Weeks 3 to 6 | Reminders and .ics; book again button; web manifest; refund status; front-desk role |
| Gate 2 | | Pilots keep using it once fees start |
| 3. Build the edge | Weeks 7 to 12 | Open play and payment; Paddle Stack handoff; AI proof checker; fill-my-slots tool; join fee test |
| Gate 3 | | About ten venues live and invoiced |
| 4. Scale | Quarter 2 | Recurring bookings and packs; waitlist and release; paid email plan; directory at about ten venues |

**Why this order**

1. **Pilots first.** Every later choice gets better once a real owner uses Plotline daily, and the billing and registration items block real invoicing.
2. **Retention basics second.** Reminders, book-again, a manifest, refund status and a front-desk role are small and close known gaps.
3. **Edge features third.** Open play with payment and the proof checker are the differentiators, and pilot feedback decides their details.
4. **Scale last.** Recurring bookings, waitlists and a directory pay off only with more venues and traffic.

## What not to build yet

A solo builder wins by saying no to features that need a team or a larger network than Plotline has today. Each item below has a trigger for when to look again.

| Idea | Why wait | Revisit when |
| --- | --- | --- |
| Native iOS and Android apps | A non-goal in SPEC. A web manifest gives most of the benefit | Players ask for push notifications and reminders by email are not enough |
| Messenger booking assistant | Needs Meta app review and conversation design, and competitors' versions are unproven | Venues report that players book through Messenger chat |
| Player wallet or venue payouts | Banking rules and liability, which the invoice-only design avoids | Never, unless a partner takes the regulated part |
| Ratings, leagues or DUPR sync | The US direction; nothing I read shows Philippine venues asking | Several pilots ask for it by name |
| Public venue directory | Looks empty with two or three venues | About ten live venues |
| SMS reminders | Adds cost per message and a sender setup | Email reminders show poor reach in the pilots |
| Memberships and door access | Built for large clubs, and CourtReserve already covers it | A pilot venue runs a membership programme |
| Self-serve signup | Decided against in the SaaS plan; concierge setup is your edge | Onboarding steps are routine across about ten venues |
| Chasing mall operators such as SM | Long sales cycles and likely in-house systems | You have referenceable independent venues |

## Assumptions, limits and sources

This audit rests on reading both repositories and public vendor pages, not on running Plotline or testing competitors. Treat the numbers as planning figures.

**Assumptions**

- Pricing is ₱10 per confirmed online booking, paid by the player, with ₱0 setup and monthly. You confirmed this, and `docs/facts.json` agrees.
- An average booking is ₱750, and a mid-sized venue has about 230 confirmed online bookings a month. Both are my planning guesses, not data.
- About three emails are sent per booking. I counted five email kinds in the code but did not measure real volume.
- Build sizes (small, medium) are my estimates for one full-time developer.
- Scope is the Philippines nationwide, and capacity is you alone, full time.

**Limits**

- Competitor details are what each vendor publishes. Their claims, counts and fees were not verified, and "not stated" does not mean absent.
- I could not open Sports360's own pages, and Onda Fit's venue counts come from sponsored press coverage.
- Legal and tax points are prompts for an accountant or lawyer. I am not either.
- The repo's research notes dated 12 November were my baseline. I did not re-test every item in them.

**Repository sources**

- `court-booking-system`: README, SPEC, TASKS, `docs/PLATFORM.md`, `docs/SAAS-PLAN.md`, `docs/facts.json`, routes, Edge Functions, migrations, `docs/ops/`, and the saved product review.
- `plotline-site`: README, TASKS, `src/config/site.ts`, `src/config/pricing.ts`, `public/sitemap.xml` and the contact form.

**Web sources**

- [Taradula: list your venue](https://taradula.com/list-your-venue)
- [Sparrk](https://www.sparrk.ph/)
- [Tatler Asia on Onda Fit](https://www.tatlerasia.com/lifestyle/sports/onda-fit-pickleball)
- [Philstar on pickleball and sports tech](https://www.philstar.com/bansa/2026/06/12/2534694/pickleball-boom-fuels-sports-tech-growth-philippines)
- [Sports360 listing on Reclub](https://reclub.co/m/PUXEOG)
- [Pickleballer listing](https://huntscreens.com/products/pickleballer)
- [Reclub help: booking a court](https://help.reclub.co/hc/reclub-help/articles/1765845878-how-to-book-a-court-on-reclub)
- [Playtomic club page, Alabang](https://playtomic.com/clubs/prosmash-alabang)
- [CourtReserve](https://courtreserve.com/) and its [DUPR add-on article](https://intercom.help/courtreserve/en/articles/8265424-dupr-set-up-dupr-integration)
- [Tribune on pickleball growth](https://tribune.net.ph/2026/06/23/the-meteoric-rise-of-pickleball-in-phl)
- [IPOPHL on pickleball](https://www.ipophil.gov.ph/news/pickleballs-next-shot-rules-ip-rights-and-the-road-to-the-olympics/)
- [Pickleball courts in Metro Manila](https://www.theasianaffairs.com/pickleball-courts-in-metro-manila/)
- [PayMongo pricing](https://www.paymongo.com/pricing)

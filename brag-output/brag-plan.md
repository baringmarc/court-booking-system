# Brag plan: Plotline

**What it is:** Plotline is a court booking app for sports venues in the Philippines. Players pick a slot, pay with GCash, Maya or card, and the booking confirms itself. Owners run the venue from an admin area.
**Who it's for:** venue owners (badminton, pickleball, basketball, tennis) and their players.
**What sets it apart:** venues pay ₱0 (no setup fee, no monthly fee). Players add a ₱10 booking fee per online booking (docs/facts.json). Double booking is impossible because the database enforces it.
**Boldest claim:** "Venues pay ₱0."
**Visual hook:** a grid of empty ₱400 slots next to "An empty court earns ₱0." The slots then start filling.
**Real UI:** the /book slot grid, the selection bar, the booking card flipping to Confirmed, and the admin revenue split. All of it uses the app's own `src/index.css`, Fraunces and DM Sans, with the markup mirrored from SlotGrid, SelectionBar, BookingSummary, PayOnline and EarningsSection.
**Tone:** `default`, warm and clean in the Plotline palette (cream, espresso, sage, terracotta).
**Share caption:** "Empty courts earn ₱0. Plotline fills them."

**Privacy:** every name, reference and amount is a fictional stand-in ("Ana R.", "Ben", ref "QK7-24M"), not production data.

## Revision 2 (2026-11-20)
- Payment matches how venues run today: the player pays manually, scanning the venue's QR, uploading a receipt and tapping "Submit proof of payment". Staff tap "Approve and confirm" (the real ReviewPanel), and the player's page turns Confirmed.
- Owners are the main audience. The hook, "You approve in one tap.", "Venues pay ₱0." and an outro CTA ("Put your venue on Plotline.") speak to them, while the booking and paying scenes show players how easy it is.
- The poster is the "Venues pay ₱0." frame.

## Format
Landscape 1920×1080, 30fps, 25.0s (750 frames). Music at 120 BPM. Every cut lands on a beat.

## Storyboard

| # | Time | Scene | On screen | Sound |
|---|---|---|---|---|
| 1 Hook | 0–3 | Cream | "An empty court earns ₱0." The slot grid fills, one slot per eighth note. | Kick and bass, a tick per slot |
| 2 Reveal | 3–6 | Espresso | Tile, "plotline", "Plot your day. Fill your hours.", "Online booking for your courts" | Swell and the chord opens |
| 3 Book | 6–11 | Phone | "Players book in three taps." Tap 1 PM, 2 PM, the selection bar (₱800 + ₱10 = ₱810), Continue | Taps |
| 4 Pay | 11–14.5 | Phone | "Players pay by GCash, Maya or bank." Chips; the GCash QR, receipt.jpg attached (12.0), "Submit proof of payment" (12.5), "Payment under review" (13.0) | Taps, a soft two-note |
| 4b Approve | 14.5–18 | Admin card and phone | "You approve in one tap." The review card with the receipt; "Approve and confirm" (15.5) → Confirmed, "No proof is waiting for review."; the player's phone slides in Confirmed (15.9) | Chime at 15.5 |
| 5 Owners | 18–21.5 | Admin card | "Venues pay ₱0." / "Players add a ₱10 booking fee." Revenue split | Groove |
| 6 Outro | 21.5–25 | Espresso | Tile and wordmark, "Put your venue on Plotline.", plotline.fit | Final hit and ring-out |

## Transitions
Stagger, never a crossfade: the old content slides and fades out over 0.25s before the cut, and the new content comes in after the cut. Changes between cream and espresso are hard cuts on the downbeat.

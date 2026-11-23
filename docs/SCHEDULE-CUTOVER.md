# Schedule v2 cutover (T17.17)

Release and rollback instructions for switching a venue from the legacy `operating_hours` / `court_rates` editors to
Weekly Hours & Rates (schedule v2). **Status (2026-11-06):** steps 2 and 3 are done on staging and production (the user's approval); preflight was
partly checked there (no venue active; every venue has periods; the value comparison with `operating_hours` is still to
do before step 4). **Staging (`avhxinkecylhptysgbjx`), 2026-11-23:** steps 4–5 done (the user's approval). Preflight found
Claudex Courts' `venue_open_periods` had drifted from `operating_hours` (Tuesday closed, Wed–Fri split) with 3 future
bookings outside the periods, so its periods were first rewritten from `operating_hours` (what players saw), then both
venues were activated in one transaction. Checked after: `get_availability` unchanged, and an 11 PM close (rolled back)
ends the last slot at 23:00. **Production (`jmichyttnqygwdcksbpg`), 2026-11-23:** steps 4–5 done (the user's approval,
keeping the editor's hours). Preflight: release preflight passed, no custom courts, no future booking outside the
periods; three venues differed (claudex-courts and prj-pickle-court-sports-center had later closes in the editor,
eloy-test a split Monday). All 7 venues were activated in one transaction; `get_availability` now ends Claudex Courts'
Monday at 23:00 and its other late days at midnight. **Every venue on both hosted projects is active.**

Why this matters: the admin editor (Weekly Hours & Rates, `save_schedule`) writes `venue_open_periods`, but until a venue
is activated every player-facing consumer reads `operating_hours`, so hour changes saved in the editor never reach players.
Rates are not affected (`save_schedule` writes `court_rates`, which `slot_price` reads either way).

## What activation does
- `private.activate_schedule_v2(venue_id)` (postgres / service role only, no client RPC) takes the venue's court locks in
  id order (the same protocol as `create_booking` and `save_schedule`), sets `venue_schedule_state.schedule_v2_active`
  and bumps `schedule_revision`. Every booking, availability, pricing, open-play and staff consumer reads the effective
  periods from then on, together (T17.11–T17.14).
- While a venue is active, client writes (anon / authenticated) to `operating_hours` and `court_rates`, and
  `set_operating_hours`, fail with `P0001`, hint `schedule_v2_managed`, "Schedule is managed in Weekly Hours & Rates."
  `save_schedule` (definer) is the only writer. An old browser tab therefore cannot overwrite split hours; it shows the
  message above. Venues that are not active are unaffected.

## Release order (each hosted step needs the user's approval)
1. Preflight on the target project: migration history matches; per venue, `operating_hours` rows (7) equal
   `venue_open_periods` (counts and values); no venue has `schedule_v2_active` yet.
2. `npm run db:push` the T17.11–T17.14 and T17.17 migrations (all backward compatible, activation still false everywhere).
   Done 2026-11-06 on staging and production.
3. Deploy the frontend that contains the T17.13–T17.17 consumers (Weekly Hours & Rates; court page links to it).
   Done: production runs it on Cloudflare (`*.plotline.fit`).
4. Activate one venue (the demo first): `select private.activate_schedule_v2('<venue uuid>');` (SQL editor or service role).
   Smoke: book, walk-in, reschedule, open play, the Schedule page save.
5. Activate the remaining venues the same way.
   Done 2026-11-23: every venue on staging and production is active.

## New venues (T32.1)
From migration `20261123052637_t32_1_new_venues_active` on, a new venue starts active: `venue_schedule_state` defaults
`schedule_v2_active` to true and the `venues_initialize_schedule` trigger inserts it so. `create_venue` still writes the
default 06:00–22:00 `operating_hours` (as the definer, so the legacy-write guard lets it through), and they are mirrored
into `venue_open_periods`. No manual activation step is needed. `npm run preflight:release` fails, naming the venue, when
any venue on the target is still on the legacy hours. Until that migration is on a project, activate each new venue
there by hand (step 4).

## Rollback
`select private.deactivate_schedule_v2('<venue uuid>');` switches the venue back to the legacy hours **only when the
legacy hours can hold the schedule**: at most one period per weekday, no custom courts, whole-hour periods under 24 hours
(or exactly 00:00–24:00). It then copies the periods into `operating_hours` (closed days become `is_closed`). Otherwise it
raises `schedule_rollback_unsafe` and changes nothing: split hours are never replaced by their enclosing range, so a
rollback never widens a gap. Once split or custom data exists an old one-range deployment is not a lossless rollback:
**fix forward, or disable schedule editing**, and keep the model. Contract removal of the legacy tables is a later task.

## Marketing handoff
No `plotline-site` change: `public_venues`, `site-contact` and `site-review` are untouched, and the public schedule is read
through the platform's own RPCs. Nothing for the marketing repo to deploy for this task.

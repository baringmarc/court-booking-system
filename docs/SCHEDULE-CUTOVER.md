# Schedule v2 cutover (T17.17)

Release and rollback instructions for switching a venue from the legacy `operating_hours` / `court_rates` editors to
Weekly Hours & Rates (schedule v2). **Status (2026-11-06):** steps 2 and 3 are done on staging and production (the user's approval); preflight was
partly checked there (no venue active; every venue has periods; the value comparison with `operating_hours` is still to
do before step 4). **No venue is activated.** Each remaining hosted step needs its own approval.

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

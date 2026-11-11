# Uptime checks (T16.4)

Service: **StatusCake** free plan (the user's choice, 2026-11-08). Reported limits: 10 uptime monitors, 5-minute checks, commercial use allowed, and the account must be logged into at least every 90 days or it is deactivated. These come from third-party pages; confirm them on statuscake.com when you sign up, and put a calendar reminder to log in every 60 days.

## Setup (you, in the StatusCake dashboard)

1. Sign up with `baringmarc1@gmail.com` and confirm the email.
2. **Contact group:** Alerts → Contact Groups → new group "Plotline" with your email (add SMS or Slack later if wanted).
3. **Monitor 1, player site:** Uptime → New → HTTP(S)
   - URL `https://claudex-courts.plotline.fit/`
   - Check rate 5 minutes, expected status 200, contact group "Plotline".
4. **Monitor 2, Supabase API (production, ref `sfssolhsthteonzgzfos`):** Uptime → New → HTTP(S)
   - URL `https://sfssolhsthteonzgzfos.supabase.co/auth/v1/health`
   - The endpoint answers 401 without a key. Preferred: add the request header `apikey: <production publishable key>` (the same public key the app ships; never the service-role key) and expect 200. If the free plan has no custom headers, accept 401 as up. That proves the API gateway answers, not the database.
   - Check rate 5 minutes, contact group "Plotline".
5. Optional: a third monitor on `https://app.plotline.fit/` (the console).

## Proof (acceptance)

1. Both monitors show **Up** after the first check.
2. Force a failure on a throwaway copy of monitor 1: change its URL to `https://claudex-courts.plotline.fit/does-not-exist-uptime-test` with expected status 200 (this route returns the app shell, so use `https://httpstat.us/503` if it still reads Up). Wait for the alert email, then delete the test monitor. Do not break production to test.
3. Record the date and the alert's arrival in TASKS.md T16.4 Notes.

Checks ping public URLs only. No secret is stored in this repo.

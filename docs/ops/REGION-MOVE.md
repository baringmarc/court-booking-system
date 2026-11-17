# Moving production Supabase to Singapore: step by step

> Version 2, 2026-11-17. The first version (2026-11-16) said the same things in a denser form; this one splits every task into small steps.

## Read this first

**The problem.** Production (`plotline-production`, ref `sfssolhsthteonzgzfos`) is in **Ireland (eu-west-1)**. The venues and players are in the Philippines, so every request travels to Europe and back. Staging is already in Singapore.

**Why it's a move, not a setting.** Supabase can't change a project's region. So we:
1. make a **new** production project in Singapore,
2. set it up exactly like the old one,
3. **practise** copying everything across (the rehearsal),
4. on moving day, briefly stop the old project, copy everything for real, and point both websites at the new project,
5. keep the old project switched off for a while as a safety net, then delete it.

**What gets copied:** all data, all user accounts (people keep their passwords and Google sign-in), all uploaded files (photos, QR codes, payment proofs, billing images), the database structure, the Edge Functions and the scheduled jobs.

**What people will notice:**
- About **45 minutes** where the sites show errors (you choose when).
- Everyone has to **sign in once more** afterwards.
- Invitations that were sent but not yet accepted stop working. You re-send them (Step 6.6).

**How long it takes:**

| Part | When | Time |
| --- | --- | --- |
| 1. Get ready | A day or more before | 1–2 hours |
| 2–3. Create and set up the new project | A day or more before | 2 hours |
| 4. Rehearsal | Before moving day | 1 hour |
| 5. Moving day | Your chosen window | 45 minutes |
| 6. Checks | Straight after | 30 minutes |
| 8. Clean up | Over the next 30 days | short tasks |

### Words used in this guide

| Word | Meaning |
| --- | --- |
| **OLD** | The current production project in Ireland, ref `sfssolhsthteonzgzfos` |
| **NEW** | The new production project in Singapore you create in Part 2 |
| **Ref** | A project's 20-letter id. It's in the dashboard address: `supabase.com/dashboard/project/<ref>` |
| **Terminal** | The macOS Terminal app (or the terminal in VS Code) |
| **Session pooler URL** | The address the copy tools use to connect to a database. Step 1.7 shows where to find it. |
| **Publishable key** | The public key the websites use (starts with `sb_publishable_`). Safe to have in a website. |
| **Secret key** | The private admin key (starts with `sb_secret_`). Never put it in a website or a repo. |

### Safety rules (for the whole guide)

1. **Never run `supabase link`** during this move. The CLI stays linked to staging. Every command says which project it's for.
2. **Never run `supabase config push`.** It would overwrite production's sign-in settings with local test settings.
3. The working folder holds customer data (names, emails, payment proofs). It lives at `~/plotline-region-move`, **never inside a repo** (both repos are public). You delete it at the end.
4. Copy each command exactly. When a step says **"You should see"**, check that before you go on. If you see something else, stop and ask me.
5. The only command that deletes data (`wipe-new.sql`) only works on NEW before moving day finishes. It refuses to run on OLD.

---

## Part 1. Get ready (a day or more before)

### Step 1.1: Install the database tools
**Why:** copying the data needs `pg_dump` and `psql` version 17 (production runs Postgres 17), and `jq` for reading JSON.

1. Open Terminal.
2. Paste and run:
   ```bash
   brew install postgresql@17 jq
   echo 'export PATH="$(brew --prefix postgresql@17)/bin:$PATH"' >> ~/.zshrc
   source ~/.zshrc
   ```
3. Check the versions:
   ```bash
   pg_dump --version
   psql --version
   ```
   **You should see:** both lines say `17.` something.

### Step 1.2: Make room for a third project
**Why:** the free plan allows only **2 active projects**, and you already have staging and production.

Choose one:
- **Option A (recommended): upgrade to Pro.** Production needs it at the first paying venue anyway, and Pro projects never pause by themselves.
  1. Go to https://supabase.com/dashboard → click your organization → **Billing**.
  2. Click **Change subscription plan** → choose **Pro** → confirm.
- **Option B: pause staging during the move.**
  1. Open the staging project (`court-booking-system`).
  2. **Project Settings** (gear icon, bottom left) → **General** → **Pause project** → confirm.
  3. Remember to restore it at the end (Step 8.5).

### Step 1.3: Write down the list of secrets
**Why:** the Edge Functions use secrets (API keys and settings). Supabase never shows their values again, so you collect each value from where it came from.

1. In Terminal, go to the project folder and list the secret names on OLD:
   ```bash
   cd ~/Documents/Projects/court-booking-system
   npx supabase secrets list --project-ref sfssolhsthteonzgzfos
   ```
   **You should see:** a table of names. Ignore the ones that start with `SUPABASE_` (Supabase adds those itself).
2. Open a note in your password manager called **"Plotline NEW production secrets"**. For every name in the list, find its value using this table:

| Secret name | What to put |
| --- | --- |
| `EMAIL_TRANSPORT` | Write `resend` (we use `disabled` until moving day) |
| `EMAIL_FROM` | `bookings@mail.plotline.fit` |
| `RESEND_API_KEY` | A **new** key (Step 1.4) |
| `EMAIL_WORKER_SECRET` | A **new** random value (Step 1.5) |
| `LEAD_ALERT_TO` | The email address(es) that get new-lead alerts today, comma-separated |
| `PAYMONGO_SECRET_KEY` | PayMongo dashboard → switch to **Test mode** → **Developers** → **API keys** → copy the **Secret key** (starts with `sk_test_`) |
| `PAYMONGO_WEBHOOK_SECRET` | Leave blank for now; you get it in Step 3.6 |
| `PUBLIC_ROOT_DOMAIN` | `plotline.fit` |
| `PUBLIC_SITE_URL` | The same value as today. If you don't have it written down: `https://court-booking-system-ashen.vercel.app` |
| `SITE_ORIGINS` | `https://plotline.fit,https://www.plotline.fit` |
| `TURNSTILE_SECRET_KEY` | Cloudflare dashboard → **Turnstile** → click the plotline.fit widget → **Settings** → copy **Secret key** |
| `SENTRY_DSN` | Sentry → your project → **Settings** → **Client Keys (DSN)** → copy the DSN |
| `OWNER_GUIDE_URL` | Only if it's in the list. Ask me for the value if you don't know it. |

### Step 1.4: Create a new Resend key
**Why:** Resend shows a key only once, so you can't copy the old one.

1. Go to https://resend.com → **API Keys** → **Create API Key**.
2. Name: `plotline-production-sg`. Permission: **Sending access**. Domain: `mail.plotline.fit`.
3. Click **Add**, copy the key (starts with `re_`) and save it in your note as `RESEND_API_KEY`.

### Step 1.5: Create the email worker secret
**Why:** the new project's scheduled job uses this to prove to the email function that it's allowed to send.

1. In Terminal:
   ```bash
   openssl rand -hex 32
   ```
2. Copy the 64-character result and save it in your note as `EMAIL_WORKER_SECRET`.

### Step 1.6: Get the Google sign-in details
**Why:** the new project needs the same Google sign-in setup.

1. Go to https://console.cloud.google.com → choose the Plotline project → **APIs & Services** → **Credentials**.
2. Under **OAuth 2.0 Client IDs**, click the web client that Supabase uses.
3. Copy the **Client ID** into your note.
4. For the **Client secret**: if you have it saved, copy it. If not, click **Add secret**, copy the new one and save it. The old secret keeps working.
5. Leave this tab open; you come back in Step 3.5.

### Step 1.7: Get OLD's database connection address
1. Open OLD in the dashboard: https://supabase.com/dashboard/project/sfssolhsthteonzgzfos
2. Click **Connect** (top of the page).
3. Choose the **Connection String** tab. Under **Method**, choose **Session pooler**.
4. Copy the URI. It looks like:
   `postgresql://postgres.sfssolhsthteonzgzfos:[YOUR-PASSWORD]@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
5. Save it in your note as **OLD_DB_URL**, with `[YOUR-PASSWORD]` replaced by the database password.
6. **Don't know the password?** Go to **Project Settings** → **Database** → **Reset database password** and set a new one. The nightly backup uses this password too, so also update the GitHub secret `BACKUP_DB_URL` (GitHub → court-booking-system → **Settings** → **Secrets and variables** → **Actions**) with the new address.

### Step 1.8: Create a read-only Supabase access token
**Why:** used once, in Step 3.5g, to compare OLD's and NEW's sign-in and Data API settings automatically. It only needs to **read** settings, so you give it read access and nothing else. The Supabase CLI keeps using your normal login for everything else.

1. Go to https://supabase.com/dashboard/account/tokens (or: dashboard → your avatar, top right → **Account preferences** → **Access Tokens**).
2. Click **Generate new token**. Don't use **Create legacy token**: that one has full access to your whole account.
3. **Name:** `region-move`.
4. **Expiry:** 30 days (pick the preset, or a custom date a few days after your planned Step 3.5). You delete it in Step 8.3 anyway.
5. **Resource access:** choose **all projects in selected organizations**, then tick your Plotline organization only.
   *Why not "selected projects"?* NEW doesn't exist yet, and you can't change a token's access after creating it. Read-only access to staging too is harmless.
6. **Permissions:** leave every row on no access except these three, which you set to **Read** (not Read-write):

   | Group | Permission | Level | Used for |
   | --- | --- | --- | --- |
   | Application services | **Auth Config** | Read | reading the sign-in settings |
   | Application services | **Data API Config** | Read | reading the Data API settings |
   | Application services | **Data API JWT Secret** | Read | Supabase requires it alongside Data API Config to read those settings |

   Leave everything else alone, in particular **Database**, **Edge Function Secrets**, **API Key Secrets** and anything marked Read-write.
7. Click through to the review screen. **You should see:** only those three permissions, all **Read**, on your Plotline organization. If it shows anything else, go back and fix it.
8. Create the token. Copy it (starts with `sbp_`) into your note as **REGION_MOVE_TOKEN**. Supabase only shows it once; if you lose it, delete it and make a new one.

If Step 3.5g later prints `missing_permissions`, the token is missing one of the three: delete it, make a new one with the listed permission added (still **Read**), and update `env.sh`.

### Step 1.9: Make the private working folder
1. In Terminal:
   ```bash
   mkdir -p ~/plotline-region-move/{dump,storage,sql,check}
   chmod 700 ~/plotline-region-move
   ```
2. Create the settings file:
   ```bash
   cat > ~/plotline-region-move/env.sh <<'EOF'
   export MOVE=~/plotline-region-move
   export WT=~/Documents/Projects/cbs-region-move
   export OLD_REF=sfssolhsthteonzgzfos
   export NEW_REF=FILL_IN_IN_STEP_2_3
   export OLD_DB_URL='PASTE_OLD_DB_URL_HERE'
   export NEW_DB_URL='FILL_IN_IN_STEP_2_3'
   export EMAIL_WORKER_SECRET='PASTE_FROM_STEP_1_5'
   # Not named SUPABASE_ACCESS_TOKEN on purpose: that name would replace the CLI's
   # login with this read-only token, and the CLI steps would fail.
   export REGION_MOVE_TOKEN='PASTE_FROM_STEP_1_8'

   # Stops you if the two projects are mixed up.
   guard() {
     [ "$NEW_REF" != "$OLD_REF" ] || { echo "STOP: NEW_REF is the same as OLD_REF"; return 1; }
     case "$OLD_DB_URL" in *"$OLD_REF"*) ;; *) echo "STOP: OLD_DB_URL is not the old project"; return 1;; esac
     case "$NEW_DB_URL" in *"$NEW_REF"*) ;; *) echo "STOP: NEW_DB_URL is not the new project"; return 1;; esac
     echo "OK: OLD=$OLD_REF NEW=$NEW_REF"
   }
   EOF
   chmod 600 ~/plotline-region-move/env.sh
   ```
3. Open it in TextEdit and fill in `OLD_DB_URL`, `EMAIL_WORKER_SECRET` and `REGION_MOVE_TOKEN` (keep the single quotes around each value):
   ```bash
   open -e ~/plotline-region-move/env.sh
   ```
4. Save and close. You fill in the two `NEW` lines in Step 2.3.

### Step 1.10: Create the helper scripts
**Why:** small SQL files that the later steps use. Paste this whole block into Terminal once:
```bash
cd ~/plotline-region-move/sql

cat > counts.sql <<'EOF'
-- How many rows each table has, plus users and files per bucket.
select format('%s.%s', n.nspname, c.relname),
       (xpath('/row/n/text()',
              query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p') and n.nspname in ('public', 'private')
union all select 'auth.users', count(*) from auth.users
union all select 'auth.identities', count(*) from auth.identities
union all select 'storage:' || bucket_id, count(*) from storage.objects group by bucket_id
order by 1;
EOF

cat > objects.sql <<'EOF'
-- Every uploaded file, as "bucket path".
select bucket_id, name from storage.objects order by bucket_id collate "C", name collate "C";
EOF

cat > wipe-new.sql <<'EOF'
-- Empties NEW before a copy. Refuses to run on a live project (one with the email worker set up).
do $$
declare
  r record;
begin
  if exists (select 1 from vault.secrets where name in ('email_worker_url', 'email_worker_secret')) then
    raise exception 'STOP: this project is live (it has the email worker secrets). Nothing was deleted.';
  end if;
  for r in
    select n.nspname, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and n.nspname in ('public', 'private')
  loop
    execute format('truncate table %I.%I restart identity cascade', r.nspname, r.relname);
  end loop;
  delete from auth.users;
end
$$;
EOF

cat > cron-off.sql <<'EOF'
select jobname, cron.alter_job(jobid, active := false) from cron.job;
EOF

cat > cron-on.sql <<'EOF'
select jobname, cron.alter_job(jobid, active := true) from cron.job;
EOF

cat > vault.sql <<'EOF'
select vault.create_secret(:'worker_url', 'email_worker_url');
select vault.create_secret(:'worker_secret', 'email_worker_secret');
select name from vault.secrets order by 1;
EOF

ls
```
**You should see:** `counts.sql  cron-off.sql  cron-on.sql  objects.sql  vault.sql  wipe-new.sql`

### Step 1.11: Test the connection to OLD
1. In Terminal:
   ```bash
   source ~/plotline-region-move/env.sh
   psql "$OLD_DB_URL" -At -c "select 'connected'"
   ```
   **You should see:** `connected`. If you see a password error, re-check `OLD_DB_URL` in `env.sh`.
2. Two quick facts for later:
   ```bash
   psql "$OLD_DB_URL" -At -c "select count(*) from auth.mfa_factors"
   psql "$OLD_DB_URL" -At -c "select count(*) from public.venue_settings where online_payments_enabled"
   ```
   - The first should be `0`. If it isn't, tell me before going on.
   - The second is how many venues take PayMongo payments. Write it down (it matters in Step 6.4).

### Step 1.12: Make a clean copy of the released code
**Why:** we set up NEW from `master` as it is **on GitHub** (what production runs), in a separate folder, so your normal work folder isn't touched. Your Mac's own `master` is often behind GitHub's (`git fetch` doesn't update it), so the last two commands bring it up to date first.
```bash
cd ~/Documents/Projects/court-booking-system
git fetch origin
git worktree add ~/Documents/Projects/cbs-region-move master
cd ~/Documents/Projects/cbs-region-move
git merge --ff-only origin/master
npm ci
```
**You should see:** npm finishes without errors. Then check the copy matches GitHub and has every function:
```bash
git rev-parse --short HEAD origin/master
ls supabase/functions
```
**You should see:** the same short id on both lines, and 10 function folders plus `_shared`, including `invoice-pdf`.

If you made this folder earlier, run `cd ~/Documents/Projects/cbs-region-move && git fetch origin && git merge --ff-only origin/master && npm ci` before Part 3, and again before moving day if anything was released in between.

### Step 1.13: Choose moving day and tell people
1. **Pick a 90-minute window** on a quiet evening, **not on the 1st of the month**. Good choice: **22:00–23:30 Manila time**. This avoids every scheduled job (the demo reset runs at 08:30, invoices at 09:00, the cleanup at 11:17 and the nightly backup at 02:00, all Manila time).
2. **Send venue owners and staff** a message at least a day ahead, for example:
   > Plotline will be down for maintenance on **<date>, 22:00–23:30**. Afterwards, please sign in again. If you were invited but haven't accepted yet, we'll send you a new invitation.

---

## Part 2. Create the new project

### Step 2.1: Open the new-project form
1. Go to https://supabase.com/dashboard.
2. Click **New project**.

### Step 2.2: Fill in the form
Enter exactly these values:

| Field | What to enter |
| --- | --- |
| **Organization** | Your Plotline organization (the one staging and production are in) |
| **Project name** | `plotline-production-sg` |
| **Database password** | Click **Generate a password**. It must be **letters and numbers only**, with no symbols; if the generated one has symbols, type your own of 32 letters and numbers. **Copy it into your note now**: you can't see it again. |
| **Region** | **Southeast Asia (Singapore)**. Sometimes shown as `ap-southeast-1`. **Double-check this one.** |
| **Compute size** (Pro only) | The same as OLD. To see OLD's: OLD → **Project Settings** → **Compute and Disk**. If OLD is on the free plan, choose the smallest (Micro). |
| **Security options / "What connections do you plan to use?"** (if shown) | **Data API and Connection string** |
| **Data API configuration** (if shown) | **Use public schema for Data API** |
| **Enable automatic RLS** or similar extra switches (if shown) | Leave the default |

Click **Create new project**. It takes 1–3 minutes.

### Step 2.3: Write down NEW's details
1. When the project is ready, look at the browser address: `supabase.com/dashboard/project/<ref>`. That 20-letter `<ref>` is **NEW's ref**. Save it in your note.
2. Click **Connect** → **Connection String** → **Method: Session pooler** → copy the URI. Replace `[YOUR-PASSWORD]` with the password from Step 2.2. Check the address contains **`ap-southeast-1`**.
3. Get the keys: **Project Settings** → **API Keys**.
   - Copy the **Publishable key** (`sb_publishable_…`) into your note.
   - Under **Secret keys**, copy (or create) a secret key (`sb_secret_…`) into your note. You need it in Step 8.2.
4. Open `env.sh` and fill in the `NEW_REF` and `NEW_DB_URL` lines:
   ```bash
   open -e ~/plotline-region-move/env.sh
   ```
5. Check:
   ```bash
   source ~/plotline-region-move/env.sh && guard
   npx supabase projects list
   ```
   **You should see:** `OK: OLD=sfssolhsthteonzgzfos NEW=<your new ref>`, and in the list the new project shows `"region":"ap-southeast-1"`.

> From now on, **start every Terminal session with** `source ~/plotline-region-move/env.sh && guard`.

---

## Part 3. Set up the new project

### Step 3.1: Build the database structure
**Why:** this creates all the tables, rules, storage buckets and scheduled jobs from the repo's migrations. It doesn't add any data.

1. Preview what will run:
   ```bash
   cd "$WT"
   npx supabase db push --db-url "$NEW_DB_URL" --dry-run
   ```
   **You should see:** a long list of migration files (about 97).
2. Run it:
   ```bash
   npx supabase db push --db-url "$NEW_DB_URL"
   ```
   Type `Y` if it asks to confirm.
3. Check:
   ```bash
   npx supabase migration list --db-url "$NEW_DB_URL"
   ```
   **You should see:** every row has the same value in the **Local** and **Remote** columns.

Don't run `seed.sql`: the real data comes from OLD.

### Step 3.2: Pause NEW's scheduled jobs
**Why:** until moving day, NEW shouldn't expire bookings, make invoices or reset the demo venue.
```bash
psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 -f "$MOVE/sql/cron-off.sql"
```
**You should see:** five lines: `expire-holds`, `send-emails`, `purge-email-outbox`, `monthly-invoices`, `demo-reset`.

### Step 3.3: Deploy the Edge Functions
1. Deploy all of them:
   ```bash
   cd "$WT"
   npx supabase functions deploy --project-ref "$NEW_REF" --use-api
   ```
2. Check:
   ```bash
   npx supabase functions list --project-ref "$NEW_REF"
   ```
   **You should see:** 10 functions, all **ACTIVE**: `create-paymongo-checkout`, `delete-unused-venue`, `email-guest-link`, `invite-venue-owner`, `invoice-pdf`, `paymongo-webhook`, `send-emails`, `site-contact`, `site-review`, `submit-payment-proof`.

### Step 3.4: Set the secrets
1. Create the secrets file and open it:
   ```bash
   touch "$MOVE/new-secrets.env" && chmod 600 "$MOVE/new-secrets.env"
   open -e "$MOVE/new-secrets.env"
   ```
2. Type one line per secret from your note, like `NAME=value`. Use **`EMAIL_TRANSPORT=disabled`** for now and leave out `PAYMONGO_WEBHOOK_SECRET`. For example:
   ```
   EMAIL_TRANSPORT=disabled
   EMAIL_FROM=bookings@mail.plotline.fit
   RESEND_API_KEY=re_...
   EMAIL_WORKER_SECRET=...
   LEAD_ALERT_TO=...
   PAYMONGO_SECRET_KEY=sk_test_...
   PUBLIC_ROOT_DOMAIN=plotline.fit
   PUBLIC_SITE_URL=...
   SITE_ORIGINS=https://plotline.fit,https://www.plotline.fit
   TURNSTILE_SECRET_KEY=...
   SENTRY_DSN=...
   ```
3. Save, close, then upload them:
   ```bash
   npx supabase secrets set --env-file "$MOVE/new-secrets.env" --project-ref "$NEW_REF"
   ```
4. Compare the names with OLD:
   ```bash
   npx supabase secrets list --project-ref "$OLD_REF"
   npx supabase secrets list --project-ref "$NEW_REF"
   ```
   **You should see:** the same names on both, except `PAYMONGO_WEBHOOK_SECRET`, which you add in Step 3.6.

### Step 3.5: Copy the sign-in and other settings
**Why:** these settings live only in the dashboard. Open **OLD in one browser tab and NEW in another** and copy each page across.

**a. Website addresses**
1. Both projects: **Authentication** → **URL Configuration**.
2. Copy OLD's **Site URL** into NEW and click **Save**.
3. Under **Redirect URLs**, add each of OLD's addresses to NEW (it includes `https://*.plotline.fit/**`).

**b. Email sign-in**
1. Both projects: **Authentication** → **Sign In / Providers** → **Email**.
2. Make NEW match OLD: enabled, **Confirm email** on, and the same password rules. Save.

**c. Google sign-in**
1. NEW: **Authentication** → **Sign In / Providers** → **Google** → enable it.
2. Paste the **Client ID** and **Client secret** from Step 1.6. Save.
3. On that same page, copy the **Callback URL** (it looks like `https://<NEW ref>.supabase.co/auth/v1/callback`).
4. In the Google Cloud tab from Step 1.6: under **Authorized redirect URIs**, click **Add URI**, paste the callback URL, then **Save**. Keep OLD's callback there too, for now.

**d. Sending emails through Resend**
1. NEW: **Authentication** → **Emails** → **SMTP Settings** → turn on **Enable custom SMTP**.
2. Enter: Sender email `no-reply@mail.plotline.fit`, Sender name (same as OLD), Host `smtp.resend.com`, Port `465`, Username `resend`, Password = your new Resend key (Step 1.4). Save.

**e. Email templates**
1. Both projects: **Authentication** → **Emails** → **Templates**.
2. For each template (Confirm signup, Invite user, Magic link, Change email address, Reset password, Reauthentication), copy OLD's **Subject** and **Body** into NEW exactly. Save each one.

**f. The remaining pages.** Make NEW match OLD on each:
- **Authentication** → **Rate Limits**
- **Authentication** → **Sessions** (if shown)
- **Authentication** → **Attack Protection**
- **Project Settings** → **Data API** (Exposed schemas, Extra search path, Max rows)
- **Project Settings** → **Database** (SSL enforcement, Network restrictions)
- **Storage** → **Settings** (Global file size limit)

**g. Let the computer check your work**
```bash
for r in "$OLD_REF" "$NEW_REF"; do
  curl -s -H "Authorization: Bearer $REGION_MOVE_TOKEN" "https://api.supabase.com/v1/projects/$r/config/auth" \
    | jq -S 'del(.. | .smtp_pass?, .external_google_secret?)' > "$MOVE/check/auth-$r.json"
  curl -s -H "Authorization: Bearer $REGION_MOVE_TOKEN" "https://api.supabase.com/v1/projects/$r/postgrest" \
    | jq -S . > "$MOVE/check/api-$r.json"
done
diff "$MOVE/check/auth-$OLD_REF.json" "$MOVE/check/auth-$NEW_REF.json"
diff "$MOVE/check/api-$OLD_REF.json" "$MOVE/check/api-$NEW_REF.json"
```
**You should see:** few or no lines. Each line starting with `<` is OLD's value and `>` is NEW's. Fix any real difference in the dashboard and run it again. Differences you can ignore: hashed values, and lines that contain the project's own address or ref. If you're not sure about a line, send it to me.

### Step 3.6: Add the PayMongo webhook for NEW
**Why:** PayMongo tells the app when an online payment succeeds. NEW needs its own address registered.

1. PayMongo dashboard → make sure **Test mode** is on → **Developers** → **Webhooks**.
2. Click the existing endpoint (its address contains `sfssolhsthteonzgzfos`) and **write down which events it listens to**.
3. Go back and click **Add endpoint** (or **Create webhook**):
   - URL: `https://<NEW ref>.supabase.co/functions/v1/paymongo-webhook`
   - Events: the same ones as the old endpoint.
4. Save, then copy its **signing secret** (starts with `whsk_`).
5. Set it on NEW:
   ```bash
   npx supabase secrets set PAYMONGO_WEBHOOK_SECRET='whsk_...' --project-ref "$NEW_REF"
   ```
   Also add that line to `$MOVE/new-secrets.env`.

Leave the old endpoint switched on until after moving day.

---

## Part 4. Rehearsal (practise the copy)

**Why:** this runs the whole copy once while OLD keeps working normally. It proves every command works and shows how long they take. Anything it puts into NEW gets erased on moving day.

Start with:
```bash
source ~/plotline-region-move/env.sh && guard
```

### Step 4.1: Copy OLD's data to your Mac
Time how long Steps 4.1–4.3 take: `date`.
```bash
pg_dump "$OLD_DB_URL" --data-only --no-owner --no-privileges --schema=public --schema=private -f "$MOVE/dump/app.sql"
pg_dump "$OLD_DB_URL" --data-only --no-owner --no-privileges --table=auth.users --table=auth.identities -f "$MOVE/dump/auth.sql"
ls -lh "$MOVE/dump"
```
**You should see:** two files, `app.sql` and `auth.sql`, neither of them 0 bytes.

### Step 4.2: Count what's in OLD
```bash
psql "$OLD_DB_URL" -At -F ' ' -f "$MOVE/sql/counts.sql"  > "$MOVE/check/counts-old.txt"
psql "$OLD_DB_URL" -At -F ' ' -f "$MOVE/sql/objects.sql" > "$MOVE/check/objects-old.txt"
wc -l "$MOVE/check/objects-old.txt"
grep -c "$OLD_REF" "$MOVE/dump/app.sql"
```
**You should see:** the number of files in OLD's storage, then **`0`** on the last line. If the last number isn't 0, some data contains the old project's address: stop and tell me.

### Step 4.3: Load the data into NEW
```bash
psql "$NEW_DB_URL" --single-transaction -v ON_ERROR_STOP=1 \
  -f "$MOVE/sql/wipe-new.sql" \
  -c 'set session_replication_role = replica' \
  -f "$MOVE/dump/auth.sql" \
  -f "$MOVE/dump/app.sql"
```
What this does, in order: empty NEW, switch off automatic actions (so nothing runs twice, like sending emails), load the users, then load everything else. It's all-or-nothing: if any part fails, NEW is left exactly as it was.

**You should see:** many lines like `COPY 12` and no `ERROR`. If you see an error, stop and send me the **first** error line. The common ones:
- `permission denied to set parameter "session_replication_role"`
- `column "…" of relation "users" does not exist`
- `duplicate key value violates unique constraint`

### Step 4.4: Compare the counts
```bash
psql "$NEW_DB_URL" -At -F ' ' -f "$MOVE/sql/counts.sql" > "$MOVE/check/counts-new.txt"
diff "$MOVE/check/counts-old.txt" "$MOVE/check/counts-new.txt"
```
**You should see:** only lines that start with `storage:`. The files aren't copied yet (that's the next step). Any other line means a table doesn't match: stop and tell me.

### Step 4.5: Copy the uploaded files
1. Download OLD's files to your Mac:
   ```bash
   for b in venue-media payment-qr payment-proofs platform-billing; do
     rm -rf "$MOVE/storage/$b"
     npx supabase --experimental storage cp -r "ss:///$b" "$MOVE/storage/$b" --project-ref "$OLD_REF"
   done
   find "$MOVE/storage" -type f | wc -l
   ```
   **You should see:** the same number as `wc -l` printed in Step 4.2.
2. Upload them to NEW, one file at a time to its exact path (the list comes from Step 4.2):
   ```bash
   while read -r bucket key; do
     npx supabase --experimental storage cp "$MOVE/storage/$bucket/$key" "ss:///$bucket/$key" --project-ref "$NEW_REF" --yes < /dev/null
   done < "$MOVE/check/objects-old.txt"
   ```
   Don't use `storage cp -r <folder> ss:///<bucket>` for this. Like the Unix `cp -r`, it puts the folder itself inside the bucket, so `payment-proofs/abc.jpg` ends up as `payment-proofs/payment-proofs/abc.jpg`.
3. Check that nothing is missing:
   ```bash
   psql "$NEW_DB_URL" -At -F ' ' -f "$MOVE/sql/objects.sql" > "$MOVE/check/objects-new.txt"
   comm -23 "$MOVE/check/objects-old.txt" "$MOVE/check/objects-new.txt"
   ```
   **You should see:** nothing at all. Every line printed is a file that didn't make it.
4. Check all counts again:
   ```bash
   psql "$NEW_DB_URL" -At -F ' ' -f "$MOVE/sql/counts.sql" > "$MOVE/check/counts-new.txt"
   diff "$MOVE/check/counts-old.txt" "$MOVE/check/counts-new.txt" && echo "EVERYTHING MATCHES"
   ```
   **You should see:** `EVERYTHING MATCHES`.

Note down how long Steps 4.1–4.5 took. That's roughly how long moving day's copy takes.

### Step 4.6: Try the app against NEW on your Mac
1. NEW → **Authentication** → **URL Configuration** → **Redirect URLs** → add `http://localhost:5173/**` (temporary).
2. Start the app pointed at NEW (put NEW's publishable key in the second line):
   ```bash
   cd "$WT"
   VITE_SUPABASE_URL="https://$NEW_REF.supabase.co" \
   VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_..." \
   npm run dev
   ```
3. Open http://localhost:5173/?venue=claudex-courts and tick each one:
   - [ ] The home page and **Book** page load, with court photos and the banner.
   - [ ] **Sign in with Google** (your platform-admin account) works, and the console lists every venue.
   - [ ] In a venue's admin area, a booking with a payment proof opens its proof image.
   - [ ] A booking page shows the payment QR codes.
   - [ ] The console's **Billing** page shows Plotline's payment details and QR.
4. Don't book with real people's email addresses. No emails go out during the rehearsal anyway.
5. Stop the app (**Ctrl+C**) and remove `http://localhost:5173/**` from NEW's redirect URLs, unless OLD has it too.

If anything failed, fix it and repeat Part 4. **Don't do Part 5 until a rehearsal passes completely.**

---

## Part 5. Moving day (about 45 minutes)

Before you start, open: this guide, OLD's dashboard, NEW's dashboard, Cloudflare, PayMongo and Terminal. Keep a note of the time of each step.

### Step 5.1: Get ready (minute 0)
```bash
source ~/plotline-region-move/env.sh && guard
date -u
```

### Step 5.2: Stop OLD's scheduled jobs (minute 1)
```bash
psql "$OLD_DB_URL" -v ON_ERROR_STOP=1 -f "$MOVE/sql/cron-off.sql"
psql "$OLD_DB_URL" -At -c "select jobname, active from cron.job order by 1"
```
**You should see:** every job ends in `|f` (off).

**Wait 2 full minutes.** This lets any email that's being sent right now finish, so it isn't sent twice.

### Step 5.3: Freeze OLD (minute 3)
**Why:** from here until the end, nobody can change anything in OLD, so the copy is complete.

1. OLD → **Project Settings** → **Data API**. **Take a screenshot** of the page (you need it if you roll back). Then turn **Enable Data API** off and confirm. The websites now show errors: that's expected.
2. OLD → **Authentication** → **Sign In / Providers** → turn **Allow new users to sign up** off. Save.
3. Write down the time:
   ```bash
   date -u
   ```
   This is your **freeze time**.

### Step 5.4: Copy the data for real (minute 5)
1. Make sure NEW's jobs are off:
   ```bash
   psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 -f "$MOVE/sql/cron-off.sql"
   ```
2. Run **Steps 4.1, 4.2 and 4.3** again, exactly as in the rehearsal.
3. Compare (**Step 4.4**).
   **You should see:** only `storage:` lines.

**Checkpoint:** if the counts don't match, go to **Part 7, case A**. Nothing is lost.

### Step 5.5: Copy the files for real (minute 15)
1. Download OLD's files again (**Step 4.5, part 1**).
2. Upload only the files NEW doesn't have yet:
   ```bash
   psql "$NEW_DB_URL" -At -F ' ' -f "$MOVE/sql/objects.sql" > "$MOVE/check/objects-new.txt"
   comm -23 "$MOVE/check/objects-old.txt" "$MOVE/check/objects-new.txt" | while read -r bucket key; do
     npx supabase --experimental storage cp "$MOVE/storage/$bucket/$key" "ss:///$bucket/$key" --project-ref "$NEW_REF" --yes < /dev/null
   done
   ```
3. Check (**Step 4.5, parts 3 and 4**).
   **You should see:** `comm` prints nothing, and then `EVERYTHING MATCHES`.

   NEW may have a few *extra* files left from the rehearsal (files deleted on OLD since then). That's harmless; only missing files matter. Extra files do make the `storage:` counts differ, so if the only difference is a `storage:` line where NEW's count is higher **and** `comm` printed nothing, you can continue.

### Step 5.6: Switch NEW on (minute 20)
1. Give the email job its address and password:
   ```bash
   psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 \
     -v worker_url="https://$NEW_REF.supabase.co/functions/v1/send-emails" \
     -v worker_secret="$EMAIL_WORKER_SECRET" \
     -f "$MOVE/sql/vault.sql"
   ```
   **You should see:** `email_worker_secret` and `email_worker_url`.
2. Turn on real email sending:
   ```bash
   npx supabase secrets set EMAIL_TRANSPORT=resend --project-ref "$NEW_REF"
   ```
3. Turn NEW's scheduled jobs on:
   ```bash
   psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 -f "$MOVE/sql/cron-on.sql"
   psql "$NEW_DB_URL" -At -c "select jobname, active from cron.job order by 1"
   ```
   **You should see:** every job ends in `|t` (on).

Emails that were waiting to go out on OLD were copied over and are now sent once from NEW.

### Step 5.7: Point the booking app at NEW (minute 22)
1. Cloudflare dashboard → **Workers & Pages** → the **court-booking-system** Worker → **Settings** → **Build** → **Variables and secrets**.
2. Edit these two (leave the others alone):
   - `VITE_SUPABASE_URL` = `https://<NEW ref>.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = NEW's publishable key
3. Save.
4. Go to **Deployments**, click the latest production build → **Retry build**. Wait until it shows success (a few minutes).
5. On your Mac, put the same two values in `~/Documents/Projects/court-booking-system/.env.production.local`.

### Step 5.8: Point the marketing site at NEW (minute 25)
**Why:** plotline-site keeps its production Supabase address in a file that's committed to the repo (`.env.production`).

1. In Terminal:
   ```bash
   cd ~/Documents/Projects/plotline-site
   git switch master && git pull
   open -e .env.production
   ```
2. Change `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to NEW's values. Leave `VITE_TURNSTILE_SITE_KEY` as it is. Save.
3. Commit and push (Cloudflare deploys `master` automatically):
   ```bash
   git commit -am "chore(env): production Supabase moved to ap-southeast-1"
   git push
   ```
4. Cloudflare → the **plotline-site** Worker → **Settings** → **Build** → **Variables and secrets**. If `VITE_SUPABASE_URL` or `VITE_SUPABASE_PUBLISHABLE_KEY` are listed there, they override the file: change them to NEW's values too.
5. Wait for its deployment to finish.
6. Later (not tonight), bring the same change into plotline-site's `develop` branch.

### Step 5.9: Check both sites really use NEW (minute 30)
```bash
for site in https://claudex-courts.plotline.fit https://plotline.fit; do
  echo "== $site"
  for js in $(curl -s "$site/" | grep -oE '/assets/[^"]+\.js'); do
    curl -s "$site$js" | grep -oE '[a-z0-9]{20}\.supabase\.co'
  done | sort -u
done
```
**You should see:** under each site, only `<NEW ref>.supabase.co`. If you still see `sfssolhsthteonzgzfos`, the deploy hasn't finished: wait and run it again.

**Checkpoint:** from now on, real people use NEW. Going back now means losing what they do (Part 7, case B).

### Step 5.10: Switch off OLD's PayMongo webhook (minute 32)
PayMongo → **Developers** → **Webhooks** → the old endpoint (`…sfssolhsthteonzgzfos…`) → **Disable**. Don't delete it yet.

---

## Part 6. Check everything works (about 30 minutes)

### Step 6.1: Release check
```bash
cd "$WT"
npm run preflight:release -- --project-ref "$NEW_REF" --commit master
```
**You should see:** it names NEW's ref and passes.

### Step 6.2: Jobs and emails
```bash
psql "$NEW_DB_URL" -c "select j.jobname, d.status, d.start_time from cron.job_run_details d join cron.job j using (jobid) order by d.start_time desc limit 10"
psql "$NEW_DB_URL" -c "select status, count(*) from public.email_outbox group by 1"
```
**You should see:** recent runs with status `succeeded`, and no growing pile of `pending` emails.

### Step 6.3: Test booking
1. Run the production smoke test. It makes one booking called **E2E Smoke** and uploads a payment proof:
   ```bash
   cd ~/Documents/Projects/court-booking-system
   npm run smoke:prod -- https://claudex-courts.plotline.fit
   ```
   **You should see:** it passes and prints a booking reference.
2. Sign in to the venue admin and **cancel that E2E Smoke booking**.
3. Resend → **Logs**: emails to `delivered+smoke-…@resend.dev` show as delivered.

### Step 6.4: Click through by hand
- [ ] https://claudex-courts.plotline.fit: the home and Book pages load, with photos.
- [ ] **Sign in with Google** as platform admin. Open the console, a venue, a booking with a proof, **Reports**, **Billing**, and an invoice PDF preview.
- [ ] Sign in with **email and password** on an owner account (yours or a test one). This proves passwords came across.
- [ ] https://plotline.fit: the venue showcase and reviews load.
- [ ] Send the plotline.fit **contact form** with a test message. The lead shows in the console, and the alert email arrives.
- [ ] If Step 1.11's second number was more than 0: make one PayMongo **test** payment and check the booking becomes paid.
- [ ] Sentry shows no new burst of errors.

### Step 6.5: Make sure nothing happened on OLD after the freeze
Put your freeze time (Step 5.3) in both places:
```bash
psql "$OLD_DB_URL" -At -c "select count(*) from auth.users where created_at > '2026-11-XX 14:03:00+00' or last_sign_in_at > '2026-11-XX 14:03:00+00'"
```
**You should see:** `0`. If it's more, someone signed in to OLD during the window. A sign-in needs nothing; a new sign-up means that person must sign up again.

### Step 6.6: Re-send pending invitations
1. List the people invited who never signed in:
   ```bash
   psql "$NEW_DB_URL" -c "select email, invited_at from auth.users where invited_at is not null and last_sign_in_at is null order by invited_at desc"
   ```
2. For each one, send a new invitation from the console (**Invite owner** or **Invite staff** on their venue).

### Step 6.7: Tell everyone it's done
Message the venue owners: maintenance is over, please sign in again.

**The move is done when everything in Part 6 passes.** Tell me, and I'll record it in the TASKS Handoff and do the repo changes (Step 8.1).

---

## Part 7. If something goes wrong

### Case A: before Step 5.9 (nobody has used NEW yet). Nothing is lost.
Undo in this order:
1. OLD → **Project Settings** → **Data API** → turn **Enable Data API** back on. Check the exposed schemas match your screenshot from Step 5.3.
2. OLD → **Authentication** → **Sign In / Providers** → turn **Allow new users to sign up** back on.
3. Turn OLD's jobs back on:
   ```bash
   psql "$OLD_DB_URL" -v ON_ERROR_STOP=1 -f "$MOVE/sql/cron-on.sql"
   ```
4. If you already did Step 5.7 or 5.8: put the old values back (Cloudflare variables, plotline-site's `.env.production`) and redeploy both.
5. If you did Step 5.10: re-enable OLD's PayMongo webhook.
6. Quiet NEW down:
   ```bash
   psql "$NEW_DB_URL" -f "$MOVE/sql/cron-off.sql"
   npx supabase secrets set EMAIL_TRANSPORT=disabled --project-ref "$NEW_REF"
   ```
7. Send me what went wrong. We fix it and pick a new date.

### Case B: after Step 5.9 (people have used NEW)
Fixing NEW is almost always better. Only go back within the **first hour**, and only for a problem that can't be fixed quickly:
1. List what was created on NEW since the switch (bookings, payments, leads, reviews, new users). Ask me for the queries.
2. Do Case A, steps 1–6.
3. Re-enter those records on OLD by hand, or contact those people.

---

## Part 8. Afterwards

### Step 8.1: Repo changes (I do these as one `/implement` task)
- `supabase/functions/_shared/backup.ts`: change `PRODUCTION_REF` to NEW's ref, and update its test and `scripts/lib/release-preflight.test.ts`. **Important:** the restore script uses it to refuse to overwrite production.
- `scripts/backup-production.mjs`: add the `payment-proofs` bucket. Today's nightly backup skips it.
- `CLAUDE.md` rule L6, `docs/PLATFORM.md` §3 (new ref, Singapore, date of the move), `docs/ops/UPTIME.md`, TASKS Handoff, and a SPEC §10 line.

### Step 8.2: Backup and monitoring (the same day)
1. GitHub → court-booking-system → **Settings** → **Secrets and variables** → **Actions**. Update:
   - `BACKUP_DB_URL` = NEW's session pooler URL (Step 2.3)
   - `BACKUP_SUPABASE_URL` = `https://<NEW ref>.supabase.co`
   - `BACKUP_SERVICE_KEY` = NEW's secret key (Step 2.3)
2. GitHub → **Actions** → **Nightly production backup** → **Run workflow**. Wait for the green tick.
3. StatusCake: change the Supabase monitor's URL to `https://<NEW ref>.supabase.co/auth/v1/health`.

### Step 8.3: Retire OLD
| When | What to do |
| --- | --- |
| **Moving day** | Leave OLD frozen and running. Don't delete anything. |
| **After 14 calm days** | 1. Ask me to make a final encrypted backup of OLD. 2. OLD → **Project Settings** → **General** → **Pause project**. 3. Google Cloud: remove OLD's callback URL. 4. PayMongo: delete OLD's webhook endpoint. 5. Resend: revoke the old API key. 6. Supabase: delete the `region-move` access token. |
| **After 30 days** | Once the final backup is proven to restore, delete OLD (**Project Settings** → **General** → **Delete project**). This can't be undone. |

### Step 8.4: Delete the working files
They contain customer data and secrets:
```bash
rm -rf ~/plotline-region-move
cd ~/Documents/Projects/court-booking-system
git worktree remove ~/Documents/Projects/cbs-region-move
```

### Step 8.5: Restore staging
Only if you paused it in Step 1.2: staging project → **Restore project**.

---

## One-page checklist

**Part 1: Get ready**
- [ ] 1.1 Tools installed (pg_dump 17, psql 17, jq)
- [ ] 1.2 Pro plan, or staging paused
- [ ] 1.3–1.6 Every secret value in your note (new Resend key, worker secret, Google ID and secret)
- [ ] 1.7 OLD's database address
- [ ] 1.8 Access token
- [ ] 1.9–1.10 Working folder, `env.sh`, helper scripts
- [ ] 1.11 Connected to OLD
- [ ] 1.12 Clean code copy from `master`
- [ ] 1.13 Window chosen, owners told

**Parts 2–3: New project**
- [ ] 2.2 Created in **Southeast Asia (Singapore)**
- [ ] 2.3 Ref, address and keys saved; `guard` says OK
- [ ] 3.1 Structure built
- [ ] 3.2 Jobs paused
- [ ] 3.3 10 functions
- [ ] 3.4 Secrets set (`EMAIL_TRANSPORT=disabled`)
- [ ] 3.5 Settings copied, and the diff checked
- [ ] 3.6 PayMongo webhook and its secret

**Part 4: Rehearsal**
- [ ] `EVERYTHING MATCHES`
- [ ] App checks pass on localhost
- [ ] Timing noted

**Part 5: Moving day**
- [ ] 5.2 OLD jobs off, waited 2 minutes
- [ ] 5.3 OLD frozen, freeze time noted
- [ ] 5.4 Data copied, counts match
- [ ] 5.5 Files copied
- [ ] 5.6 NEW switched on
- [ ] 5.7 Booking app on NEW
- [ ] 5.8 Marketing site on NEW
- [ ] 5.9 Both sites show NEW's ref
- [ ] 5.10 Old webhook disabled

**Part 6: Checks**
- [ ] Preflight
- [ ] Jobs and emails
- [ ] Smoke booking (then cancelled)
- [ ] Hand checks
- [ ] Nothing on OLD after the freeze
- [ ] Invitations re-sent
- [ ] Owners told

**Part 8: Afterwards**
- [ ] Repo task
- [ ] GitHub backup secrets and a manual run
- [ ] StatusCake
- [ ] OLD paused at day 14, deleted at day 30
- [ ] Working files deleted
- [ ] Staging restored (if it was paused)

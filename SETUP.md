# Setup

Four jobs, in this order. Total time about fifteen minutes, and you only
do it once.

1. [Put the files on GitHub and turn on Pages](#1-put-the-files-on-github)
2. [Create the token so the site can save your edits](#2-create-the-github-token)
3. [Set your passcode and your leagues](#3-first-run-in-the-browser)
4. [Switch on the emails](#4-switch-on-the-emails)

---

## 1. Put the files on GitHub

1. Go to <https://github.com/new>.
2. Repository name: `iracing-schedule`. Leave it **Public**.
   (Private repos need a paid plan to serve GitHub Pages.)
3. Do **not** tick "Add a README file". You want it empty.
4. Click **Create repository**.
5. On the empty repo page click **uploading an existing file**.
6. Unzip the download, then drag **the contents** of the folder into the
   browser, not the folder itself. You should see `index.html` at the top
   level of the upload list, not `iracing-schedule/index.html`.
7. Scroll down, click **Commit changes**.

GitHub's web uploader silently drops folders whose names begin with a dot,
so check afterwards that `.github/workflows/notify.yml` actually arrived.
If it did not, create it by hand:

- On the repo page: **Add file → Create new file**
- Type `.github/workflows/notify.yml` as the filename (typing the slashes
  creates the folders)
- Paste the contents of that file from the download, then commit.

Now turn Pages on:

1. **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: **main**, folder: **/ (root)**. Click **Save**.
4. Wait a minute, then reload. GitHub shows the address, which will be
   `https://<your-username>.github.io/iracing-schedule/`

Open it. You should see a dark calendar with three placeholder leagues.

---

## 2. Create the GitHub token

This is what lets the page write your edits back to the repo.

1. Go to <https://github.com/settings/personal-access-tokens/new>
   (**Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**)
2. **Token name:** `race-schedule`
3. **Expiration:** your call. A year is convenient; 90 days is safer. Put
   a reminder in the calendar either way, because when it expires the
   site will simply stop saving and tell you the token is bad.
4. **Repository access:** *Only select repositories* → pick
   `iracing-schedule`.
5. **Permissions → Repository permissions → Contents:** change to
   **Read and write**. Leave every other permission alone.
6. **Generate token**, then copy it. GitHub shows it exactly once.

The token lives in your browser's local storage on whichever device you
paste it into. It is never written into `schedule.json`, so it never
becomes public, and it is never sent anywhere except `api.github.com`.
If you want to edit from your phone as well, paste it there too.

---

## 3. First run in the browser

Open your Pages URL and press **E** (or Settings, then *Unlock editing*).
No passcode is set yet, so anything gets you in.

Then, in order:

**Settings → GitHub**
- GitHub username, repository `iracing-schedule`, branch `main`
- Paste the token
- **Save connection**, then **Test connection**. You want
  "Connected... Write access confirmed."

**Settings → Site**
- Site title and subtitle
- Set an **admin passcode**. Worth being clear about what this is: the
  page is public, so the passcode's hash is public too, and a determined
  person could get past it. It stops a casual visitor poking the editor.
  The thing that actually protects your data is the token, which only you
  have.

**Settings → Leagues**
- Edit the three placeholders into your real leagues, or delete them and
  add your own. For each one set the name, short code, colour, race day,
  start time, number of rounds and the practice/qualifying offsets.
  Those defaults are what the add-race form pre-fills from, so getting
  them right makes entering a season fast.

**Add your races**, whichever way suits:
- **+ Race** button, fill in one round, tick **Repeat weekly** and give it
  the round count. That creates the whole season in one go with blank
  tracks, which you then fill in from the **Seasons** view.
- Or **Settings → Import / export**, paste a block of
  `round, date, time, track, config, car` lines.
- Or send me a screenshot of a league's schedule post and I will produce
  the paste-ready block for you.

Click **Publish to GitHub**. Give it a minute, reload, and the change is
live everywhere.

---

## 4. Switch on the emails

**Get a Resend key**

1. Sign up at <https://resend.com> (free tier is 3,000 emails a month,
   far more than this needs).
2. **API Keys → Create API Key**. Permission: *Sending access*. Copy it.

**Store it in the repo**

1. Your repo → **Settings → Secrets and variables → Actions**
2. **New repository secret**
3. Name: `RESEND_API_KEY` (exactly). Value: the key. **Add secret**.

Never put this key in `schedule.json`. That file is public.

**Point the emails at yourself**

In the site: **Settings → Email**
- **Send to:** your address, comma separated if there is more than one
- **From address:** leave as `onboarding@resend.dev` to begin with
- **Site URL:** paste your Pages address so the button in the email works
- Check the two send times: 10:00 and 19:00 Eastern
- **Save email settings**, then **Publish to GitHub**

**Test it**

Repo → **Actions** → *Race notifications* → **Run workflow**. Set
**slot** to `morning` and run it. Two minutes later you either have an
email or a red run whose log says exactly what went wrong. Set
**dry_run** to true if you want to see the email text in the log without
actually sending.

If the Actions tab shows a banner about workflows being disabled, click
the button to enable them. GitHub does that on some newly uploaded repos.

---

### Later: sending from your own domain

`onboarding@resend.dev` works but looks like what it is. When you want
`schedule@coxgp.com`:

1. Resend → **Domains → Add Domain** → `coxgp.com`
2. Resend gives you three DNS records to add at whoever hosts your DNS:
   a **DKIM** `TXT` record, an **SPF** `TXT` record on the sending
   subdomain, and a **CNAME** for the return path. Add them exactly as
   shown, values included.
3. Wait for Resend to show the domain as *Verified*. Usually minutes,
   occasionally a few hours.
4. In the site: **Settings → Email → From address** → `schedule@coxgp.com`,
   save, publish.

Nothing else changes.

---

## Things that will eventually go wrong, and what they mean

**"Bad credentials" when publishing.** The token expired or was revoked.
Make a new one and paste it into Settings → GitHub.

**Publishing says the file changed since the page loaded.** You edited on
another device, or on github.com, and this tab is stale. Cancel, reload,
redo the edit. Overwriting is offered but it discards the other change.

**The calendar looks out of date after publishing.** GitHub Pages caches
for a short while, and the page itself caches for offline use. Pull to
refresh, or wait a minute.

**No email arrived and the Action was green.** The log will say
`no races in scope` (nothing on today, or the day is blocked) or
`already sent`. Both are the script working correctly.

**No email and the Action was red.** Open the run and read the last step.
`RESEND_API_KEY is not set` means the secret name is wrong.
`Resend 403` usually means the from address is not a domain you have
verified.

**Emails stopped after about two months of no commits.** GitHub disables
scheduled workflows on repositories with no activity for 60 days, and
emails you about it. Publish any edit, or press **Run workflow** once, to
wake it up. This repo commits `data/sent.json` on every send, so in normal
use it never goes quiet for long enough.

**An hour out after a clock change.** It should not happen: times are
stored in UTC and the email job reads the real Eastern time on the day.
If you ever do see it, check that the race's stored UTC time is right by
opening its card, where the UTC value is shown underneath.

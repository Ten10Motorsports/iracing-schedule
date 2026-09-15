# Race Schedule

An iRacing league calendar that runs entirely on GitHub Pages, edits
itself, and emails you on race day.

**Setup instructions: [SETUP.md](SETUP.md).** Read that first.

---

## What it does

- **Many leagues, seven days a week, several races a day.** Each league
  has its own colour, its own season, and its own round numbering, so
  "Week 4 of 10" means the right thing for each one at the same time.
- **Four views.** Month calendar (the default), week, a chronological
  list, and a per-league season table.
- **Days off.** Block a date or a range and every race inside it is
  greyed, flagged, and left out of the emails. A single race can be
  overridden back to *racing* without unblocking the whole period.
- **Clash detection.** Overlaps are worked out across the whole window
  from practice opening to the chequered flag, not just the start times,
  and are flagged on the calendar and as you type in the editor.
- **Full editing in the browser.** Add, edit and delete races, leagues,
  and off periods. Saving commits straight back to this repo.
- **Two emails a day**, at 10:00 and 19:00 Eastern, sent only when you
  actually have something on.
- **Installable.** Add it to a phone home screen and it opens fullscreen
  and works without signal.

## How it is put together

```
index.html               the whole app shell
assets/
  app.css                dark theme, red / white / grey
  util.js                time maths (UTC to Eastern and back)
  content.js             bundled iRacing track and car lists
  store.js               state, plus everything that talks to GitHub
  views.js               month, week, list, season, drawer, .ics export
  admin.js               editor, settings, import and export
  app.js                 boot and wiring
data/
  schedule.json          the only file that matters. Everything is here.
  sent.json              which notifications have already gone out
scripts/notify.mjs       builds and sends the emails
.github/workflows/       the scheduled job that runs the above
sw.js                    offline caching
```

There is no build step, no framework and no dependencies. Open
`index.html` with any static server and it runs.

### Where the data lives

`data/schedule.json` is the single source of truth. The page reads it,
the email job reads it, and the editor writes it back through the GitHub
Contents API. Nothing else stores schedule state.

Edits are also mirrored into `localStorage` as you make them, so closing
the tab mid-edit or a failed publish does not lose work. On the next load
the newer of the two wins, and the draft is cleared once published.

### Why every time is stored in UTC

`startUtc`, `practiceUtc` and `qualifyUtc` are UTC instants. Eastern wall
time only exists at the edges: when you type a time in, and when
something is displayed. This is what makes the March and November clock
changes a non-event, and it is why the email job works out the real
current Eastern time itself rather than trusting a UTC cron to fire at
10am.

### Why the notification job wakes every 30 minutes

GitHub cron is UTC-only and delays scheduled runs under load, sometimes
by more than ten minutes. So the workflow wakes often and
`scripts/notify.mjs` decides whether a slot is actually due, inside a
50 minute window. `data/sent.json` is committed back after each send, so
the same slot never goes out twice.

### Security, stated plainly

- The repo is public, so `data/schedule.json` is public. Do not put
  anything private in the notes field.
- The admin passcode is stored as a SHA-256 hash **in that public file**.
  It keeps a casual visitor out of the editor. It is not a real security
  boundary and is not meant to be.
- The GitHub token is the real control. It lives only in the browser
  you pasted it into, is never written to any file in the repo, and is
  only ever sent to `api.github.com`. Scope it to this one repository
  with Contents: Read and write, and nothing else.
- The Resend API key lives only as a GitHub Actions secret.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `M` `W` `L` `S` | Month, week, list, seasons |
| `←` `→` | Previous / next month or week |
| `E` | Unlock editing |
| `N` | New race |
| `Ctrl/Cmd + S` | Publish to GitHub |
| `Esc` | Close whatever is open |

## Running it locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Preview an email without sending it:

```bash
node scripts/notify.mjs --force morning --dry-run
node scripts/notify.mjs --force morning --dry-run --html preview.html
```

## Adding tracks and cars

`assets/content.js` carries the type-ahead lists. It is current to about
mid 2026. Anything you type that is not in the list is accepted as-is and
remembered for next time, stored under `customContent` in the data file.
To add something permanently for everyone, add it to `content.js`, and
add a short name to `shortNames` in the same file if the full name is too
long for a calendar tile.

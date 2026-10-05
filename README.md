# Limitless

A personal life dashboard that lives on your phone's Home Screen, styled in warm white with walnut wood accents. It sends you push notifications and covers:

![Limitless screens](docs/screens.jpg)

- **Today**: a morning snapshot with your non-negotiables, today's schedule, homework due, bulk progress, important emails, goals, and a journal prompt.
- **Calendar**: month and upcoming views. It merges your Google, Apple or Outlook calendars, your own events, and homework due dates.
- **Approvals**: anything Limitless finds on its own waits here until you tap **Approve**. That covers new Schoology assignments, events from linked calendars, and dates spotted in important emails. Nothing lands on your calendar without your OK.
- **Homework**: grouped by Overdue, Today, Tomorrow, This week and Later. Schoology assignments import automatically, and you can filter by class.
- **Journal**: each night you write what went right, what went wrong, and the **non-negotiables for tomorrow**. Those show up as a checklist the next morning, and the app tracks your streak.
- **Body & bulk**: daily weigh-ins with a 7-day average trend chart, weekly gain rate with an "on pace" check, a goal projection, calories and protein, lifts with estimated 1-rep max, and tape measurements.
- **Goals**: each goal has milestones or a number to hit, plus a progress bar.
- **Ideas & projects**: an idea inbox for quick thoughts. You can turn any idea into a project with its own tasks and notes.
- **Important email**: the app watches your inbox and alerts you only about emails that match your rules. Optionally, Claude AI can screen emails against a plain-English description of what matters to you.

### Notifications you'll get

| When | What |
|---|---|
| 7:00 AM | Morning briefing: events, what's due, today's non-negotiables, items waiting for approval |
| 7:30 AM | Weigh-in reminder (only if you haven't logged one yet) |
| 6:00 PM | Homework due tomorrow |
| 9:00 PM | Journal reminder (only if you haven't written today) |
| 3 h before | A timed assignment is due soon |
| 30 min before | An event is starting |
| Right away | An important email arrives, or new items are waiting for approval |

You can change every time, or turn any reminder off, in **Settings → Reminders**.

---

## 1. Put it online (about 10 minutes)

Limitless is a small web server plus a database file. It has to run 24/7 to check your email and send reminders, so host it somewhere that doesn't go to sleep. These steps use [Railway](https://railway.com), which is the simplest option. Any host that runs a Dockerfile and supports a persistent disk will also work (Fly.io, Render with a disk, or a home server).

1. Sign in to Railway with your GitHub account.
2. Click **New Project → Deploy from GitHub repo** and pick **Limitless**. Railway sees the `Dockerfile` and builds it.
3. Open the service and go to **Variables**. Add:
   - `APP_PASSWORD`: the password you'll type to unlock the app. Make it long.
   - Optional: `ANTHROPIC_API_KEY`, only if you want AI email screening (see below).
4. Right-click the service and choose **Attach volume**, with the mount path set to **`/data`**. Your data lives here and survives redeploys.
5. Go to **Settings → Networking → Generate Domain**. You'll get an address like `https://limitless-production.up.railway.app`.

Railway's paid Hobby plan costs a few dollars a month. Check their pricing page for current numbers.

## 2. Install it on your phone

**iPhone (iOS 16.4 or newer)**
1. Open your Limitless address in **Safari** and unlock it with your password.
2. Tap **Share → Add to Home Screen**.
3. Open Limitless **from the Home Screen icon**, and tap **Turn on** on the "Turn on notifications" card. Apple only allows notifications for apps added to the Home Screen.

**Android**
1. Open the address in Chrome and unlock it.
2. Tap **⋮ → Install app** (or **Add to Home screen**), then allow notifications when asked.

To confirm it works, go to **Settings → Notifications → Send test**.

## 3. Connect your stuff

Everything below lives in **Settings** (the **More** tab, then **Settings**).

### Calendars (Google, Apple, Outlook)
Paste a calendar's private **iCal link**:
- **Google Calendar** (on a computer): ⚙ Settings → pick your calendar under *Settings for my calendars* → *Integrate calendar* → copy **Secret address in iCal format**.
- **iCloud**: in the Calendar app, tap ⓘ next to a calendar, turn on *Public Calendar*, then copy the share link.
- **Outlook**: Settings → Calendar → Shared calendars → *Publish a calendar* → copy the ICS link.

New events from a linked calendar wait in **Approvals**. Approving a repeating event approves the whole series. If you trust a calendar completely, turn on **Auto-approve** for it.

### Schoology (homework import)
Use either method, or both:
- **Calendar feed (easiest):** in Schoology on a browser, open **Calendar**, click the **iCal/Export** button, and paste the link.
- **API key (adds class names):** while signed in, go to `https://<your-school>.schoology.com/api`, then copy the **Current Key** and **Current Secret**. Some schools turn this page off. If yours does, the calendar feed still works.

The app checks Schoology every 30 minutes. New assignments go to **Approvals** first, and you get a notification. If you'd rather they go straight into Homework, turn on **Auto-approve Schoology work**.

### Email alerts
1. **Connect your email.** For Gmail, turn on 2-Step Verification, then create an **App Password** at `myaccount.google.com/apppasswords` and paste it in. iCloud and Yahoo have app passwords too. Limitless only *reads* mail. It opens your inbox read-only and never marks, moves, sends or deletes anything.
2. **Tell it what's important** with rules:
   - *From*: a person or domain, like `@myschool.org`, `coach@` or `Mom`.
   - *Subject contains* / *Anywhere contains*: keywords, comma-separated, like `test, due, schedule change`.
   - *Gmail marked it important*: uses Gmail's own Important label.
   - *Never alert me from*: blocks a sender (`noreply@, newsletter`), and always wins over other rules.

> School Google or Microsoft accounts sometimes block app passwords. If yours won't connect, set your school mail to auto-forward to your personal Gmail and connect that instead.

### AI screening (optional)
If you'd rather describe what matters than write rules, turn on **AI screening**. Add an Anthropic API key from [console.anthropic.com](https://console.anthropic.com) (either in Settings or as the `ANTHROPIC_API_KEY` variable), and write something like *"emails from my teachers and coaches, anything about grades, tests, college or my job"*.

Claude checks new emails your rules didn't catch. It skips mailing-list blasts to keep costs down. It writes a one-line summary for each alert, and when an email mentions a date (*"the test moved to Friday"*), it suggests a calendar event for you to approve. You can try it on a sample email in Settings before turning it on. The API is billed per use by Anthropic. For a normal personal inbox that is usually cents per day.

## 4. Everyday use

- **Morning**: check off your non-negotiables on **Today**, log your weight, and clear anything waiting in **Approvals**.
- **During the day**: mark homework done with a tap, and drop ideas into **Ideas & projects** whenever they hit.
- **Night**: open **Journal**. Write what went right and what went wrong, then set tomorrow's non-negotiables. They'll show up in tomorrow's 7 AM briefing.
- **Body & bulk**: set your goal weight, target rate (0.25–0.5 lb/week is a lean bulk), and calorie and protein targets with the 🎯 button. The rate check tells you to eat more or less.
- **Backups**: Settings → **Back up** downloads everything as a JSON file.

---

## Running it on a computer (for development)

Requires Node.js 22.18 or newer.

```bash
npm install
cp .env.example .env    # optional; without APP_PASSWORD the dev password is "limitless"
npm run dev             # app on http://localhost:5173, API on :8787
```

Other commands:

```bash
npm test                # unit + API tests
npm run typecheck       # TypeScript checks for server and app
npm run build           # production build into dist/
npm start               # serve the built app + API on :8787
```

### How it's built
- `server/`: Node.js + Express, run straight from TypeScript. It stores data in SQLite (`node:sqlite`, a single file at `$DATA_DIR/limitless.db`), and a one-minute scheduler runs syncs and reminders.
  - `services/ical.ts` parses calendar feeds, including repeating events and time zones.
  - `services/schoology.ts` handles the Schoology iCal and API import (OAuth 1.0a).
  - `services/email.ts` checks mail over IMAP and applies your rules. `services/ai.ts` holds the optional Claude screening.
  - `services/approvals.ts` runs the approval queue. `services/reminders.ts` and `services/push.ts` handle notifications (Web Push).
- `web/`: a React app built with Vite and installable as a PWA. `web/public/sw.js` is the service worker that handles notifications and offline loading.
- `scripts/make-icons.mjs` regenerates the wood app icons.

### Security notes
- The whole app sits behind your password, and sessions are long-lived, secure, HTTP-only cookies.
- Email app passwords, calendar links, Schoology keys and the Anthropic key are encrypted at rest (AES-256-GCM), and the app never shows them back to you.
- Everything lives in your own database on your own server. There is no third-party analytics.

# Limitless

A personal life dashboard that lives on your phone's Home Screen, in clean white with brushed dark-silver accents. It runs entirely on your phone: there's no server and no account, and nothing you enter leaves the device. It's hosted free on GitHub Pages.

![Limitless screens](docs/screens.jpg)

- **Today**: your non-negotiables checklist, today's schedule, homework due, bulk progress, goals, and a journal prompt.
- **Calendar**: month and upcoming views of your events and homework due dates.
- **Homework**: grouped by Overdue, Today, Tomorrow, This week and Later, with class filters. Add assignments yourself, or import your Schoology calendar file.
- **Journal**: what went right, what went wrong, and the **non-negotiables for tomorrow**, which become tomorrow's checklist. The app tracks your streak.
- **Body & bulk**: daily weigh-ins with a 7-day average trend chart, weekly gain rate with an "on pace" check, a goal projection, calories and protein, lifts with estimated 1-rep max, and tape measurements.
- **Goals**: each goal has milestones or a number to hit, plus a progress bar.
- **Ideas & projects**: an idea inbox for quick thoughts. You can turn any idea into a project with tasks and notes.
- **Reminders**: Limitless adds daily alerts (plan your day, weigh-in, homework check, journal) to your phone's own **Calendar app**, so you're alerted even when Limitless is closed. Any assignment or event can be added there too, with an alert before it's due.
- **Backups**: export everything to a file and restore it on any phone.

> The earlier server version (email alerts, appointments found in email, automatic Schoology sync, push notifications) is saved on the [`email-feature`](../../tree/email-feature) branch. It needs an always-on server, so it can't run on GitHub Pages.

## Open it on your phone

Your app's address is **https://noaharrison09-ux.github.io/Limitless/**

**iPhone**
1. Open the address in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Always open Limitless from that Home Screen icon. On iPhone, the Home Screen app keeps its own data, separate from Safari, so start entering things there.

**Android**
1. Open the address in **Chrome**.
2. Tap **⋮ → Install app** (or **Add to Home screen**) and open it from the icon.

It works offline after the first visit.

## Set up reminders

1. Open **More → Settings → Reminders** and pick your times.
2. Tap **Add daily reminders to my phone**.
   - **iPhone:** choose **Save to Files**, then open the Files app, tap `limitless-reminders.ics`, and tap **Add All**.
   - **Android:** choose your Calendar app, or open the downloaded file.
3. Your Calendar app now alerts you at those times every day. If you change the times later, delete the old Limitless reminders in your Calendar app and add them again.

## Import homework from Schoology

1. In Safari, sign in to Schoology, open **Calendar**, tap the **iCal/Export** button, and copy the link.
2. Paste it into the address bar, change `webcal://` to `https://`, open it, and save the file (**Share → Save to Files**).
3. In Limitless, go to **More → Import calendar**, choose **As homework**, and pick the file.

Import again whenever you like. Only new assignments are added, and anything you've checked off or removed stays that way. A Google Calendar export (Settings → Import & export → Export) can be imported **As calendar events** the same way.

## Your data

Everything is stored in a small database on your phone. Use **Settings → Back up** now and then and save the file somewhere safe (iCloud Drive, Google Drive). If you switch phones or clear your browser data, **Restore** brings everything back.

## Publishing (GitHub Pages)

Every push to `main` runs `.github/workflows/deploy-pages.yml`. It installs dependencies, typechecks, runs the tests, builds, and publishes the site. One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.

## Development

Requires Node.js 22 or newer.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit + API tests (runs the same SQLite engine as the phone)
npm run typecheck
npm run build      # static site in dist/
```

### How it's built
- `web/src/pages`: the screens (React). They "call an API" (`/today`, `/homework`, …) like a normal web app.
- `web/src/core`: that API, running inside the page. It has a tiny router (`router.ts`), routes in `routes/`, and SQLite compiled to WebAssembly ([sql.js](https://sql.js.org)) in `db.ts`. The database file is saved to the phone's storage (IndexedDB) after every change, by `web/src/lib/localApi.ts`.
- `web/src/core/calendarFiles.ts`: calendar files in (Schoology/Google `.ics` → homework or events) and out (reminders and due dates with alerts for the phone's Calendar app).
- `web/public/sw.js`: the service worker that lets the app load offline from the Home Screen.
- `scripts/make-icons.mjs`: regenerates the app icons.

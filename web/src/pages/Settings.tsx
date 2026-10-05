import { useEffect, useRef, useState } from "react";
import { api, errorMessage, refreshAll, toast } from "../lib/api";
import { useApi } from "../lib/hooks";
import { isIos, isStandalone, readFileText, shareOrDownload } from "../lib/device";
import { storageIsPersistent } from "../lib/localApi";
import { ago } from "../lib/dates";
import { STALE_AFTER_MS, runSync, type SyncStatus } from "../lib/sync";
import type { Settings } from "../lib/types";
import { Icon } from "../components/Icon";
import { PhoneCalendarButton } from "../components/PhoneCalendar";
import { Card, ErrorBox, Field, Spinner, TopBar } from "../components/ui";

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />;
}

/* ---------- Profile ---------- */

function ProfileCard({ s, onSaved }: { s: Settings; onSaved: () => void }) {
  const [name, setName] = useState(s.prefs.name);
  const save = async (patch: Record<string, unknown>) => {
    try {
      await api.put("/settings/prefs", patch);
      toast("Saved");
      onSaved();
    } catch (err) {
      toast(errorMessage(err));
    }
  };
  return (
    <Card title="You">
      <div className="form">
        <Field label="Name" hint="for your greeting">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== s.prefs.name && save({ name })} />
        </Field>
        <Field label="Units">
          <select className="input" value={s.prefs.units} onChange={(e) => save({ units: e.target.value })}>
            <option value="lb">Pounds (lb)</option>
            <option value="kg">Kilograms (kg)</option>
          </select>
        </Field>
      </div>
    </Card>
  );
}

/* ---------- Calendar sync (Apple Calendar + Schoology, through GitHub) ---------- */

/** github.com/<you>/<repo> when the app is running on GitHub Pages. */
function repoUrl(): string | null {
  const user = location.hostname.match(/^([^.]+)\.github\.io$/i)?.[1];
  const repo = location.pathname.split("/").filter(Boolean)[0];
  return user && repo ? `https://github.com/${user}/${repo}` : null;
}

function SyncCard() {
  const { data: s, setData, reload } = useApi<SyncStatus>("/sync/status");
  const [editing, setEditing] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repo = repoUrl();

  const syncNow = async (force: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const next = await runSync(force);
      setData(next);
      if (next.lastError) setError(next.lastError);
      else toast(next.changed ? "Calendars updated" : "Already up to date");
    } catch (err) {
      setError(errorMessage(err));
      void reload();
    } finally {
      setBusy(false);
    }
  };

  const savePassphrase = async (value: string) => {
    setError(null);
    try {
      setData(await api.put<SyncStatus>("/sync/settings", { passphrase: value }));
      setEditing(false);
      setPassphrase("");
      if (value) await syncNow(true);
      else toast("Calendar sync turned off");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (!s) return null;
  const showForm = !s.configured || editing;
  const stale = s.appliedSyncedAt && Date.now() - new Date(s.appliedSyncedAt).getTime() > STALE_AFTER_MS;
  const link = (path: string, text: string) =>
    repo ? (
      <a href={`${repo}${path}`} target="_blank" rel="noreferrer">
        {text}
      </a>
    ) : (
      <strong>{text}</strong>
    );

  return (
    <Card title="Calendar sync" eyebrow="Apple Calendar & Schoology">
      <p className="small" style={{ margin: "0 0 10px", color: "var(--ink-2)" }}>
        Keeps your calendar and homework up to date by itself. Every 3 hours GitHub downloads your calendars, locks them with your passphrase, and
        Limitless unlocks them when you open it.
      </p>

      {s.configured && (
        <div className="sync-status">
          <Icon name="refresh" size={18} />
          <div style={{ minWidth: 0 }}>
            <strong>{s.appliedSyncedAt ? `Updated ${ago(s.appliedSyncedAt)}` : "Waiting for the first sync"}</strong>
            {s.counts && (
              <div className="small muted">
                {s.counts.events} events · {s.counts.homework} assignments
              </div>
            )}
          </div>
        </div>
      )}
      {stale && (
        <div className="notice warn" style={{ marginTop: 10 }}>
          Nothing new from GitHub in over a day. GitHub pauses schedules on repos with no changes for 60 days: open {link("/actions", "Actions")} →{" "}
          <strong>Deploy to GitHub Pages</strong> and tap <strong>Enable workflow</strong> or <strong>Run workflow</strong>.
        </div>
      )}
      {s.sourceErrors.length > 0 && (
        <div className="notice warn" style={{ marginTop: 10 }}>
          {s.sourceErrors.map((e) => (
            <div key={e.source}>
              <strong>{e.source}:</strong> {e.message}
            </div>
          ))}
        </div>
      )}

      {showForm ? (
        <form
          className="form"
          style={{ marginTop: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            void savePassphrase(passphrase);
          }}
        >
          <Field label="Sync passphrase" hint="the same as SYNC_PASSPHRASE on GitHub">
            <input
              className="input"
              type="password"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="four or more random words"
            />
          </Field>
          <div className="btn-row">
            <button className="btn primary" disabled={!passphrase.trim() || busy}>
              {busy ? "Syncing…" : "Save and sync"}
            </button>
            {editing && (
              <button type="button" className="btn" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
          {editing && (
            <button type="button" className="btn ghost block" onClick={() => confirm("Turn off calendar sync on this phone?") && savePassphrase("")}>
              Turn off sync
            </button>
          )}
        </form>
      ) : (
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={busy} onClick={() => syncNow(true)}>
            <Icon name="refresh" size={17} /> {busy ? "Syncing…" : "Sync now"}
          </button>
          <button className="btn" onClick={() => setEditing(true)}>
            Change passphrase
          </button>
        </div>
      )}
      <ErrorBox error={error} />

      <details className="help" style={{ marginTop: 12 }} open={!s.configured}>
        <summary>How to set it up (once)</summary>
        <ol>
          <li>
            Make up a passphrase: four or more random words, at least 16 characters. You'll type it in two places, GitHub and here.
          </li>
          <li>
            <strong>Apple Calendar link:</strong> on your iPhone open <strong>Calendar</strong> → <strong>Calendars</strong> → tap ⓘ next to your
            calendar → turn on <strong>Public Calendar</strong> → <strong>Share Link</strong> → <strong>Copy</strong>. Only paste it into GitHub:
            anyone who has the link can see that calendar.
          </li>
          <li>
            <strong>Schoology link:</strong> in Schoology open <strong>Calendar</strong>, tap <strong>iCal</strong> / <strong>Export</strong>, and copy
            the link.
          </li>
          <li>
            On GitHub open {link("/settings/secrets/actions", "Settings → Secrets and variables → Actions")} and add three{" "}
            <strong>repository secrets</strong>: <code>SYNC_PASSPHRASE</code>, <code>CALENDAR_ICAL_URL</code> (the Apple link) and{" "}
            <code>SCHOOLOGY_ICAL_URL</code>. More than one calendar? Put each link on its own line.
          </li>
          <li>
            Open {link("/actions/workflows/deploy-pages.yml", "Actions → Deploy to GitHub Pages")}, tap <strong>Run workflow</strong>, and wait about
            two minutes.
          </li>
          <li>Type the passphrase above and tap Save and sync.</li>
        </ol>
        <p className="small muted">
          Secrets stay hidden on GitHub, and the file it publishes is locked with your passphrase. Your journal, weight and everything else never leave
          this phone.
        </p>
      </details>
    </Card>
  );
}

/* ---------- Reminders (through the phone's own Calendar app) ---------- */

function RemindersCard({ s, onSaved }: { s: Settings; onSaved: () => void }) {
  const r = s.reminders;
  const save = async (patch: Record<string, unknown>) => {
    try {
      await api.put("/settings/reminders", patch);
      onSaved();
    } catch (err) {
      toast(errorMessage(err));
    }
  };
  const timed: { key: "morningBriefing" | "weighIn" | "homeworkEvening" | "journal"; label: string; sub: string }[] = [
    { key: "morningBriefing", label: "Plan your day", sub: "Morning check-in" },
    { key: "weighIn", label: "Weigh-in", sub: "Before breakfast" },
    { key: "homeworkEvening", label: "Homework check", sub: "What's due tomorrow" },
    { key: "journal", label: "Journal", sub: "Reflect on the day" },
  ];
  const appUrl = `${location.origin}${location.pathname}`;
  return (
    <Card title="Reminders" eyebrow="Alerts on your phone">
      <p className="small" style={{ margin: "0 0 4px", color: "var(--ink-2)" }}>
        Limitless lives on your phone, so it uses your phone's own <strong>Calendar app</strong> to alert you, even when Limitless is closed. Pick
        your times, then tap the button to add them as daily repeating alerts.
      </p>
      {timed.map((t) => (
        <div key={t.key} className="setting-row">
          <div style={{ minWidth: 0 }}>
            <strong>{t.label}</strong>
            <div className="small muted">{t.sub}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input className="input" type="time" value={r[t.key].time} disabled={!r[t.key].enabled} onChange={(e) => save({ [t.key]: { time: e.target.value } })} />
            <Switch checked={r[t.key].enabled} onChange={(v) => save({ [t.key]: { enabled: v } })} label={t.label} />
          </div>
        </div>
      ))}
      <div style={{ marginTop: 10 }}>
        <PhoneCalendarButton path={`/ics/reminders?appUrl=${encodeURIComponent(appUrl)}`} label="Add daily reminders to my phone" primary />
      </div>
      <details className="help" style={{ marginTop: 10 }}>
        <summary>How this works</summary>
        <ol>
          {isIos() ? (
            <>
              <li>
                Tap the button and choose <strong>Save to Files</strong>.
              </li>
              <li>
                Open the <strong>Files</strong> app, tap <strong>limitless-reminders.ics</strong>, then tap <strong>Add All</strong>.
              </li>
            </>
          ) : (
            <li>Tap the button and choose your Calendar app (or open the downloaded file) to add the reminders.</li>
          )}
          <li>Changed your times? Delete the old Limitless reminders in your Calendar app and add them again.</li>
        </ol>
        <p className="small muted">
          Each assignment and event also has an <strong>Add to phone calendar</strong> button, which adds it with an alert{" "}
          {r.homeworkDueSoon.hours} hours before homework is due and {r.events.minutesBefore} minutes before events.
        </p>
      </details>
      <div className="setting-row">
        <div>
          <strong>Homework alert</strong>
          <div className="small muted">Hours before it's due</div>
        </div>
        <input className="input" type="number" min={1} max={48} style={{ width: 80 }} value={r.homeworkDueSoon.hours} onChange={(e) => save({ homeworkDueSoon: { hours: Number(e.target.value) } })} />
      </div>
      <div className="setting-row">
        <div>
          <strong>Event alert</strong>
          <div className="small muted">Minutes before it starts</div>
        </div>
        <input className="input" type="number" min={0} max={1440} style={{ width: 80 }} value={r.events.minutesBefore} onChange={(e) => save({ events: { minutesBefore: Number(e.target.value) } })} />
      </div>
    </Card>
  );
}

/* ---------- Data on this device ---------- */

function DataCard() {
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    storageIsPersistent().then(setPersistent).catch(() => setPersistent(false));
  }, []);

  const backup = async () => {
    try {
      const data = await api.get("/export");
      const name = `limitless-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const how = await shareOrDownload(name, JSON.stringify(data, null, 2), "application/json");
      if (how !== "cancelled") toast(how === "shared" ? "Save it somewhere safe, like Files or iCloud Drive" : "Backup downloaded");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const restore = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const data = JSON.parse(await readFileText(file));
      if (!confirm("Replace everything on this phone with this backup?")) return;
      await api.post("/restore", { data });
      toast("Backup restored");
      refreshAll();
    } catch (err) {
      setError(err instanceof SyntaxError ? "That isn't a Limitless backup file." : errorMessage(err));
    } finally {
      if (input.current) input.current.value = "";
    }
  };

  return (
    <Card title="Your data" eyebrow="Stored only on this phone">
      <p className="small" style={{ margin: "0 0 10px", color: "var(--ink-2)" }}>
        Everything you enter stays on this phone. Nothing is sent anywhere. Back up now and then (for example to iCloud Drive or Google Drive) so a lost
        phone or cleared browser data doesn't erase it.
      </p>
      {persistent === false && (
        <div className="notice" style={{ marginBottom: 10 }}>
          {isStandalone()
            ? "Your browser hasn't promised to keep this app's data permanently, so regular backups are a good idea."
            : "Open Limitless from your Home Screen icon so your data is kept with the app."}
        </div>
      )}
      <div className="btn-row">
        <button className="btn" onClick={backup}>
          <Icon name="download" size={17} /> Back up
        </button>
        <button className="btn" onClick={() => input.current?.click()}>
          <Icon name="refresh" size={17} /> Restore
        </button>
      </div>
      <input ref={input} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={(e) => restore(e.target.files?.[0])} />
      <ErrorBox error={error} />
    </Card>
  );
}

export function SettingsPage() {
  const { data, error, reload } = useApi<Settings>("/settings");

  return (
    <>
      <TopBar title="Settings" back />
      <div className="page">
        <ErrorBox error={error} />
        {!data ? (
          <Spinner />
        ) : (
          <>
            <ProfileCard s={data} onSaved={reload} />
            <SyncCard />
            <RemindersCard s={data} onSaved={reload} />
            <DataCard />
          </>
        )}
      </div>
    </>
  );
}

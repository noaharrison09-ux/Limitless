import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, errorMessage, refreshAll, toast } from "../lib/api";
import { useApi } from "../lib/hooks";
import { ago } from "../lib/dates";
import { currentSubscription, disablePush, enablePush, isIos, needsInstallForPush, pushSupported } from "../lib/push";
import type { Settings } from "../lib/types";
import { Icon } from "../components/Icon";
import { Card, ErrorBox, Field, Spinner, TopBar } from "../components/ui";

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />;
}

function Help({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="help">
      <summary>{summary}</summary>
      {children}
    </details>
  );
}

/* ---------- Notifications ---------- */

function NotificationsCard({ s }: { s: Settings }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    currentSubscription().then((sub) => setOn(!!sub)).catch(() => setOn(false));
  }, []);

  const toggle = async (v: boolean) => {
    setError(null);
    try {
      if (v) await enablePush(s.push.publicKey);
      else await disablePush();
      setOn(v);
      toast(v ? "Notifications on" : "Notifications off on this device");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const test = async () => {
    const r = await api.post<{ sent: number }>("/push/test");
    toast(r.sent ? "Test sent — check your lock screen" : "No devices subscribed yet");
  };

  return (
    <Card eyebrow="This phone" title="Notifications">
      {needsInstallForPush() ? (
        <div className="notice">
          On iPhone, open this site in <strong>Safari</strong>, tap <strong>Share</strong> → <strong>Add to Home Screen</strong>, then open Limitless from your Home Screen and come back here.
        </div>
      ) : !pushSupported() ? (
        <div className="notice">This browser can't receive push notifications.</div>
      ) : (
        <div className="setting-row">
          <div>
            <strong>Push notifications</strong>
            <div className="small muted">{on ? "On for this device" : "Off"}</div>
          </div>
          {on !== null && <Switch checked={on} onChange={toggle} label="Push notifications" />}
        </div>
      )}
      <ErrorBox error={error} />
      <div className="setting-row">
        <span className="small muted">
          {s.push.devices} device{s.push.devices === 1 ? "" : "s"} subscribed{isIos() ? " · iOS 16.4+ required" : ""}
        </span>
        <button className="btn small" onClick={test} disabled={!s.push.devices}>
          Send test
        </button>
      </div>
    </Card>
  );
}

/* ---------- Profile & reminders ---------- */

function ProfileCard({ s, onSaved }: { s: Settings; onSaved: () => void }) {
  const [name, setName] = useState(s.prefs.name);
  const [tz, setTz] = useState(s.prefs.timezone);
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
        <div className="grid-2">
          <Field label="Units">
            <select className="input" value={s.prefs.units} onChange={(e) => save({ units: e.target.value })}>
              <option value="lb">Pounds (lb)</option>
              <option value="kg">Kilograms (kg)</option>
            </select>
          </Field>
          <Field label="Time zone">
            <input className="input" list="zones" value={tz} onChange={(e) => setTz(e.target.value)} onBlur={() => tz !== s.prefs.timezone && save({ timezone: tz })} />
            <datalist id="zones">
              {(Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone").map((z) => <option key={z} value={z} />)}
            </datalist>
          </Field>
        </div>
      </div>
    </Card>
  );
}

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
    { key: "morningBriefing", label: "Morning briefing", sub: "Your day at a glance" },
    { key: "weighIn", label: "Weigh-in", sub: "If not logged yet" },
    { key: "homeworkEvening", label: "Homework check", sub: "What's due tomorrow" },
    { key: "journal", label: "Journal", sub: "If not written yet" },
  ];
  return (
    <Card title="Reminders">
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
      <div className="setting-row">
        <div>
          <strong>Due-soon alert</strong>
          <div className="small muted">Hours before a timed assignment</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input className="input" type="number" min={1} max={48} style={{ width: 70 }} value={r.homeworkDueSoon.hours} onChange={(e) => save({ homeworkDueSoon: { hours: Number(e.target.value) } })} />
          <Switch checked={r.homeworkDueSoon.enabled} onChange={(v) => save({ homeworkDueSoon: { enabled: v } })} label="Due-soon alert" />
        </div>
      </div>
      <div className="setting-row">
        <div>
          <strong>Event alert</strong>
          <div className="small muted">Minutes before an event</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input className="input" type="number" min={5} max={1440} style={{ width: 70 }} value={r.events.minutesBefore} onChange={(e) => save({ events: { minutesBefore: Number(e.target.value) } })} />
          <Switch checked={r.events.enabled} onChange={(v) => save({ events: { enabled: v } })} label="Event alert" />
        </div>
      </div>
    </Card>
  );
}

/* ---------- Calendars ---------- */

type Feed = { id: number; name: string; color: string | null; enabled: number; auto_approve: number; last_synced: string | null; last_error: string | null; event_count: number; pending_count: number };

function CalendarsCard() {
  const { data, reload } = useApi<Feed[]>("/calendar/feeds");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [autoApprove, setAutoApprove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ events: number; newPending: string[] }>("/calendar/feeds", { name, url, auto_approve: autoApprove });
      toast(autoApprove ? `Linked · ${r.events} events added` : `Linked · ${r.newPending.length} events waiting for approval`);
      setName("");
      setUrl("");
      reload();
      refreshAll();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const update = async (f: Feed, patch: Record<string, unknown>) => {
    await api.patch(`/calendar/feeds/${f.id}`, patch);
    reload();
    refreshAll();
  };
  const sync = async (f: Feed) => {
    try {
      await api.post(`/calendar/feeds/${f.id}/sync`);
      toast("Synced");
    } catch (err) {
      toast(errorMessage(err));
    }
    reload();
    refreshAll();
  };
  const remove = async (f: Feed) => {
    if (!confirm(`Unlink “${f.name}”?`)) return;
    await api.del(`/calendar/feeds/${f.id}`);
    reload();
    refreshAll();
  };

  return (
    <Card title="Calendars" eyebrow="Google · Apple · Outlook">
      {data?.map((f) => (
        <div key={f.id} style={{ padding: "10px 0", borderTop: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="swatch" style={{ background: f.color ?? "var(--oak)" }} />
            <strong style={{ flex: 1 }}>{f.name}</strong>
            <button className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Sync now" onClick={() => sync(f)}>
              <Icon name="refresh" size={16} />
            </button>
            <button className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Unlink" onClick={() => remove(f)}>
              <Icon name="trash" size={16} />
            </button>
          </div>
          <div className="small muted" style={{ marginTop: 2 }}>
            {f.event_count} approved{f.pending_count ? ` · ${f.pending_count} waiting` : ""}
            {f.last_synced ? ` · synced ${ago(f.last_synced)}` : ""}
          </div>
          {f.last_error && <div className="error" style={{ marginTop: 6 }}>{f.last_error}</div>}
          <div className="setting-row" style={{ paddingBottom: 0 }}>
            <span className="small">Auto-approve events from this calendar</span>
            <Switch checked={!!f.auto_approve} onChange={(v) => update(f, { auto_approve: v })} label="Auto-approve" />
          </div>
        </div>
      ))}
      <form className="form" onSubmit={add} style={{ marginTop: data?.length ? 12 : 0 }}>
        <div className="grid-2">
          <input className="input" placeholder="Name (e.g. Personal)" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" placeholder="iCal link" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <label className="setting-row" style={{ padding: 0 }}>
          <span className="small">Skip approval for this calendar</span>
          <Switch checked={autoApprove} onChange={setAutoApprove} label="Skip approval" />
        </label>
        <ErrorBox error={error} />
        <button className="btn primary block" disabled={!name || !url || busy}>
          {busy ? "Linking…" : "Link calendar"}
        </button>
      </form>
      <div style={{ marginTop: 12 }}>
        <Help summary="Where do I find my iCal link?">
          <ol>
            <li>
              <strong>Google Calendar</strong> (on a computer): Settings → click your calendar under “Settings for my calendars” → “Integrate calendar” → copy <em>Secret address in iCal format</em>.
            </li>
            <li>
              <strong>Apple / iCloud</strong>: Calendar app → tap ⓘ next to a calendar → turn on <em>Public Calendar</em> → Share Link.
            </li>
            <li>
              <strong>Outlook</strong>: Settings → Calendar → Shared calendars → Publish a calendar → copy the ICS link.
            </li>
          </ol>
          <p className="small muted">New events wait in Approvals until you OK them, unless you turn on auto-approve.</p>
        </Help>
      </div>
    </Card>
  );
}

/* ---------- Schoology ---------- */

function SchoologyCard({ s, onSaved }: { s: Settings; onSaved: () => void }) {
  const [ical, setIcal] = useState("");
  const [key, setKey] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const sg = s.schoology;

  const save = async (body: Record<string, unknown>, then?: () => void) => {
    try {
      await api.put("/schoology", body);
      then?.();
      onSaved();
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  const sync = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ imported: number; updated: number }>("/schoology/sync");
      toast(r.imported ? `${r.imported} new assignment${r.imported > 1 ? "s" : ""}${sg.autoApprove ? "" : " waiting for approval"}` : "Up to date");
      refreshAll();
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
      onSaved();
    }
  };

  return (
    <Card title="Schoology" eyebrow="Homework import">
      <div className="small" style={{ color: "var(--ink-2)" }}>
        {sg.hasIcal || sg.hasApi ? (
          <>
            Connected via {[sg.hasApi && "API", sg.hasIcal && "calendar feed"].filter(Boolean).join(" + ")}
            {sg.lastSynced ? ` · synced ${ago(sg.lastSynced)}` : ""}
          </>
        ) : (
          "Not connected. Use either method below (or both)."
        )}
      </div>
      {sg.lastError && <div className="error" style={{ marginTop: 8 }}>{sg.lastError}</div>}

      <div className="form" style={{ marginTop: 12 }}>
        <Field label="Calendar feed link" hint={sg.hasIcal ? "saved" : "easiest"}>
          <div className="kbd-add">
            <input className="input" placeholder={sg.hasIcal ? "•••••• (paste to replace)" : "webcal://…schoology.com/calendar/feed/…"} value={ical} onChange={(e) => setIcal(e.target.value)} />
            <button type="button" className="btn" disabled={!ical} onClick={() => save({ icalUrl: ical }, () => setIcal(""))}>
              Save
            </button>
          </div>
        </Field>
        <Help summary="How to get the Schoology calendar link">
          <ol>
            <li>Open Schoology in a browser and go to <strong>Calendar</strong>.</li>
            <li>Click the <strong>iCal</strong> / <strong>Export</strong> button (bottom or top right of the calendar).</li>
            <li>Copy the link it shows and paste it above.</li>
          </ol>
        </Help>
        <div className="divider" />
        <div className="grid-2">
          <Field label="API key" hint={sg.hasApi ? "saved" : "optional"}>
            <input className="input" value={key} onChange={(e) => setKey(e.target.value)} placeholder={sg.hasApi ? "••••••" : "Consumer key"} />
          </Field>
          <Field label="API secret">
            <input className="input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={sg.hasApi ? "••••••" : "Consumer secret"} />
          </Field>
        </div>
        <button
          type="button"
          className="btn block"
          disabled={!key || !secret}
          onClick={() =>
            save({ consumerKey: key, consumerSecret: secret }, () => {
              setKey("");
              setSecret("");
              toast("API key saved");
            })
          }
        >
          Save API key
        </button>
        <Help summary="How to get Schoology API keys (adds class names)">
          <ol>
            <li>Sign in to your school's Schoology site in a browser.</li>
            <li>
              Go to <strong>yourschool.schoology.com/api</strong> (replace with your school's address).
            </li>
            <li>Copy the <strong>Current Key</strong> and <strong>Current Secret</strong> into the boxes above.</li>
          </ol>
          <p className="small muted">Some schools turn this page off. The calendar link works either way.</p>
        </Help>
        <div className="setting-row">
          <div>
            <strong>Auto-approve Schoology work</strong>
            <div className="small muted">Off = new assignments wait in Approvals</div>
          </div>
          <Switch checked={sg.autoApprove} onChange={(v) => save({ autoApprove: v })} label="Auto-approve Schoology" />
        </div>
        <div className="btn-row">
          <button type="button" className="btn primary" disabled={busy || !(sg.hasIcal || sg.hasApi)} onClick={sync}>
            <Icon name="refresh" size={17} /> {busy ? "Syncing…" : "Sync now"}
          </button>
          {(sg.hasIcal || sg.hasApi) && (
            <button
              type="button"
              className="btn danger"
              onClick={() => confirm("Disconnect Schoology?") && save({ icalUrl: "", consumerKey: "", consumerSecret: "" })}
            >
              Disconnect
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ---------- Email ---------- */

type Account = { id: number; label: string; host: string; username: string; enabled: number; last_checked: string | null; last_error: string | null };
type Rule = { id: number; field: string; pattern: string; label: string | null; enabled: number };

const RULE_TYPES: { value: string; label: string; placeholder: string }[] = [
  { value: "from", label: "From (person or domain)", placeholder: "coach@, @myschool.org, Mom" },
  { value: "subject", label: "Subject contains", placeholder: "test, due, schedule change" },
  { value: "any", label: "Anywhere contains", placeholder: "scholarship, interview" },
  { value: "body", label: "Body contains", placeholder: "deadline" },
  { value: "gmail_important", label: "Gmail marked it important", placeholder: "" },
  { value: "block", label: "Never alert me from", placeholder: "noreply@, newsletter" },
];

function EmailCard() {
  const accounts = useApi<Account[]>("/email/accounts");
  const rules = useApi<Rule[]>("/email/rules");
  const [provider, setProvider] = useState("gmail");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ruleType, setRuleType] = useState("from");
  const [pattern, setPattern] = useState("");

  const addAccount = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/email/accounts", { provider, username, password, host: provider === "other" ? host : undefined, label: username });
      toast("Email connected");
      setUsername("");
      setPassword("");
      accounts.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const removeAccount = async (a: Account) => {
    if (!confirm(`Disconnect ${a.label}?`)) return;
    await api.del(`/email/accounts/${a.id}`);
    accounts.reload();
  };

  const addRule = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/email/rules", { field: ruleType, pattern: ruleType === "gmail_important" ? "*" : pattern });
      setPattern("");
      rules.reload();
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  const removeRule = async (r: Rule) => {
    await api.del(`/email/rules/${r.id}`);
    rules.reload();
  };

  const ruleLabel = (f: string) => RULE_TYPES.find((t) => t.value === f)?.label ?? f;
  const current = RULE_TYPES.find((t) => t.value === ruleType)!;

  return (
    <Card title="Email" eyebrow="Important-email alerts">
      <div id="email" />
      {accounts.data?.map((a) => (
        <div key={a.id} style={{ padding: "8px 0", borderTop: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="mail" size={18} />
            <strong style={{ flex: 1, overflowWrap: "anywhere" }}>{a.label}</strong>
            <button className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Disconnect" onClick={() => removeAccount(a)}>
              <Icon name="trash" size={16} />
            </button>
          </div>
          <div className="small muted">{a.last_checked ? `Checked ${ago(a.last_checked)}` : "Waiting for first check"}</div>
          {a.last_error && <div className="error" style={{ marginTop: 6 }}>{a.last_error}</div>}
        </div>
      ))}

      <form className="form" onSubmit={addAccount} style={{ marginTop: 10 }}>
        <div className="grid-2">
          <select className="input" value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="Provider">
            <option value="gmail">Gmail</option>
            <option value="outlook">Outlook / school 365</option>
            <option value="icloud">iCloud</option>
            <option value="yahoo">Yahoo</option>
            <option value="other">Other (IMAP)</option>
          </select>
          <input className="input" type="email" autoComplete="off" placeholder="you@gmail.com" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        {provider === "other" && <input className="input" placeholder="IMAP server (e.g. imap.example.com)" value={host} onChange={(e) => setHost(e.target.value)} />}
        <input className="input" type="password" autoComplete="off" placeholder="App password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <ErrorBox error={error} />
        <button className="btn primary block" disabled={!username || !password || busy}>
          {busy ? "Connecting…" : "Connect email"}
        </button>
        <Help summary="Getting a Gmail app password">
          <ol>
            <li>Turn on 2-Step Verification for your Google account (myaccount.google.com → Security).</li>
            <li>
              Go to <strong>myaccount.google.com/apppasswords</strong>, name it “Limitless”, and create it.
            </li>
            <li>Paste the 16-letter password above. Limitless only reads mail; it never sends or deletes.</li>
          </ol>
          <p className="small muted">iCloud: appleid.apple.com → App-Specific Passwords. Yahoo: Account Security → Generate app password.</p>
        </Help>
      </form>

      <div className="divider" style={{ margin: "16px 0 10px" }} />
      <strong>What counts as important</strong>
      <p className="small muted" style={{ margin: "2px 0 8px" }}>
        You get a notification when a new email matches any rule. “Never alert me” rules always win.
      </p>
      {rules.data?.map((r) => (
        <div key={r.id} className="setting-row">
          <div style={{ minWidth: 0 }}>
            <div className="small muted">{ruleLabel(r.field)}</div>
            <strong style={{ overflowWrap: "anywhere" }}>{r.field === "gmail_important" ? "Gmail's Important label" : r.pattern}</strong>
          </div>
          <button className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Delete rule" onClick={() => removeRule(r)}>
            <Icon name="x" size={16} />
          </button>
        </div>
      ))}
      <form className="form" onSubmit={addRule} style={{ marginTop: 8 }}>
        <select className="input" value={ruleType} onChange={(e) => setRuleType(e.target.value)} aria-label="Rule type">
          {RULE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {ruleType !== "gmail_important" && (
          <input className="input" placeholder={current.placeholder} value={pattern} onChange={(e) => setPattern(e.target.value)} />
        )}
        <button className="btn block" disabled={ruleType !== "gmail_important" && !pattern}>
          <Icon name="plus" size={17} /> Add rule
        </button>
        <p className="tiny muted" style={{ margin: 0 }}>Separate several words with commas. Matching ignores upper/lower case.</p>
      </form>
    </Card>
  );
}

type Ai = { enabled: boolean; criteria: string; suggestEvents: boolean; hasKey: boolean; envKey: boolean };

function AiCard() {
  const { data, setData } = useApi<Ai>("/email/ai");
  const [criteria, setCriteria] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [test, setTest] = useState({ fromName: "", subject: "", text: "" });
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!data) return null;
  const save = async (patch: Record<string, unknown>) => {
    setData(await api.put<Ai>("/email/ai", patch));
  };

  const runTest = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await api.post<{ important: boolean; reason: string; summary: string; event: { title: string; date: string } | null }>("/email/ai/test", test);
      setResult(`${r.important ? "✅ Important" : "⏭️ Not important"} — ${r.reason}. ${r.summary}${r.event ? ` 📅 Would suggest: ${r.event.title} on ${r.event.date}` : ""}`);
    } catch (err) {
      setResult(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const hasKey = data.hasKey || data.envKey;
  return (
    <Card title="AI screening" eyebrow="Optional · uses Claude">
      <p className="small" style={{ margin: "0 0 8px", color: "var(--ink-2)" }}>
        Describe what matters in plain words. Claude reads new emails your rules didn't catch and flags the ones that fit. It also spots dates (tests, practices) and suggests them for your calendar, which you approve first.
      </p>
      <div className="setting-row">
        <strong>Use AI screening</strong>
        <Switch checked={data.enabled} onChange={(v) => save({ enabled: v })} label="Use AI screening" />
      </div>
      <div className="form" style={{ marginTop: 8 }}>
        {!data.envKey && (
          <Field label="Anthropic API key" hint={data.hasKey ? "saved" : "from console.anthropic.com"}>
            <div className="kbd-add">
              <input className="input" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={data.hasKey ? "••••••" : "sk-ant-…"} />
              <button
                className="btn"
                disabled={!key}
                onClick={async () => {
                  await save({ apiKey: key });
                  setKey("");
                  toast("Key saved");
                }}
              >
                Save
              </button>
            </div>
          </Field>
        )}
        <Field label="What's important to me">
          <textarea className="input" rows={5} value={criteria ?? data.criteria} onChange={(e) => setCriteria(e.target.value)} />
        </Field>
        {criteria !== null && criteria !== data.criteria && (
          <button
            className="btn primary block"
            onClick={async () => {
              await save({ criteria });
              setCriteria(null);
              toast("Saved");
            }}
          >
            Save description
          </button>
        )}
        <div className="setting-row">
          <span className="small">Suggest calendar events from emails</span>
          <Switch checked={data.suggestEvents} onChange={(v) => save({ suggestEvents: v })} label="Suggest events" />
        </div>
        {hasKey && (
          <Help summary="Try it on a sample email">
            <div className="form" style={{ marginTop: 8 }}>
              <input className="input" placeholder="From (name)" value={test.fromName} onChange={(e) => setTest({ ...test, fromName: e.target.value })} />
              <input className="input" placeholder="Subject" value={test.subject} onChange={(e) => setTest({ ...test, subject: e.target.value })} />
              <textarea className="input" placeholder="Email text" value={test.text} onChange={(e) => setTest({ ...test, text: e.target.value })} />
              <button className="btn" onClick={runTest} disabled={busy || !test.subject}>
                {busy ? "Checking…" : "Check"}
              </button>
              {result && <div className="notice">{result}</div>}
            </div>
          </Help>
        )}
      </div>
    </Card>
  );
}

export function SettingsPage() {
  const { data, error, reload } = useApi<Settings>("/settings");

  useEffect(() => {
    if (data && location.hash) document.querySelector(location.hash)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [data]);

  const logout = async () => {
    await api.post("/auth/logout");
    location.href = "/";
  };

  return (
    <>
      <TopBar title="Settings" back />
      <div className="page">
        <ErrorBox error={error} />
        {!data ? (
          <Spinner />
        ) : (
          <>
            <NotificationsCard s={data} />
            <ProfileCard s={data} onSaved={reload} />
            <RemindersCard s={data} onSaved={reload} />
            <CalendarsCard />
            <SchoologyCard s={data} onSaved={reload} />
            <EmailCard />
            <AiCard />
            <Card title="Your data">
              <div className="btn-row">
                <a className="btn" href="/api/export" download>
                  <Icon name="download" size={17} /> Back up
                </a>
                <button className="btn danger" onClick={logout}>
                  <Icon name="logout" size={17} /> Sign out
                </button>
              </div>
            </Card>
          </>
        )}
      </div>
    </>
  );
}

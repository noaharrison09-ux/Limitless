import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { DateTime } from "luxon";
import { all, get, run, tx } from "../db.ts";
import { decrypt } from "../crypto.ts";
import { load } from "../settings.ts";
import { zone } from "../time.ts";
import { aiAvailable, screenWithAi, type ScreeningResult } from "./ai.ts";
import {
  appointmentFromAi,
  appointmentFromText,
  appointmentSignals,
  appointmentsFromInvites,
  type FoundAppointment,
} from "./appointments.ts";
import { notify } from "./push.ts";

export type RuleField = "from" | "subject" | "body" | "any" | "gmail_important" | "block";

export type Rule = { id: number; field: RuleField; pattern: string; label: string | null; enabled: number };

export type IncomingEmail = {
  fromName: string;
  fromAddr: string;
  subject: string;
  text: string;
  labels: string[];
  bulk: boolean;
};

export type RuleVerdict = { important: boolean; blocked: boolean; reason: string | null };

function terms(pattern: string): string[] {
  return pattern
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

/** Applies your rules. Block rules always win; otherwise the first matching rule marks the email important. */
export function applyRules(email: IncomingEmail, rules: Rule[]): RuleVerdict {
  const from = `${email.fromName} <${email.fromAddr}>`.toLowerCase();
  const subject = email.subject.toLowerCase();
  const body = email.text.toLowerCase();
  const active = rules.filter((r) => r.enabled);

  for (const r of active.filter((r) => r.field === "block")) {
    if (terms(r.pattern).some((t) => from.includes(t))) return { important: false, blocked: true, reason: null };
  }
  for (const r of active) {
    const name = r.label || r.pattern;
    const hit = (hay: string) => terms(r.pattern).find((t) => hay.includes(t));
    switch (r.field) {
      case "from":
        if (hit(from)) return { important: true, blocked: false, reason: `From: ${name}` };
        break;
      case "subject":
        if (hit(subject)) return { important: true, blocked: false, reason: `Subject: ${name}` };
        break;
      case "body":
        if (hit(body)) return { important: true, blocked: false, reason: `Mentions: ${name}` };
        break;
      case "any": {
        const t = hit(from) ?? hit(subject) ?? hit(body);
        if (t) return { important: true, blocked: false, reason: `Keyword: ${name}` };
        break;
      }
      case "gmail_important":
        if (email.labels.includes("\\Important")) return { important: true, blocked: false, reason: "Gmail marked important" };
        break;
    }
  }
  return { important: false, blocked: false, reason: null };
}

type Account = {
  id: number;
  label: string;
  host: string;
  port: number;
  secure: number;
  username: string;
  password_enc: string;
  mailbox: string;
  enabled: number;
  last_uid: number | null;
  uid_validity: string | null;
};

export function imapClient(a: Pick<Account, "host" | "port" | "secure" | "username">, password: string) {
  return new ImapFlow({
    host: a.host,
    port: a.port,
    secure: !!a.secure,
    auth: { user: a.username, pass: password },
    logger: false,
    socketTimeout: 60_000,
  });
}

/** Opens a connection and logs in, to check credentials before saving an account. */
export async function testConnection(a: Pick<Account, "host" | "port" | "secure" | "username" | "mailbox">, password: string) {
  const client = imapClient(a, password);
  await client.connect();
  try {
    const lock = await client.getMailboxLock(a.mailbox || "INBOX", { readOnly: true });
    lock.release();
  } finally {
    await client.logout().catch(() => {});
  }
}

const MAX_PER_POLL = 40;
const SOURCE_BYTES = 256 * 1024;

function snippet(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 280);
}

function when(a: FoundAppointment): string {
  const d = DateTime.fromISO(a.start).setZone(zone());
  return a.allDay ? d.toFormat("ccc, LLL d") : d.toFormat("ccc, LLL d · h:mm a");
}

/**
 * Saves appointments found in an email as calendar events (pending approval unless you
 * auto-approve). Invite updates replace the earlier version; repeats of the same
 * appointment from the same sender (confirmation, then reminder) are skipped.
 */
function saveAppointments(emailId: number, fromAddr: string, found: FoundAppointment[], autoApprove: boolean): FoundAppointment[] {
  const saved: FoundAppointment[] = [];
  const status = autoApprove ? "approved" : "pending";
  tx(() => {
    const byUid = new Map<string, FoundAppointment[]>();
    for (const a of found) {
      if (a.uid) byUid.set(a.uid, [...(byUid.get(a.uid) ?? []), a]);
    }
    for (const [uid, list] of byUid) {
      const prior = get<{ status: string }>("SELECT status FROM events WHERE source = 'email' AND uid = ? LIMIT 1", uid);
      run("DELETE FROM events WHERE source = 'email' AND uid = ?", uid);
      for (const a of list) insertAppointment(emailId, a, prior?.status ?? status);
      if (!prior) saved.push(list[0]);
    }
    for (const a of found.filter((x) => !x.uid)) {
      const dup = get(
        `SELECT 1 FROM events e JOIN important_emails m ON m.id = e.email_id
         WHERE e.source = 'email' AND e.start = ? AND lower(m.from_addr) = lower(?)`,
        a.start,
        fromAddr,
      );
      if (dup) continue;
      insertAppointment(emailId, a, status);
      saved.push(a);
    }
  });
  return saved;
}

function insertAppointment(emailId: number, a: FoundAppointment, status: string) {
  run(
    `INSERT INTO events (source, status, email_id, uid, title, start, end, all_day, location)
     VALUES ('email', ?, ?, ?, ?, ?, ?, ?, ?)`,
    status,
    emailId,
    a.uid,
    a.title,
    a.start,
    a.end,
    a.allDay,
    a.location,
  );
}

/** Removes appointments whose invite was cancelled; returns their titles. */
function cancelAppointments(uids: string[]): string[] {
  const titles: string[] = [];
  for (const uid of uids) {
    const ev = get<{ title: string }>("SELECT title FROM events WHERE source = 'email' AND uid = ? LIMIT 1", uid);
    if (!ev) continue;
    run("DELETE FROM events WHERE source = 'email' AND uid = ?", uid);
    titles.push(ev.title);
  }
  return titles;
}

/** Reads one email: applies your rules, finds appointments, saves it, and notifies you. */
export async function processMessage(
  account: Pick<Account, "id">,
  raw: Buffer,
  labels: string[],
  internalDate: Date | null,
  rules: Rule[],
) {
  const parsed = await simpleParser(raw, { skipImageLinks: true, skipHtmlToText: false });
  const from = parsed.from?.value?.[0];
  const messageId = parsed.messageId ?? `${account.id}:${parsed.date?.toISOString() ?? ""}:${parsed.subject ?? ""}`;
  if (get("SELECT 1 FROM important_emails WHERE account_id = ? AND message_id = ?", account.id, messageId)) return;

  const email: IncomingEmail = {
    fromName: from?.name ?? "",
    fromAddr: from?.address ?? "",
    subject: parsed.subject ?? "(no subject)",
    text: (parsed.text ?? "").slice(0, 20000),
    labels,
    bulk: parsed.headers.has("list-unsubscribe") || /bulk|list/i.test(String(parsed.headers.get("precedence") ?? "")),
  };
  const received = parsed.date ?? internalDate ?? new Date();

  const verdict = applyRules(email, rules);
  if (verdict.blocked) return;

  const ai = load("ai");
  const appt = load("appointments");
  const signals = appointmentSignals(email.subject, email.text);
  let important = verdict.important;
  let reason = verdict.reason;
  let summary: string | null = null;
  let aiEvent: ScreeningResult["event"] = null;
  let aiAnswered = false;

  // AI looks at anything your rules didn't already flag (skipping mailing-list blasts to save cost,
  // unless the email clearly looks like an appointment).
  if (aiAvailable() && (important || !email.bulk || (appt.enabled && signals.strong))) {
    const result = await screenWithAi(email, ai.criteria);
    if (result) {
      aiAnswered = true;
      if (!important && result.important) {
        important = true;
        reason = `AI: ${result.reason}`;
      }
      summary = result.summary;
      aiEvent = result.event;
    }
  }

  // Appointments: a calendar invite is exact; otherwise the AI's reading; otherwise the date in the text.
  let found: FoundAppointment[] = [];
  let cancelled: string[] = [];
  if (appt.enabled) {
    const invites = appointmentsFromInvites(parsed.attachments ?? [], received, zone());
    cancelled = invites.cancelledUids;
    found = invites.found;
    if (!found.length && !cancelled.length) {
      // If the AI read the email, trust its answer; if it was off or failed, read the date ourselves.
      const one = aiAnswered ? appointmentFromAi(aiEvent, zone()) : appointmentFromText(email, received, zone());
      if (one) found = [one];
    }
  }

  if (!important && !found.length && !cancelled.length) return;

  const { lastId, changes } = run(
    `INSERT INTO important_emails (account_id, message_id, from_name, from_addr, subject, snippet, received_at, reason, summary, body, read)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    account.id,
    messageId,
    email.fromName,
    email.fromAddr,
    email.subject,
    snippet(email.text),
    received.toISOString(),
    reason ?? (cancelled.length ? "📅 Cancellation" : "📅 Appointment"),
    summary,
    email.text,
    important ? 0 : 1,
  );
  if (!changes) return;

  const removed = cancelAppointments(cancelled);
  const saved = found.length ? saveAppointments(lastId, email.fromAddr, found, appt.autoApprove) : [];
  const who = email.fromName || email.fromAddr;

  if (saved.length) {
    const a = saved[0];
    const more = saved.length > 1 ? ` (+${saved.length - 1} more)` : "";
    await notify({
      title: appt.autoApprove ? `📅 Added: ${a.title}` : `📅 Appointment: ${a.title}`,
      body: `${when(a)}${a.location ? ` · ${a.location}` : ""}${more} — ${appt.autoApprove ? `from ${who}` : "tap to review and add to your calendar"}`,
      url: appt.autoApprove ? "/calendar" : "/approvals",
      tag: `appointment-${lastId}`,
      dedupeKey: `appointment:${account.id}:${messageId}`,
    });
  } else if (removed.length) {
    await notify({
      title: `❌ Cancelled: ${removed[0]}`,
      body: `${who} cancelled it, so it's off your calendar.`,
      url: "/calendar",
      dedupeKey: `cancel:${account.id}:${messageId}`,
    });
  } else if (important) {
    await notify({
      title: `📬 ${who}`,
      body: `${email.subject}${summary ? ` — ${summary}` : ""}`,
      url: "/inbox",
      tag: `email-${lastId}`,
      dedupeKey: `email:${account.id}:${messageId}`,
    });
  }
}

async function pollAccount(account: Account, rules: Rule[]) {
  const client = imapClient(account, decrypt(account.password_enc));
  await client.connect();
  try {
    const lock = await client.getMailboxLock(account.mailbox || "INBOX", { readOnly: true });
    try {
      const mb = client.mailbox;
      if (!mb) throw new Error("Mailbox not open");
      const validity = String(mb.uidValidity);
      let lastUid = account.uid_validity === validity ? account.last_uid : null;

      if (lastUid === null) {
        // First connection: only look at the last day so we don't alert on your whole inbox.
        const recent = await client.search({ since: new Date(Date.now() - 86_400_000) }, { uid: true });
        const uids = (recent || []).slice(-15);
        lastUid = uids.length ? Math.min(...uids) - 1 : mb.uidNext - 1;
      }

      let maxUid = lastUid;
      let processed = 0;
      for await (const msg of client.fetch(
        `${lastUid + 1}:*`,
        { uid: true, labels: true, internalDate: true, source: { maxLength: SOURCE_BYTES } },
        { uid: true },
      )) {
        if (msg.uid <= lastUid) continue; // "N:*" always returns the newest message
        maxUid = Math.max(maxUid, msg.uid);
        if (processed++ >= MAX_PER_POLL || !msg.source) continue;
        try {
          const internal = msg.internalDate ? new Date(msg.internalDate) : null;
          await processMessage(account, msg.source, [...(msg.labels ?? [])], internal, rules);
        } catch (err) {
          console.error(`[email] ${account.label}: failed to process uid ${msg.uid}:`, err);
        }
      }
      run(
        "UPDATE email_accounts SET last_uid = ?, uid_validity = ?, last_checked = ?, last_error = NULL WHERE id = ?",
        maxUid,
        validity,
        new Date().toISOString(),
        account.id,
      );
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

let running: Promise<void> | null = null;

export function checkAllEmail(): Promise<void> {
  running ??= (async () => {
    const accounts = all<Account>("SELECT * FROM email_accounts WHERE enabled = 1");
    const rules = all<Rule>("SELECT * FROM email_rules");
    for (const account of accounts) {
      try {
        await pollAccount(account, rules);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[email] ${account.label}:`, msg);
        run("UPDATE email_accounts SET last_error = ?, last_checked = ? WHERE id = ?", msg, new Date().toISOString(), account.id);
      }
    }
  })().finally(() => (running = null));
  return running;
}

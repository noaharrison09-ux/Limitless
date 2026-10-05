import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { DateTime } from "luxon";
import { all, get, run } from "../db.ts";
import { decrypt } from "../crypto.ts";
import { load } from "../settings.ts";
import { zone } from "../time.ts";
import { aiAvailable, screenWithAi, type ScreeningResult } from "./ai.ts";
import { announcePending } from "./approvals.ts";
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
const SOURCE_BYTES = 96 * 1024;

function snippet(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 280);
}

async function handleMessage(account: Account, raw: Buffer, labels: string[], internalDate: Date | null, rules: Rule[]) {
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

  const verdict = applyRules(email, rules);
  if (verdict.blocked) return;

  const ai = load("ai");
  let important = verdict.important;
  let reason = verdict.reason;
  let summary: string | null = null;
  let event: ScreeningResult["event"] = null;

  // AI looks at anything your rules didn't already flag (skipping mailing-list blasts to save cost),
  // and at rule matches too when it can pull out a calendar date.
  if (aiAvailable() && (important || !email.bulk)) {
    const result = await screenWithAi(email, ai.criteria);
    if (result) {
      if (!important && result.important) {
        important = true;
        reason = `AI: ${result.reason}`;
      }
      if (important) {
        summary = result.summary;
        event = result.event;
      }
    }
  }
  if (!important) return;

  const receivedAt = (parsed.date ?? internalDate ?? new Date()).toISOString();
  const { lastId, changes } = run(
    `INSERT INTO important_emails (account_id, message_id, from_name, from_addr, subject, snippet, received_at, reason, summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    account.id,
    messageId,
    email.fromName,
    email.fromAddr,
    email.subject,
    snippet(email.text),
    receivedAt,
    reason,
    summary,
  );
  if (!changes) return;

  await notify({
    title: `📬 ${email.fromName || email.fromAddr}`,
    body: `${email.subject}${summary ? ` — ${summary}` : ""}`,
    url: "/inbox",
    tag: `email-${lastId}`,
    dedupeKey: `email:${account.id}:${messageId}`,
  });

  if (event && ai.suggestEvents && /^\d{4}-\d{2}-\d{2}$/.test(event.date)) {
    suggestEventFromEmail(lastId, event);
    await announcePending("From email", [event.title]);
  }
}

function suggestEventFromEmail(emailId: number, ev: { title: string; date: string; time: string | null; location: string | null }) {
  const timed = ev.time && /^\d{2}:\d{2}$/.test(ev.time);
  const start = DateTime.fromISO(`${ev.date}T${timed ? ev.time : "00:00"}`, { zone: zone() });
  if (!start.isValid) return;
  run(
    `INSERT INTO events (source, status, email_id, title, start, end, all_day, location)
     VALUES ('email', 'pending', ?, ?, ?, ?, ?, ?)`,
    emailId,
    ev.title,
    start.toUTC().toISO(),
    timed ? start.plus({ hours: 1 }).toUTC().toISO() : start.plus({ days: 1 }).toUTC().toISO(),
    !timed,
    ev.location,
  );
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
          await handleMessage(account, msg.source, [...(msg.labels ?? [])], internal, rules);
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

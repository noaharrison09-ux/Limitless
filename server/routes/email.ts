import { Router } from "express";
import { all, get, run } from "../db.ts";
import { encrypt } from "../crypto.ts";
import { config } from "../config.ts";
import { load, patch, type AiSettings, type AppointmentSettings } from "../settings.ts";
import { checkAllEmail, testConnection, type RuleField } from "../services/email.ts";
import { aiApiKey, screenWithAi } from "../services/ai.ts";
import { HttpError, crudRouter, idParam, pick, updateRow } from "./crud.ts";

export const emailRouter = Router();

const PRESETS: Record<string, { host: string; port: number }> = {
  gmail: { host: "imap.gmail.com", port: 993 },
  outlook: { host: "outlook.office365.com", port: 993 },
  icloud: { host: "imap.mail.me.com", port: 993 },
  yahoo: { host: "imap.mail.yahoo.com", port: 993 },
};

function publicAccount(a: Record<string, unknown>) {
  const { password_enc: _hidden, ...rest } = a;
  return rest;
}

emailRouter.get("/accounts", (_req, res) => {
  res.json(all("SELECT * FROM email_accounts ORDER BY id").map(publicAccount));
});

emailRouter.post("/accounts", async (req, res) => {
  const b = req.body ?? {};
  const preset = PRESETS[String(b.provider ?? "")];
  const account = {
    label: String(b.label ?? "").trim() || String(b.username ?? "").trim(),
    host: String(b.host ?? preset?.host ?? "").trim(),
    port: Number(b.port ?? preset?.port ?? 993),
    secure: b.secure === false ? 0 : 1,
    username: String(b.username ?? "").trim(),
    mailbox: String(b.mailbox ?? "INBOX").trim() || "INBOX",
  };
  const password = String(b.password ?? "").replace(/\s+/g, "");
  if (!account.host || !account.username || !password) throw new HttpError(400, "Email address, app password, and server are required");
  try {
    await testConnection(account, password);
  } catch (err) {
    throw new HttpError(400, `Couldn't sign in: ${err instanceof Error ? err.message : err}. For Gmail, use an App Password (not your normal password).`);
  }
  const { lastId } = run(
    "INSERT INTO email_accounts (label, host, port, secure, username, password_enc, mailbox) VALUES (?, ?, ?, ?, ?, ?, ?)",
    account.label,
    account.host,
    account.port,
    account.secure,
    account.username,
    encrypt(password),
    account.mailbox,
  );
  res.status(201).json(publicAccount(get("SELECT * FROM email_accounts WHERE id = ?", lastId)!));
});

emailRouter.patch("/accounts/:id", (req, res) => {
  res.json(publicAccount(updateRow("email_accounts", idParam(req), pick(req.body, { label: "text", enabled: "bool", mailbox: "text" }))));
});

emailRouter.delete("/accounts/:id", (req, res) => {
  run("DELETE FROM email_accounts WHERE id = ?", idParam(req));
  res.json({ ok: true });
});

emailRouter.post("/check", async (_req, res) => {
  await checkAllEmail();
  res.json({ ok: true, accounts: all("SELECT id, label, last_checked, last_error FROM email_accounts") });
});

const FIELDS: RuleField[] = ["from", "subject", "body", "any", "gmail_important", "block"];

emailRouter.use("/rules", (req, _res, next) => {
  if ((req.method === "POST" || req.method === "PATCH") && req.body?.field && !FIELDS.includes(req.body.field)) {
    throw new HttpError(400, "Unknown rule type");
  }
  if (req.method === "POST" && req.body?.field === "gmail_important" && !req.body.pattern) req.body.pattern = "*";
  next();
});

emailRouter.use(
  "/rules",
  crudRouter({
    table: "email_rules",
    columns: { field: "text", pattern: "text", label: "text", enabled: "bool" },
    required: ["field", "pattern"],
    orderBy: "field = 'block', id",
  }),
);

emailRouter.get("/important", (req, res) => {
  const unreadOnly = req.query.filter === "unread";
  res.json(
    all(
      `SELECT m.id, m.account_id, m.message_id, m.from_name, m.from_addr, m.subject, m.snippet, m.received_at, m.reason,
              m.summary, m.read, a.label AS account_label, a.host AS account_host,
              (SELECT COUNT(*) FROM events e WHERE e.email_id = m.id) AS appointment_count
       FROM important_emails m
       LEFT JOIN email_accounts a ON a.id = m.account_id
       ${unreadOnly ? "WHERE m.read = 0" : ""}
       ORDER BY m.received_at DESC LIMIT 200`,
    ),
  );
});

/** The full email, for reading it in the app. */
emailRouter.get("/important/:id", (req, res) => {
  const row = get(
    `SELECT m.*, a.label AS account_label, a.host AS account_host FROM important_emails m
     LEFT JOIN email_accounts a ON a.id = m.account_id WHERE m.id = ?`,
    idParam(req),
  );
  if (!row) throw new HttpError(404, "Not found");
  res.json(row);
});

emailRouter.patch("/important/:id", (req, res) => {
  res.json(updateRow("important_emails", idParam(req), pick(req.body, { read: "bool" })));
});

emailRouter.post("/important/read-all", (_req, res) => {
  run("UPDATE important_emails SET read = 1 WHERE read = 0");
  res.json({ ok: true });
});

emailRouter.delete("/important/:id", (req, res) => {
  run("DELETE FROM important_emails WHERE id = ?", idParam(req));
  res.json({ ok: true });
});

/* ---------- Appointments ---------- */

emailRouter.get("/appointments", (_req, res) => {
  res.json(load("appointments"));
});

emailRouter.put("/appointments", (req, res) => {
  const next: Partial<AppointmentSettings> = {};
  if (typeof req.body?.enabled === "boolean") next.enabled = req.body.enabled;
  if (typeof req.body?.autoApprove === "boolean") next.autoApprove = req.body.autoApprove;
  res.json(patch("appointments", next));
});

/* ---------- AI screening ---------- */

function publicAi() {
  const ai = load("ai");
  return {
    enabled: ai.enabled,
    criteria: ai.criteria,
    hasKey: !!ai.apiKeyEnc,
    envKey: !!config.anthropicApiKey,
  };
}

emailRouter.get("/ai", (_req, res) => {
  res.json(publicAi());
});

emailRouter.put("/ai", (req, res) => {
  const b = req.body ?? {};
  const next: Partial<AiSettings> = {};
  if (typeof b.enabled === "boolean") next.enabled = b.enabled;
  if (typeof b.criteria === "string") next.criteria = b.criteria.trim().slice(0, 4000);
  if (typeof b.apiKey === "string") next.apiKeyEnc = b.apiKey.trim() ? encrypt(b.apiKey.trim()) : null;
  patch("ai", next);
  res.json(publicAi());
});

emailRouter.post("/ai/test", async (req, res) => {
  if (!aiApiKey()) throw new HttpError(400, "Add an Anthropic API key first");
  const b = req.body ?? {};
  const result = await screenWithAi(
    {
      fromName: String(b.fromName ?? ""),
      fromAddr: String(b.fromAddr ?? "someone@example.com"),
      subject: String(b.subject ?? ""),
      text: String(b.text ?? ""),
    },
    load("ai").criteria,
  );
  if (!result) throw new HttpError(502, "The AI check failed. Check the API key and try again.");
  res.json(result);
});

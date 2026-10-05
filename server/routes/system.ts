import { Router } from "express";
import { all, get, run } from "../db.ts";
import { encrypt } from "../crypto.ts";
import { load, patch, type Prefs, type ReminderSettings } from "../settings.ts";
import { isValidZone } from "../time.ts";
import { notify, rememberOrigin, removeSubscription, saveSubscription, vapidPublicKey } from "../services/push.ts";
import { syncSchoology } from "../services/schoology.ts";
import { approveAll, decideEvent, decideHomework, listPending, pendingCount } from "../services/approvals.ts";
import { HttpError, idParam } from "./crud.ts";

export const systemRouter = Router();

function publicSchoology() {
  const s = load("schoology");
  return {
    hasIcal: !!s.icalUrlEnc,
    hasApi: !!(s.consumerKeyEnc && s.consumerSecretEnc),
    autoApprove: s.autoApprove,
    lastSynced: s.lastSynced,
    lastError: s.lastError,
    lastImported: s.lastImported,
  };
}

systemRouter.get("/settings", (_req, res) => {
  res.json({
    prefs: load("prefs"),
    reminders: load("reminders"),
    bulk: load("bulk"),
    schoology: publicSchoology(),
    push: {
      publicKey: vapidPublicKey(),
      devices: get<{ n: number }>("SELECT COUNT(*) AS n FROM push_subscriptions")!.n,
    },
  });
});

systemRouter.put("/settings/prefs", (req, res) => {
  const b = req.body ?? {};
  const next: Partial<Prefs> = {};
  if (typeof b.name === "string") next.name = b.name.trim().slice(0, 60);
  if (b.units === "lb" || b.units === "kg") next.units = b.units;
  if (typeof b.timezone === "string") {
    if (!isValidZone(b.timezone)) throw new HttpError(400, "Unknown timezone");
    next.timezone = b.timezone;
    next.timezoneConfirmed = true;
  }
  res.json(patch("prefs", next));
});

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

systemRouter.put("/settings/reminders", (req, res) => {
  const current = load("reminders");
  const b = (req.body ?? {}) as Partial<Record<keyof ReminderSettings, Record<string, unknown>>>;
  const next = structuredClone(current);
  for (const key of ["morningBriefing", "weighIn", "homeworkEvening", "journal"] as const) {
    const v = b[key];
    if (!v) continue;
    if (typeof v.enabled === "boolean") next[key].enabled = v.enabled;
    if (typeof v.time === "string") {
      if (!HHMM.test(v.time)) throw new HttpError(400, "Times must be HH:MM");
      next[key].time = v.time;
    }
  }
  if (b.homeworkDueSoon) {
    if (typeof b.homeworkDueSoon.enabled === "boolean") next.homeworkDueSoon.enabled = b.homeworkDueSoon.enabled;
    const h = Number(b.homeworkDueSoon.hours);
    if (Number.isFinite(h) && h > 0 && h <= 48) next.homeworkDueSoon.hours = h;
  }
  if (b.events) {
    if (typeof b.events.enabled === "boolean") next.events.enabled = b.events.enabled;
    const m = Number(b.events.minutesBefore);
    if (Number.isFinite(m) && m > 0 && m <= 24 * 60) next.events.minutesBefore = Math.round(m);
  }
  res.json(patch("reminders", next));
});

/* ---------- Schoology ---------- */

systemRouter.put("/schoology", async (req, res) => {
  const b = req.body ?? {};
  if (typeof b.icalUrl === "string") {
    const url = b.icalUrl.trim();
    if (url && !/^(https?|webcals?):\/\//i.test(url)) throw new HttpError(400, "Paste the full iCal link (starts with webcal:// or https://)");
    patch("schoology", { icalUrlEnc: url ? encrypt(url) : null });
  }
  if (typeof b.consumerKey === "string" || typeof b.consumerSecret === "string") {
    const key = String(b.consumerKey ?? "").trim();
    const secret = String(b.consumerSecret ?? "").trim();
    patch("schoology", { consumerKeyEnc: key ? encrypt(key) : null, consumerSecretEnc: secret ? encrypt(secret) : null });
  }
  if (typeof b.autoApprove === "boolean") {
    patch("schoology", { autoApprove: b.autoApprove });
    if (b.autoApprove) approveAll({ kind: "homework" });
  }
  res.json(publicSchoology());
});

systemRouter.post("/schoology/sync", async (_req, res) => {
  try {
    const result = await syncSchoology();
    res.json({ ...result, status: publicSchoology() });
  } catch (err) {
    throw new HttpError(502, err instanceof Error ? err.message : String(err));
  }
});

/* ---------- Approvals ---------- */

systemRouter.get("/approvals", (_req, res) => {
  res.json(listPending());
});

systemRouter.post("/approvals/decide", (req, res) => {
  const { kind, id, decision } = req.body ?? {};
  if (decision !== "approved" && decision !== "declined") throw new HttpError(400, "decision must be approved or declined");
  const ok = kind === "homework" ? decideHomework(Number(id), decision) : decideEvent(Number(id), decision);
  if (!ok) throw new HttpError(404, "Not found");
  res.json(listPending());
});

systemRouter.post("/approvals/approve-all", (req, res) => {
  const feedId = Number(req.body?.feedId) || undefined;
  const kind = req.body?.kind === "events" || req.body?.kind === "homework" ? req.body.kind : undefined;
  approveAll({ feedId, kind });
  res.json(listPending());
});

/* ---------- Push notifications ---------- */

systemRouter.post("/push/subscribe", (req, res) => {
  const sub = req.body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw new HttpError(400, "Bad subscription");
  saveSubscription(sub, req.headers["user-agent"]);
  rememberOrigin(`${req.protocol}://${req.get("host")}`);
  res.json({ ok: true });
});

systemRouter.post("/push/unsubscribe", (req, res) => {
  if (typeof req.body?.endpoint === "string") removeSubscription(req.body.endpoint);
  res.json({ ok: true });
});

systemRouter.post("/push/test", async (_req, res) => {
  const result = await notify({ title: "✨ Limitless is connected", body: "Notifications are working on this device.", url: "/settings" });
  res.json(result);
});

systemRouter.get("/notifications", (_req, res) => {
  res.json({
    items: all("SELECT id, title, body, url, read, created_at FROM notifications ORDER BY id DESC LIMIT 50"),
    unread: get<{ n: number }>("SELECT COUNT(*) AS n FROM notifications WHERE read = 0")!.n,
    pendingApprovals: pendingCount(),
  });
});

systemRouter.post("/notifications/read-all", (_req, res) => {
  run("UPDATE notifications SET read = 1 WHERE read = 0");
  res.json({ ok: true });
});

systemRouter.delete("/notifications/:id", (req, res) => {
  run("DELETE FROM notifications WHERE id = ?", idParam(req));
  res.json({ ok: true });
});

/* ---------- Backup ---------- */

const EXPORT_TABLES = [
  "weights",
  "nutrition",
  "lifts",
  "measurements",
  "goals",
  "goal_steps",
  "journal_entries",
  "non_negotiables",
  "homework",
  "projects",
  "project_tasks",
  "notes",
  "events",
  "email_rules",
  "important_emails",
];

systemRouter.get("/export", (_req, res) => {
  const data: Record<string, unknown> = { exportedAt: new Date().toISOString(), bulk: load("bulk"), prefs: load("prefs") };
  for (const t of EXPORT_TABLES) data[t] = all(`SELECT * FROM ${t}`);
  res.setHeader("Content-Disposition", `attachment; filename="limitless-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(data);
});

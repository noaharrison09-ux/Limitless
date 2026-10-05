import { Router } from "../router.ts";
import { DATA_TABLES, all, get, run, tx } from "../db.ts";
import { load, patch, save, type Prefs, type ReminderSettings } from "../settings.ts";
import { isValidZone, todayStr } from "../time.ts";
import { eventIcs, homeworkIcs, importEvents, importHomework, remindersIcs } from "../calendarFiles.ts";
import { HttpError, idParam } from "./crud.ts";

export const systemRouter = Router();

systemRouter.get("/settings", (_req, res) => {
  res.json({ prefs: load("prefs"), reminders: load("reminders"), bulk: load("bulk") });
});

systemRouter.put("/settings/prefs", (req, res) => {
  const b = req.body ?? {};
  const next: Partial<Prefs> = {};
  if (typeof b.name === "string") next.name = b.name.trim().slice(0, 60);
  if (b.units === "lb" || b.units === "kg") next.units = b.units;
  if (typeof b.timezone === "string") {
    if (b.timezone && !isValidZone(b.timezone)) throw new HttpError(400, "Unknown timezone");
    next.timezone = b.timezone;
  }
  res.json(patch("prefs", next));
});

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

systemRouter.put("/settings/reminders", (req, res) => {
  const b = (req.body ?? {}) as Partial<Record<keyof ReminderSettings, Record<string, unknown>>>;
  const next = structuredClone(load("reminders"));
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
    if (Number.isFinite(m) && m >= 0 && m <= 24 * 60) next.events.minutesBefore = Math.round(m);
  }
  save("reminders", next);
  res.json(next);
});

/* ---------- Calendar files ---------- */

systemRouter.post("/import/ics", (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text : "";
  if (!text.includes("BEGIN:VCALENDAR")) throw new HttpError(400, "That file isn't a calendar (.ics) file.");
  try {
    res.json(req.body?.as === "homework" ? importHomework(text) : importEvents(text));
  } catch (err) {
    throw new HttpError(400, `Couldn't read that calendar file: ${err instanceof Error ? err.message : err}`);
  }
});

/** Daily reminders as a calendar file for your phone's Calendar app. */
systemRouter.get("/ics/reminders", (req, res) => {
  const reminders = load("reminders");
  res.json({ filename: "limitless-reminders.ics", text: remindersIcs(reminders, todayStr(), req.query.appUrl ?? "") });
});

systemRouter.get("/ics/homework/:id", (req, res) => {
  const h = get<Parameters<typeof homeworkIcs>[0]>("SELECT * FROM homework WHERE id = ?", idParam(req));
  if (!h) throw new HttpError(404, "Not found");
  if (!h.due_at) throw new HttpError(400, "Give it a due date first.");
  res.json({ filename: "limitless-homework.ics", text: homeworkIcs(h, load("reminders").homeworkDueSoon.hours) });
});

systemRouter.get("/ics/events/:id", (req, res) => {
  const e = get<Parameters<typeof eventIcs>[0]>("SELECT * FROM events WHERE id = ?", idParam(req));
  if (!e) throw new HttpError(404, "Not found");
  res.json({ filename: "limitless-event.ics", text: eventIcs(e, load("reminders").events.minutesBefore) });
});

/* ---------- Backup ---------- */

systemRouter.get("/export", (_req, res) => {
  const tables: Record<string, unknown[]> = {};
  for (const t of DATA_TABLES) tables[t] = all(`SELECT * FROM ${t}`);
  res.json({
    app: "limitless",
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: { prefs: load("prefs"), bulk: load("bulk"), reminders: load("reminders") },
    tables,
  });
});

/** Replaces everything on this device with a backup file's contents. */
systemRouter.post("/restore", (req, res) => {
  const data = req.body?.data;
  if (!data || typeof data !== "object") throw new HttpError(400, "That isn't a Limitless backup file.");
  // Older backups kept tables at the top level instead of under "tables".
  const tables: Record<string, unknown> = data.tables ?? data;
  if (!DATA_TABLES.some((t) => Array.isArray(tables[t]))) throw new HttpError(400, "That isn't a Limitless backup file.");

  const counts: Record<string, number> = {};
  tx(() => {
    for (const t of [...DATA_TABLES].reverse()) run(`DELETE FROM ${t}`);
    for (const t of DATA_TABLES) {
      const rows = Array.isArray(tables[t]) ? (tables[t] as Record<string, unknown>[]) : [];
      const columns = new Set(all<{ name: string }>(`PRAGMA table_info(${t})`).map((c) => c.name));
      counts[t] = 0;
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const cols = Object.keys(row).filter((c) => columns.has(c));
        if (!cols.length) continue;
        run(`INSERT INTO ${t} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, ...cols.map((c) => row[c]));
        counts[t]++;
      }
    }
    const settings = data.settings ?? { prefs: data.prefs, bulk: data.bulk };
    if (settings?.prefs) save("prefs", { ...load("prefs"), ...settings.prefs });
    if (settings?.bulk) save("bulk", { ...load("bulk"), ...settings.bulk });
    if (settings?.reminders) save("reminders", { ...load("reminders"), ...settings.reminders });
  });
  res.json({ ok: true, counts });
});

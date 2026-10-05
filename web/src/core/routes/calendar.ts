import { Router } from "../router.ts";
import { all, get, run } from "../db.ts";
import { localToUtcIso } from "../time.ts";
import { HttpError, coerce, idParam, insertRow, pick, updateRow } from "./crud.ts";

export const calendarRouter = Router();

/** Events in [from, to) plus open homework due in that range, merged for the agenda. */
calendarRouter.get("/events", (req, res) => {
  const from = coerce("from", "datetime", req.query.from) as string | null;
  const to = coerce("to", "datetime", req.query.to) as string | null;
  if (!from || !to) throw new HttpError(400, "from and to are required");
  const events = all(
    `SELECT *, NULL AS color, CASE source WHEN 'import' THEN 'Imported' WHEN 'sync' THEN 'Synced' ELSE NULL END AS feed_name
     FROM events WHERE COALESCE("end", start) >= ? AND start < ? ORDER BY start`,
    from,
    to,
  );
  const homework = all(
    `SELECT id, title, course, due_at, all_day, status FROM homework
     WHERE hidden = 0 AND due_at >= ? AND due_at < ? ORDER BY due_at`,
    from,
    to,
  );
  res.json({ events, homework });
});

function eventValues(body: Record<string, unknown>) {
  const values = pick(body, { title: "text", location: "text", description: "text" });
  if ("date" in body) {
    const date = coerce("date", "date", body.date) as string;
    if (!date) throw new HttpError(400, "date is required");
    const start = typeof body.start_time === "string" && /^\d{2}:\d{2}$/.test(body.start_time) ? body.start_time : null;
    const end = typeof body.end_time === "string" && /^\d{2}:\d{2}$/.test(body.end_time) ? body.end_time : null;
    values.all_day = start ? 0 : 1;
    values.start = localToUtcIso(date, start ?? "00:00");
    values.end = start ? (end ? localToUtcIso(date, end) : null) : null;
  }
  return values;
}

calendarRouter.post("/events", (req, res) => {
  const values = eventValues(req.body ?? {});
  if (!values.title || !values.start) throw new HttpError(400, "title and date are required");
  res.status(201).json(insertRow("events", { ...values, source: "local" }));
});

calendarRouter.get("/events/:id", (req, res) => {
  const ev = get("SELECT * FROM events WHERE id = ?", idParam(req));
  if (!ev) throw new HttpError(404, "Not found");
  res.json(ev);
});

/** Synced events are a copy of your calendar; changes here would be undone by the next sync. */
function assertEditable(id: number) {
  if (get<{ source: string }>("SELECT source FROM events WHERE id = ?", id)?.source === "sync")
    throw new HttpError(400, "This event comes from your synced calendar. Change it in Apple Calendar.");
}

calendarRouter.patch("/events/:id", (req, res) => {
  assertEditable(idParam(req));
  res.json(updateRow("events", idParam(req), eventValues(req.body ?? {})));
});

calendarRouter.delete("/events/:id", (req, res) => {
  assertEditable(idParam(req));
  run("DELETE FROM events WHERE id = ?", idParam(req));
  res.json({ ok: true });
});

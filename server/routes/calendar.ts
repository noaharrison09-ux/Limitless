import { Router } from "express";
import { all, get, run } from "../db.ts";
import { encrypt } from "../crypto.ts";
import { localToUtcIso } from "../time.ts";
import { syncFeed, type FeedRow } from "../services/calendarSync.ts";
import { approveAll } from "../services/approvals.ts";
import { HttpError, coerce, idParam, insertRow, pick, updateRow } from "./crud.ts";

export const calendarRouter = Router();

const PALETTE = ["#8b5a2b", "#5f7a4a", "#3f6d8c", "#a0522d", "#7a5c99", "#b5853a"];

function publicFeed(f: FeedRow) {
  const { url_enc: _hidden, ...rest } = f;
  return rest;
}

/** Approved events in [from, to) plus open homework due in that range, merged for the agenda. */
calendarRouter.get("/events", (req, res) => {
  const from = coerce("from", "datetime", req.query.from) as string | null;
  const to = coerce("to", "datetime", req.query.to) as string | null;
  if (!from || !to) throw new HttpError(400, "from and to are required");
  const events = all(
    `SELECT e.*, f.name AS feed_name, f.color AS color
     FROM events e LEFT JOIN calendar_feeds f ON f.id = e.feed_id
     WHERE e.status = 'approved' AND COALESCE(e.end, e.start) >= ? AND e.start < ?
     ORDER BY e.start`,
    from,
    to,
  );
  const homework = all(
    `SELECT id, title, course, due_at, all_day, status FROM homework
     WHERE approval = 'approved' AND hidden = 0 AND due_at >= ? AND due_at < ? ORDER BY due_at`,
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
  res.status(201).json(insertRow("events", { ...values, source: "local", status: "approved" }));
});

calendarRouter.patch("/events/:id", (req, res) => {
  const id = idParam(req);
  const ev = get<{ source: string }>("SELECT source FROM events WHERE id = ?", id);
  if (!ev) throw new HttpError(404, "Not found");
  if (ev.source === "feed") throw new HttpError(400, "Events from a linked calendar are edited in that calendar");
  res.json(updateRow("events", id, eventValues(req.body ?? {})));
});

calendarRouter.delete("/events/:id", (req, res) => {
  const id = idParam(req);
  const ev = get<{ source: string }>("SELECT source FROM events WHERE id = ?", id);
  if (ev?.source === "feed") throw new HttpError(400, "Remove it from the linked calendar, or decline it");
  run("DELETE FROM events WHERE id = ?", id);
  res.json({ ok: true });
});

/* ---------- Linked calendars (iCal feeds) ---------- */

calendarRouter.get("/feeds", (_req, res) => {
  res.json(
    all<FeedRow & { event_count: number; pending_count: number }>(`
      SELECT f.*,
        (SELECT COUNT(*) FROM events e WHERE e.feed_id = f.id AND e.status = 'approved') AS event_count,
        (SELECT COUNT(DISTINCT uid) FROM events e WHERE e.feed_id = f.id AND e.status = 'pending') AS pending_count
      FROM calendar_feeds f ORDER BY f.id`).map(publicFeed),
  );
});

calendarRouter.post("/feeds", async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const url = String(req.body?.url ?? "").trim();
  if (!name || !/^(https?|webcals?):\/\//i.test(url)) throw new HttpError(400, "A name and an https:// or webcal:// link are required");
  const count = get<{ n: number }>("SELECT COUNT(*) AS n FROM calendar_feeds")!.n;
  const row = insertRow("calendar_feeds", {
    name,
    url_enc: encrypt(url),
    color: typeof req.body?.color === "string" ? req.body.color : PALETTE[count % PALETTE.length],
    auto_approve: req.body?.auto_approve ? 1 : 0,
  }) as unknown as FeedRow;
  try {
    const result = await syncFeed(row);
    res.status(201).json({ feed: publicFeed(get<FeedRow>("SELECT * FROM calendar_feeds WHERE id = ?", row.id)!), ...result });
  } catch (err) {
    run("DELETE FROM calendar_feeds WHERE id = ?", row.id);
    throw new HttpError(400, `Couldn't read that calendar: ${err instanceof Error ? err.message : err}`);
  }
});

calendarRouter.patch("/feeds/:id", (req, res) => {
  const id = idParam(req);
  const values = pick(req.body, { name: "text", color: "text", enabled: "bool", auto_approve: "bool" });
  const row = updateRow("calendar_feeds", id, values) as unknown as FeedRow;
  if (values.auto_approve === 1) approveAll({ feedId: id });
  res.json(publicFeed(row));
});

calendarRouter.delete("/feeds/:id", (req, res) => {
  const id = idParam(req);
  run("DELETE FROM calendar_decisions WHERE key LIKE ?", `feed:${id}:%`);
  run("DELETE FROM calendar_feeds WHERE id = ?", id);
  res.json({ ok: true });
});

calendarRouter.post("/feeds/:id/sync", async (req, res) => {
  const feed = get<FeedRow>("SELECT * FROM calendar_feeds WHERE id = ?", idParam(req));
  if (!feed) throw new HttpError(404, "Not found");
  try {
    res.json(await syncFeed(feed));
  } catch (err) {
    throw new HttpError(502, err instanceof Error ? err.message : String(err));
  }
});

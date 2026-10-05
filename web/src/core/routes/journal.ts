import { Router } from "../router.ts";
import { DateTime } from "luxon";
import { all, get, run, tx } from "../db.ts";
import { addDays, todayStr } from "../time.ts";
import { HttpError, coerce, idParam, pick, updateRow } from "./crud.ts";

export const journalRouter = Router();

type NN = { id: number; for_date: string; text: string; done: number; position: number };

function dateParam(v: unknown): string {
  return coerce("date", "date", v) as string;
}

export function nonNegotiablesFor(date: string): NN[] {
  return all<NN>("SELECT * FROM non_negotiables WHERE for_date = ? ORDER BY position, id", date);
}

/** Consecutive days journaled, counting back from today (or yesterday if today isn't written yet). */
export function journalStreak(today: string): number {
  const dates = new Set(all<{ date: string }>("SELECT date FROM journal_entries").map((r) => r.date));
  let day = dates.has(today) ? today : DateTime.fromISO(today).minus({ days: 1 }).toISODate()!;
  let streak = 0;
  while (dates.has(day)) {
    streak++;
    day = DateTime.fromISO(day).minus({ days: 1 }).toISODate()!;
  }
  return streak;
}

journalRouter.get("/", (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 60) || 60, 365);
  const entries = all("SELECT * FROM journal_entries ORDER BY date DESC LIMIT ?", limit);
  const nn = all<{ for_date: string; total: number; done: number }>(
    "SELECT for_date, COUNT(*) AS total, SUM(done) AS done FROM non_negotiables GROUP BY for_date",
  );
  const byDate = new Map(nn.map((r) => [r.for_date, r]));
  res.json({
    streak: journalStreak(todayStr()),
    entries: entries.map((e) => ({ ...e, nonNegotiables: byDate.get(String(e.date)) ?? null })),
  });
});

journalRouter.get("/day/:date", (req, res) => {
  const date = dateParam(req.params.date);
  res.json({
    date,
    entry: get("SELECT * FROM journal_entries WHERE date = ?", date) ?? null,
    today: nonNegotiablesFor(date),
    tomorrow: nonNegotiablesFor(addDays(date, 1)),
  });
});

journalRouter.put("/day/:date", (req, res) => {
  const date = dateParam(req.params.date);
  const values = pick(req.body, { went_right: "text", went_wrong: "text", notes: "text", mood: "int" });
  const tomorrow: unknown = req.body?.tomorrow;
  tx(() => {
    const cols = Object.keys(values);
    run(
      `INSERT INTO journal_entries (date, ${[...cols, "updated_at"].join(", ")}) VALUES (?, ${[...cols, "u"].map(() => "?").join(", ")})
       ON CONFLICT(date) DO UPDATE SET ${[...cols, "updated_at"].map((c) => `${c} = excluded.${c}`).join(", ")}`,
      date,
      ...cols.map((c) => values[c]),
      new Date().toISOString(),
    );
    if (Array.isArray(tomorrow)) {
      const forDate = addDays(date, 1);
      const existing = nonNegotiablesFor(forDate);
      const doneByText = new Map(existing.map((n) => [n.text, n.done]));
      run("DELETE FROM non_negotiables WHERE for_date = ?", forDate);
      tomorrow
        .map((t) => String(t).trim())
        .filter(Boolean)
        .forEach((text, i) =>
          run(
            "INSERT INTO non_negotiables (for_date, text, done, position) VALUES (?, ?, ?, ?)",
            forDate,
            text,
            doneByText.get(text) ?? 0,
            i,
          ),
        );
    }
  });
  res.json({
    date,
    entry: get("SELECT * FROM journal_entries WHERE date = ?", date),
    today: nonNegotiablesFor(date),
    tomorrow: nonNegotiablesFor(addDays(date, 1)),
  });
});

journalRouter.delete("/day/:date", (req, res) => {
  run("DELETE FROM journal_entries WHERE date = ?", dateParam(req.params.date));
  res.json({ ok: true });
});

journalRouter.get("/non-negotiables", (req, res) => {
  res.json(nonNegotiablesFor(req.query.date ? dateParam(req.query.date) : todayStr()));
});

journalRouter.post("/non-negotiables", (req, res) => {
  const values = pick(req.body, { for_date: "date", text: "text" });
  if (!values.text) throw new HttpError(400, "text is required");
  const forDate = (values.for_date as string) ?? todayStr();
  const max = get<{ m: number | null }>("SELECT MAX(position) AS m FROM non_negotiables WHERE for_date = ?", forDate);
  run("INSERT INTO non_negotiables (for_date, text, position) VALUES (?, ?, ?)", forDate, values.text, (max?.m ?? -1) + 1);
  res.status(201).json(nonNegotiablesFor(forDate));
});

journalRouter.patch("/non-negotiables/:id", (req, res) => {
  res.json(updateRow("non_negotiables", idParam(req), pick(req.body, { text: "text", done: "bool" })));
});

journalRouter.delete("/non-negotiables/:id", (req, res) => {
  run("DELETE FROM non_negotiables WHERE id = ?", idParam(req));
  res.json({ ok: true });
});

import { Router } from "express";
import { all, get, run } from "../db.ts";
import { localToUtcIso } from "../time.ts";
import { HttpError, coerce, idParam, insertRow, pick, updateRow, type ColType } from "./crud.ts";

export const homeworkRouter = Router();

const COLUMNS: Record<string, ColType> = {
  title: "text",
  course: "text",
  status: "text",
  priority: "int",
  notes: "text",
  url: "text",
};

const STATUSES = new Set(["todo", "doing", "done"]);

/** Turns {due_date, due_time} from the form into a UTC instant + all-day flag. */
function dueFromBody(body: Record<string, unknown>): { due_at?: string | null; all_day?: number } {
  if (!("due_date" in body)) return {};
  const date = coerce("due_date", "date", body.due_date) as string | null;
  if (!date) return { due_at: null, all_day: 0 };
  const time = typeof body.due_time === "string" && /^\d{2}:\d{2}$/.test(body.due_time) ? body.due_time : null;
  return { due_at: localToUtcIso(date, time ?? "23:59"), all_day: time ? 0 : 1 };
}

function validate(values: Record<string, unknown>) {
  if (values.status !== undefined && !STATUSES.has(String(values.status))) throw new HttpError(400, "Bad status");
  if (values.status === "done") values.completed_at = new Date().toISOString();
  else if (values.status) values.completed_at = null;
}

homeworkRouter.get("/", (req, res) => {
  const filter = String(req.query.status ?? "open");
  const where =
    filter === "done" ? "status = 'done'" : filter === "all" ? "1 = 1" : "status != 'done'";
  const order = filter === "done" ? "completed_at DESC" : "due_at IS NULL, due_at, priority DESC, id";
  res.json(all(`SELECT * FROM homework WHERE hidden = 0 AND approval = 'approved' AND ${where} ORDER BY ${order} LIMIT 300`));
});

homeworkRouter.get("/courses", (_req, res) => {
  res.json(
    all<{ course: string }>("SELECT DISTINCT course FROM homework WHERE course IS NOT NULL AND course != '' ORDER BY course").map(
      (r) => r.course,
    ),
  );
});

homeworkRouter.post("/", (req, res) => {
  const values: Record<string, unknown> = { ...pick(req.body, COLUMNS), ...dueFromBody(req.body ?? {}) };
  if (!values.title) throw new HttpError(400, "title is required");
  validate(values);
  res.status(201).json(insertRow("homework", { ...values, source: "manual" }));
});

homeworkRouter.patch("/:id", (req, res) => {
  const values: Record<string, unknown> = { ...pick(req.body, COLUMNS), ...dueFromBody(req.body ?? {}) };
  validate(values);
  res.json(updateRow("homework", idParam(req), values));
});

homeworkRouter.delete("/:id", (req, res) => {
  const id = idParam(req);
  const row = get<{ source: string }>("SELECT source FROM homework WHERE id = ?", id);
  if (!row) throw new HttpError(404, "Not found");
  // Imported items are hidden rather than deleted so the next sync doesn't bring them back.
  if (row.source === "manual") run("DELETE FROM homework WHERE id = ?", id);
  else run("UPDATE homework SET hidden = 1 WHERE id = ?", id);
  res.json({ ok: true });
});

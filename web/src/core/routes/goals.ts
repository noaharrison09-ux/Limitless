import { Router } from "../router.ts";
import { all, get, run, type Row } from "../db.ts";
import { HttpError, idParam, insertRow, pick, updateRow, type ColType } from "./crud.ts";

export const goalsRouter = Router();

const GOAL_COLUMNS: Record<string, ColType> = {
  title: "text",
  description: "text",
  category: "text",
  target_date: "date",
  kind: "text",
  start_value: "real",
  current_value: "real",
  target_value: "real",
  unit: "text",
  status: "text",
};

type Step = { id: number; goal_id: number; title: string; done: number; position: number };

export function goalProgress(goal: Row, steps: Step[]): number {
  if (goal.status === "done") return 1;
  if (goal.kind === "number") {
    const start = Number(goal.start_value ?? 0);
    const target = Number(goal.target_value);
    const current = Number(goal.current_value ?? start);
    if (!Number.isFinite(target) || target === start) return 0;
    return Math.max(0, Math.min(1, (current - start) / (target - start)));
  }
  if (!steps.length) return 0;
  return steps.filter((s) => s.done).length / steps.length;
}

export function listGoals(status?: string) {
  const goals = status
    ? all("SELECT * FROM goals WHERE status = ? ORDER BY target_date IS NULL, target_date, id", status)
    : all("SELECT * FROM goals ORDER BY status = 'active' DESC, target_date IS NULL, target_date, id");
  const steps = all<Step>("SELECT * FROM goal_steps ORDER BY position, id");
  return goals.map((g) => {
    const s = steps.filter((x) => x.goal_id === g.id);
    return { ...g, id: Number(g.id), steps: s, progress: goalProgress(g, s) };
  });
}

function withSteps(id: number) {
  return listGoals().find((g) => g.id === id);
}

goalsRouter.get("/", (req, res) => {
  res.json(listGoals(typeof req.query.status === "string" ? req.query.status : undefined));
});

goalsRouter.post("/", (req, res) => {
  const values = pick(req.body, GOAL_COLUMNS);
  if (!values.title) throw new HttpError(400, "title is required");
  const row = insertRow("goals", values);
  const steps: unknown = req.body?.steps;
  if (Array.isArray(steps)) {
    steps
      .map((s) => String(s).trim())
      .filter(Boolean)
      .forEach((title, i) => run("INSERT INTO goal_steps (goal_id, title, position) VALUES (?, ?, ?)", row.id, title, i));
  }
  res.status(201).json(withSteps(Number(row.id)));
});

goalsRouter.patch("/:id", (req, res) => {
  const id = idParam(req);
  const values = pick(req.body, GOAL_COLUMNS);
  if (values.status === "done") values.completed_at = new Date().toISOString();
  else if (values.status) values.completed_at = null;
  updateRow("goals", id, values);
  res.json(withSteps(id));
});

goalsRouter.delete("/:id", (req, res) => {
  run("DELETE FROM goals WHERE id = ?", idParam(req));
  res.json({ ok: true });
});

goalsRouter.post("/:id/steps", (req, res) => {
  const id = idParam(req);
  const title = String(req.body?.title ?? "").trim();
  if (!title) throw new HttpError(400, "title is required");
  const max = get<{ m: number | null }>("SELECT MAX(position) AS m FROM goal_steps WHERE goal_id = ?", id);
  run("INSERT INTO goal_steps (goal_id, title, position) VALUES (?, ?, ?)", id, title, (max?.m ?? -1) + 1);
  res.status(201).json(withSteps(id));
});

goalsRouter.patch("/steps/:id", (req, res) => {
  const values = pick(req.body, { title: "text", done: "bool" });
  const step = updateRow("goal_steps", idParam(req), values);
  res.json(withSteps(Number(step.goal_id)));
});

goalsRouter.delete("/steps/:id", (req, res) => {
  const step = get<Step>("SELECT * FROM goal_steps WHERE id = ?", idParam(req));
  if (!step) throw new HttpError(404, "Not found");
  run("DELETE FROM goal_steps WHERE id = ?", step.id);
  res.json(withSteps(step.goal_id));
});

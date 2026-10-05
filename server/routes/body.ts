import { Router } from "express";
import { DateTime } from "luxon";
import { all } from "../db.ts";
import { load, patch, type BulkSettings } from "../settings.ts";
import { todayStr } from "../time.ts";
import { e1rm, weightStats, type WeightPoint } from "../services/bodyStats.ts";
import { crudRouter, pick } from "./crud.ts";

export const bodyRouter = Router();

bodyRouter.use(
  "/weights",
  crudRouter({
    table: "weights",
    columns: { date: "date", weight: "real", note: "text" },
    required: ["date", "weight"],
    orderBy: "date DESC",
    upsertOn: "date",
  }),
);

bodyRouter.use(
  "/nutrition",
  crudRouter({
    table: "nutrition",
    columns: { date: "date", calories: "int", protein: "int", note: "text" },
    required: ["date"],
    orderBy: "date DESC",
    upsertOn: "date",
    limit: 120,
  }),
);

bodyRouter.use(
  "/lifts",
  crudRouter({
    table: "lifts",
    columns: { date: "date", exercise: "text", weight: "real", reps: "int", sets: "int", note: "text" },
    required: ["date", "exercise", "weight", "reps"],
    orderBy: "date DESC, id DESC",
    filters: { exercise: "exercise = ?" },
    limit: 500,
  }),
);

bodyRouter.use(
  "/measurements",
  crudRouter({
    table: "measurements",
    columns: { date: "date", name: "text", value: "real" },
    required: ["date", "name", "value"],
    orderBy: "date DESC, name",
  }),
);

bodyRouter.get("/summary", (_req, res) => {
  const today = todayStr();
  const bulk = load("bulk");
  const prefs = load("prefs");
  const weights = all<WeightPoint>("SELECT date, weight FROM weights ORDER BY date");
  const stats = weightStats(weights, today, bulk);

  const weekAgo = DateTime.fromISO(today).minus({ days: 6 }).toISODate();
  const food = all<{ date: string; calories: number | null; protein: number | null }>(
    "SELECT date, calories, protein FROM nutrition WHERE date >= ? ORDER BY date",
    weekAgo,
  );
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => typeof x === "number");
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const todayFood = food.find((f) => f.date === today) ?? null;

  const lifts = all<{ date: string; exercise: string; weight: number; reps: number }>(
    "SELECT date, exercise, weight, reps FROM lifts ORDER BY date",
  );
  const prs = new Map<string, { exercise: string; e1rm: number; weight: number; reps: number; date: string; sessions: number }>();
  for (const l of lifts) {
    const est = e1rm(l.weight, l.reps);
    const cur = prs.get(l.exercise);
    if (!cur) prs.set(l.exercise, { exercise: l.exercise, e1rm: est, weight: l.weight, reps: l.reps, date: l.date, sessions: 1 });
    else {
      cur.sessions++;
      if (est > cur.e1rm) Object.assign(cur, { e1rm: est, weight: l.weight, reps: l.reps, date: l.date });
    }
  }

  res.json({
    units: prefs.units,
    bulk,
    weight: stats,
    nutrition: {
      today: todayFood,
      avgCalories7: avg(food.map((f) => f.calories)),
      avgProtein7: avg(food.map((f) => f.protein)),
      daysLogged7: food.length,
    },
    prs: [...prs.values()].sort((a, b) => b.sessions - a.sessions),
    weighedInToday: weights.some((w) => w.date === today),
  });
});

bodyRouter.get("/lift-history", (req, res) => {
  const exercise = String(req.query.exercise ?? "");
  const rows = all<{ date: string; weight: number; reps: number }>(
    "SELECT date, weight, reps FROM lifts WHERE exercise = ? ORDER BY date",
    exercise,
  );
  const best = new Map<string, number>();
  for (const r of rows) best.set(r.date, Math.max(best.get(r.date) ?? 0, e1rm(r.weight, r.reps)));
  res.json([...best.entries()].map(([date, value]) => ({ date, value })));
});

bodyRouter.put("/settings", (req, res) => {
  const values = pick(req.body, {
    goalWeight: "real",
    startWeight: "real",
    startDate: "date",
    targetRate: "real",
    calorieTarget: "int",
    proteinTarget: "int",
  }) as Partial<BulkSettings>;
  res.json(patch("bulk", values));
});

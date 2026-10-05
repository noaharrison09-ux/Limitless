import { Router } from "../router.ts";
import { all, get } from "../db.ts";
import { load } from "../settings.ts";
import { addDays, dayBoundsUtc, nowLocal } from "../time.ts";
import { weightStats, type WeightPoint } from "../bodyStats.ts";
import { journalStreak, nonNegotiablesFor } from "./journal.ts";
import { listGoals } from "./goals.ts";

export const dashboardRouter = Router();

dashboardRouter.get("/today", (_req, res) => {
  const now = nowLocal();
  const today = now.toISODate()!;
  const { start, end } = dayBoundsUtc(today);
  const tomorrowEnd = dayBoundsUtc(addDays(today, 1)).end;
  const nowIso = now.toUTC().toISO()!;
  const prefs = load("prefs");
  const bulk = load("bulk");

  const events = all(
    `SELECT id, title, start, "end", all_day, location, NULL AS color, NULL AS feed_name
     FROM events
     WHERE COALESCE("end", start) >= ? AND start < ?
     ORDER BY all_day DESC, start`,
    start,
    tomorrowEnd,
  );

  const openHw = all<{ id: number; title: string; course: string | null; due_at: string | null; all_day: number; status: string; priority: number }>(
    `SELECT id, title, course, due_at, all_day, status, priority FROM homework
     WHERE status != 'done' AND hidden = 0
     ORDER BY due_at IS NULL, due_at LIMIT 100`,
  );
  const overdue = openHw.filter((h) => h.due_at && h.due_at < nowIso && !(h.all_day && h.due_at >= start));
  const dueToday = openHw.filter((h) => h.due_at && h.due_at < end && !overdue.includes(h));
  const dueTomorrow = openHw.filter((h) => h.due_at && h.due_at >= end && h.due_at < tomorrowEnd);
  const upcoming = openHw.filter((h) => !h.due_at || h.due_at >= tomorrowEnd).slice(0, 5);

  const weights = all<WeightPoint>("SELECT date, weight FROM weights ORDER BY date");
  const stats = weightStats(weights, today, bulk);
  const food = get<{ calories: number | null; protein: number | null }>("SELECT calories, protein FROM nutrition WHERE date = ?", today);

  const goals = listGoals("active").slice(0, 4);
  const projects = all(
    "SELECT id, name, emoji, status FROM projects WHERE status = 'active' ORDER BY pinned DESC, updated_at DESC LIMIT 3",
  );

  res.json({
    date: today,
    hour: now.hour,
    name: prefs.name,
    units: prefs.units,
    nonNegotiables: nonNegotiablesFor(today),
    events,
    homework: { overdue, dueToday, dueTomorrow, upcoming, openCount: openHw.length },
    body: {
      latest: stats.latest,
      avg7: stats.avg7,
      weekChange: stats.weekChange,
      ratePerWeek: stats.ratePerWeek,
      goalWeight: bulk.goalWeight,
      weighedInToday: weights.some((w) => w.date === today),
      calories: food?.calories ?? null,
      protein: food?.protein ?? null,
      calorieTarget: bulk.calorieTarget,
      proteinTarget: bulk.proteinTarget,
    },
    goals,
    projects,
    journal: {
      writtenToday: !!get("SELECT 1 FROM journal_entries WHERE date = ?", today),
      streak: journalStreak(today),
      tomorrowSet: nonNegotiablesFor(addDays(today, 1)).length,
    },
  });
});

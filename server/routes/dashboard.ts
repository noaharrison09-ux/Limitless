import { Router } from "express";
import { all, get } from "../db.ts";
import { load } from "../settings.ts";
import { addDays, dayBoundsUtc, nowLocal } from "../time.ts";
import { weightStats, type WeightPoint } from "../services/bodyStats.ts";
import { pendingCount } from "../services/approvals.ts";
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
    `SELECT e.id, e.title, e.start, e."end", e.all_day, e.location, f.color AS color, f.name AS feed_name
     FROM events e LEFT JOIN calendar_feeds f ON f.id = e.feed_id
     WHERE e.status = 'approved' AND COALESCE(e."end", e.start) >= ? AND e.start < ?
     ORDER BY e.all_day DESC, e.start`,
    start,
    tomorrowEnd,
  );

  const openHw = all<{ id: number; title: string; course: string | null; due_at: string | null; all_day: number; status: string; priority: number }>(
    `SELECT id, title, course, due_at, all_day, status, priority FROM homework
     WHERE status != 'done' AND approval = 'approved' AND hidden = 0
     ORDER BY due_at IS NULL, due_at LIMIT 100`,
  );
  const overdue = openHw.filter((h) => h.due_at && h.due_at < nowIso && !(h.all_day && h.due_at >= start));
  const dueToday = openHw.filter((h) => h.due_at && h.due_at < end && !overdue.includes(h));
  const dueTomorrow = openHw.filter((h) => h.due_at && h.due_at >= end && h.due_at < tomorrowEnd);
  const upcoming = openHw.filter((h) => !h.due_at || h.due_at >= tomorrowEnd).slice(0, 5);

  const weights = all<WeightPoint>("SELECT date, weight FROM weights ORDER BY date");
  const stats = weightStats(weights, today, bulk);
  const food = get<{ calories: number | null; protein: number | null }>("SELECT calories, protein FROM nutrition WHERE date = ?", today);

  const emails = all(
    "SELECT id, from_name, from_addr, subject, summary, snippet, received_at, reason FROM important_emails WHERE read = 0 ORDER BY received_at DESC LIMIT 5",
  );
  const unreadEmails = get<{ n: number }>("SELECT COUNT(*) AS n FROM important_emails WHERE read = 0")!.n;

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
    emails: { unread: unreadEmails, items: emails },
    goals,
    projects,
    journal: {
      writtenToday: !!get("SELECT 1 FROM journal_entries WHERE date = ?", today),
      streak: journalStreak(today),
      tomorrowSet: nonNegotiablesFor(addDays(today, 1)).length,
    },
    pendingApprovals: pendingCount(),
  });
});

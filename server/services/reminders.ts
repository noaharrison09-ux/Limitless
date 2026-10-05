import { DateTime } from "luxon";
import { all, get } from "../db.ts";
import { load } from "../settings.ts";
import { dayBoundsUtc, formatLocalTime, nowLocal } from "../time.ts";
import { pendingCount } from "./approvals.ts";
import { notify } from "./push.ts";

/** True from the scheduled time until `windowMin` minutes after it (so a restart doesn't send stale reminders). */
export function inWindow(now: DateTime, hhmm: string, windowMin = 90): boolean {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return false;
  const target = now.set({ hour: h, minute: m, second: 0, millisecond: 0 });
  const diff = now.diff(target, "minutes").minutes;
  return diff >= 0 && diff < windowMin;
}

type Hw = { id: number; title: string; course: string | null; due_at: string; all_day: number };

function hwLabel(h: Hw) {
  return h.course ? `${h.title} (${h.course})` : h.title;
}

function list(items: string[], max = 3) {
  return items.slice(0, max).join(", ") + (items.length > max ? ` +${items.length - max}` : "");
}

async function morningBriefing(date: string, now: DateTime) {
  const { start, end } = dayBoundsUtc(date);
  const events = all<{ title: string; start: string; all_day: number }>(
    "SELECT title, start, all_day FROM events WHERE status = 'approved' AND start >= ? AND start < ? ORDER BY all_day DESC, start",
    start,
    end,
  );
  const due = all<Hw>(
    "SELECT * FROM homework WHERE status != 'done' AND approval = 'approved' AND hidden = 0 AND due_at < ? ORDER BY due_at",
    end,
  );
  const overdue = due.filter((h) => h.due_at < now.toUTC().toISO()!);
  const nn = all<{ text: string }>("SELECT text FROM non_negotiables WHERE for_date = ? ORDER BY position", date);
  const pending = pendingCount();
  const name = load("prefs").name;

  const parts: string[] = [];
  if (events.length) {
    const first = events.find((e) => !e.all_day);
    parts.push(`📅 ${events.length} event${events.length > 1 ? "s" : ""}${first ? ` (first: ${first.title} ${formatLocalTime(first.start)})` : ""}`);
  }
  if (due.length) parts.push(`📚 ${due.length - overdue.length} due today${overdue.length ? `, ${overdue.length} overdue` : ""}`);
  if (nn.length) parts.push(`✅ ${list(nn.map((n) => n.text), 4)}`);
  if (pending) parts.push(`⏳ ${pending} to approve`);

  await notify({
    title: `☀️ Good morning${name ? `, ${name}` : ""}`,
    body: parts.length ? parts.join(" · ") : "Clear day ahead. Set your intentions in the journal.",
    url: "/",
    tag: "briefing",
    dedupeKey: `briefing:${date}`,
  });
}

export async function runReminders(now: DateTime = nowLocal()) {
  const r = load("reminders");
  const date = now.toISODate()!;
  const nowIso = now.toUTC().toISO()!;

  if (r.morningBriefing.enabled && inWindow(now, r.morningBriefing.time)) {
    await morningBriefing(date, now);
  }

  if (r.weighIn.enabled && inWindow(now, r.weighIn.time, 180) && !get("SELECT 1 FROM weights WHERE date = ?", date)) {
    await notify({
      title: "⚖️ Time to weigh in",
      body: "Same time, same conditions — log it before breakfast.",
      url: "/body",
      tag: "weigh-in",
      dedupeKey: `weighin:${date}`,
    });
  }

  if (r.homeworkEvening.enabled && inWindow(now, r.homeworkEvening.time)) {
    const tomorrow = dayBoundsUtc(now.plus({ days: 1 }).toISODate()!);
    const items = all<Hw>(
      "SELECT * FROM homework WHERE status != 'done' AND approval = 'approved' AND hidden = 0 AND due_at >= ? AND due_at < ? ORDER BY due_at",
      tomorrow.start,
      tomorrow.end,
    );
    if (items.length) {
      await notify({
        title: `📚 ${items.length} due tomorrow`,
        body: list(items.map(hwLabel), 4),
        url: "/homework",
        tag: "homework-evening",
        dedupeKey: `hw-evening:${date}`,
      });
    }
  }

  if (r.journal.enabled && inWindow(now, r.journal.time, 180) && !get("SELECT 1 FROM journal_entries WHERE date = ?", date)) {
    await notify({
      title: "📓 How did today go?",
      body: "What went right, what went wrong, and tomorrow's non-negotiables.",
      url: "/journal",
      tag: "journal",
      dedupeKey: `journal:${date}`,
    });
  }

  if (r.homeworkDueSoon.enabled) {
    const until = now.plus({ hours: r.homeworkDueSoon.hours }).toUTC().toISO()!;
    const soon = all<Hw>(
      "SELECT * FROM homework WHERE status != 'done' AND approval = 'approved' AND hidden = 0 AND all_day = 0 AND due_at > ? AND due_at <= ?",
      nowIso,
      until,
    );
    for (const h of soon) {
      const mins = Math.round(DateTime.fromISO(h.due_at).diff(now, "minutes").minutes);
      await notify({
        title: `⏰ Due ${mins < 90 ? `in ${mins} min` : `at ${formatLocalTime(h.due_at)}`}`,
        body: hwLabel(h),
        url: "/homework",
        dedupeKey: `hw-soon:${h.id}:${h.due_at}`,
      });
    }
  }

  if (r.events.enabled) {
    const until = now.plus({ minutes: r.events.minutesBefore }).toUTC().toISO()!;
    const upcoming = all<{ id: number; feed_id: number | null; uid: string | null; title: string; start: string; location: string | null }>(
      "SELECT * FROM events WHERE status = 'approved' AND all_day = 0 AND start > ? AND start <= ?",
      nowIso,
      until,
    );
    for (const e of upcoming) {
      await notify({
        title: `🗓️ ${e.title}`,
        body: `${formatLocalTime(e.start)}${e.location ? ` · ${e.location}` : ""}`,
        url: "/calendar",
        dedupeKey: `event:${e.feed_id ?? "local"}:${e.uid ?? e.id}:${e.start}`,
      });
    }
  }
}

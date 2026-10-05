/**
 * Calendar files (.ics) in and out.
 *
 * In: a Schoology or Google calendar file becomes homework or calendar events.
 * Out: reminders and due dates become events with alerts in your phone's own Calendar app,
 * which is how you get lock-screen alerts without a server.
 */
import { DateTime } from "luxon";
import { get, run, tx } from "./db.ts";
import { parseIcs } from "./ical.ts";
import type { ReminderSettings } from "./settings.ts";
import { localDateOf, zone } from "./time.ts";

const DAY = 86_400_000;

/* ---------- Import ---------- */

export type ImportResult = { added: number; updated: number };

const ASSIGNMENT_RE = /\/assignment\/(\d+)/;

export type HomeworkItem = {
  externalId: string;
  title: string;
  course: string | null;
  dueAt: string | null;
  allDay: boolean;
  url: string | null;
  notes: string | null;
};

/** Maps calendar-file entries to homework, keyed by Schoology assignment id when there is one. */
export function homeworkFromIcs(text: string, now = Date.now()): HomeworkItem[] {
  const events = parseIcs(text, new Date(now - 7 * DAY), new Date(now + 180 * DAY), zone());
  return events.map((ev) => {
    const assignment = (ev.url ?? "").match(ASSIGNMENT_RE) ?? (ev.description ?? "").match(ASSIGNMENT_RE);
    return {
      externalId: assignment ? `assignment:${assignment[1]}` : ev.recurring ? `ical:${ev.uid}:${ev.start}` : `ical:${ev.uid}`,
      title: ev.title,
      course: ev.location,
      // All-day due dates become 11:59 PM on that day.
      dueAt: ev.allDay ? DateTime.fromISO(ev.date!, { zone: zone() }).set({ hour: 23, minute: 59 }).toUTC().toISO() : ev.start,
      allDay: ev.allDay,
      url: ev.url,
      notes: ev.description ? ev.description.slice(0, 2000) : null,
    };
  });
}

/** Adds new homework and refreshes existing items; your status, notes and removals are kept. */
export function importHomework(text: string, now = Date.now()): ImportResult {
  const items = homeworkFromIcs(text, now);
  const result: ImportResult = { added: 0, updated: 0 };
  tx(() => {
    for (const item of items) {
      const existing = get<{ id: number }>("SELECT id FROM homework WHERE external_id = ?", item.externalId);
      if (existing) {
        run(
          "UPDATE homework SET title = ?, due_at = ?, all_day = ?, url = COALESCE(?, url), course = COALESCE(course, ?) WHERE id = ?",
          item.title,
          item.dueAt,
          item.allDay,
          item.url,
          item.course,
          existing.id,
        );
        result.updated++;
      } else {
        run(
          `INSERT INTO homework (title, course, due_at, all_day, url, notes, source, external_id)
           VALUES (?, ?, ?, ?, ?, ?, 'import', ?)`,
          item.title,
          item.course,
          item.dueAt,
          item.allDay,
          item.url,
          item.notes,
          item.externalId,
        );
        result.added++;
      }
    }
  });
  return result;
}

/**
 * Adds calendar-file events (repeating ones expanded), updating any imported before.
 * `source` is "import" for files you pick and "sync" for calendars synced automatically.
 */
export function importEvents(text: string, now = Date.now(), source: "import" | "sync" = "import"): ImportResult {
  const events = parseIcs(text, new Date(now - 30 * DAY), new Date(now + 365 * DAY), zone());
  const result: ImportResult = { added: 0, updated: 0 };
  tx(() => {
    for (const ev of events) {
      const existing = get<{ id: number }>("SELECT id FROM events WHERE source = ? AND uid = ? AND start = ?", source, ev.uid, ev.start);
      if (existing) {
        run(
          'UPDATE events SET title = ?, "end" = ?, all_day = ?, location = ?, description = ?, url = ? WHERE id = ?',
          ev.title,
          ev.end,
          ev.allDay,
          ev.location,
          ev.description,
          ev.url,
          existing.id,
        );
        result.updated++;
      } else {
        run(
          `INSERT INTO events (source, uid, title, start, "end", all_day, location, description, url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          source,
          ev.uid,
          ev.title,
          ev.start,
          ev.end,
          ev.allDay,
          ev.location,
          ev.description,
          ev.url,
        );
        result.added++;
      }
    }
  });
  return result;
}

/* ---------- Export ---------- */

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines longer than 75 characters are folded, as the iCalendar format requires. */
function fold(line: string): string {
  if (line.length <= 74) return line;
  const out = [line.slice(0, 74)];
  for (let i = 74; i < line.length; i += 73) out.push(` ${line.slice(i, i + 73)}`);
  return out.join("\r\n");
}

function utc(iso: string): string {
  return DateTime.fromISO(iso).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
}

function dateOnly(date: string): string {
  return date.replace(/-/g, "");
}

function calendar(events: string[][]): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Limitless//Personal dashboard//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const ev of events) lines.push(...ev);
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

function alarm(trigger: string, text: string): string[] {
  return ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(text)}`, `TRIGGER:${trigger}`, "END:VALARM"];
}

const REMINDERS: { key: keyof Pick<ReminderSettings, "morningBriefing" | "weighIn" | "homeworkEvening" | "journal">; title: string; text: string }[] = [
  { key: "morningBriefing", title: "☀️ Limitless: plan your day", text: "Open Limitless for today's schedule, homework and non-negotiables." },
  { key: "weighIn", title: "⚖️ Limitless: weigh in", text: "Log your weight before breakfast." },
  { key: "homeworkEvening", title: "📚 Limitless: homework check", text: "See what's due tomorrow." },
  { key: "journal", title: "📓 Limitless: journal", text: "What went right, what went wrong, and tomorrow's non-negotiables." },
];

/** Daily repeating alerts at your reminder times (floating local time, so they follow your phone's timezone). */
export function remindersIcs(reminders: ReminderSettings, today: string, appUrl: string): string {
  const stamp = utc(new Date().toISOString());
  const events = REMINDERS.filter((r) => reminders[r.key].enabled).map((r) => {
    const [h, m] = reminders[r.key].time.split(":");
    return [
      "BEGIN:VEVENT",
      `UID:limitless-${r.key}@limitless.app`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${dateOnly(today)}T${h}${m}00`,
      "DURATION:PT5M",
      "RRULE:FREQ=DAILY",
      `SUMMARY:${esc(r.title)}`,
      `DESCRIPTION:${esc(r.text)}`,
      ...(appUrl ? [`URL:${appUrl}`] : []),
      "TRANSP:TRANSPARENT",
      ...alarm("PT0M", r.title),
      "END:VEVENT",
    ];
  });
  return calendar(events);
}

type HomeworkRow = { id: number; title: string; course: string | null; due_at: string | null; all_day: number; notes: string | null; url: string | null };

/** One assignment as a phone-calendar event with an alert before it's due. */
export function homeworkIcs(h: HomeworkRow, hoursBefore: number): string {
  if (!h.due_at) throw new Error("This assignment has no due date");
  const title = `📚 Due: ${h.title}${h.course ? ` (${h.course})` : ""}`;
  const when = h.all_day
    ? [`DTSTART;VALUE=DATE:${dateOnly(localDateOf(h.due_at))}`, `DTEND;VALUE=DATE:${dateOnly(DateTime.fromISO(localDateOf(h.due_at)).plus({ days: 1 }).toISODate()!)}`]
    : [`DTSTART:${utc(h.due_at)}`, "DURATION:PT15M"];
  // All-day items alert at 6 PM the evening before; timed ones a few hours ahead.
  const trigger = h.all_day ? "-PT6H" : `-PT${Math.max(1, Math.round(hoursBefore))}H`;
  return calendar([
    [
      "BEGIN:VEVENT",
      `UID:limitless-homework-${h.id}@limitless.app`,
      `DTSTAMP:${utc(new Date().toISOString())}`,
      ...when,
      `SUMMARY:${esc(title)}`,
      ...(h.notes || h.url ? [`DESCRIPTION:${esc([h.notes, h.url].filter(Boolean).join("\n"))}`] : []),
      ...alarm(trigger, title),
      "END:VEVENT",
    ],
  ]);
}

type EventRow = { id: number; title: string; start: string; end: string | null; all_day: number; location: string | null; description: string | null };

/** One event as a phone-calendar event with an alert before it starts. */
export function eventIcs(e: EventRow, minutesBefore: number): string {
  const when = e.all_day
    ? [
        `DTSTART;VALUE=DATE:${dateOnly(localDateOf(e.start))}`,
        `DTEND;VALUE=DATE:${dateOnly(e.end ? localDateOf(e.end) : DateTime.fromISO(localDateOf(e.start)).plus({ days: 1 }).toISODate()!)}`,
      ]
    : [`DTSTART:${utc(e.start)}`, e.end ? `DTEND:${utc(e.end)}` : "DURATION:PT1H"];
  return calendar([
    [
      "BEGIN:VEVENT",
      `UID:limitless-event-${e.id}@limitless.app`,
      `DTSTAMP:${utc(new Date().toISOString())}`,
      ...when,
      `SUMMARY:${esc(e.title)}`,
      ...(e.location ? [`LOCATION:${esc(e.location)}`] : []),
      ...(e.description ? [`DESCRIPTION:${esc(e.description)}`] : []),
      ...alarm(e.all_day ? "PT8H" : `-PT${Math.max(0, Math.round(minutesBefore))}M`, e.title),
      "END:VEVENT",
    ],
  ]);
}

import { beforeEach, describe, expect, it } from "vitest";
import { all, get, run } from "./db.ts";
import { defaults } from "./settings.ts";
import { parseIcs } from "./ical.ts";
import { api, freshDb } from "./test/helpers.ts";
import { eventIcs, homeworkIcs, importEvents, importHomework, remindersIcs } from "./calendarFiles.ts";

const NOW = Date.parse("2026-10-05T12:00:00Z");

const schoology = (title = "Lab report") =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:sgy-1",
    `SUMMARY:${title}`,
    "DTSTART:20261007T035900Z",
    "URL:https://myschool.schoology.com/assignment/987654/info",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:sgy-2",
    "SUMMARY:Reading quiz",
    "DTSTART;VALUE=DATE:20261009",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

beforeEach(async () => {
  await freshDb("America/New_York");
});

describe("importing calendar files", () => {
  it("turns a Schoology calendar into homework, keyed by assignment", () => {
    expect(importHomework(schoology(), NOW)).toEqual({ added: 2, updated: 0 });
    expect(all("SELECT title, due_at, all_day, external_id, source FROM homework ORDER BY due_at")).toEqual([
      { title: "Lab report", due_at: "2026-10-07T03:59:00.000Z", all_day: 0, external_id: "assignment:987654", source: "import" },
      // All-day due dates become 11:59 PM local time.
      { title: "Reading quiz", due_at: "2026-10-10T03:59:00.000Z", all_day: 1, external_id: "ical:sgy-2", source: "import" },
    ]);
  });

  it("re-importing updates without duplicates and keeps your progress and removals", () => {
    importHomework(schoology(), NOW);
    run("UPDATE homework SET status = 'done' WHERE external_id = 'assignment:987654'");
    run("UPDATE homework SET hidden = 1 WHERE external_id = 'ical:sgy-2'");
    expect(importHomework(schoology("Lab report (revised)"), NOW)).toEqual({ added: 0, updated: 2 });
    expect(all("SELECT title, status, hidden FROM homework ORDER BY id")).toEqual([
      { title: "Lab report (revised)", status: "done", hidden: 0 },
      { title: "Reading quiz", status: "todo", hidden: 1 },
    ]);
  });

  it("imports events, expanding repeats, and updates them on re-import", () => {
    const ics = (title: string) =>
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:practice",
        `SUMMARY:${title}`,
        "DTSTART;TZID=America/New_York:20261006T154500",
        "DTEND;TZID=America/New_York:20261006T173000",
        "RRULE:FREQ=WEEKLY;COUNT=3",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");
    expect(importEvents(ics("Practice"), NOW)).toEqual({ added: 3, updated: 0 });
    expect(importEvents(ics("Soccer practice"), NOW)).toEqual({ added: 0, updated: 3 });
    expect(all("SELECT DISTINCT title, source FROM events")).toEqual([{ title: "Soccer practice", source: "import" }]);
  });

  it("explains files that aren't calendars", async () => {
    const call = api();
    const res = await call<{ error: string }>("POST", "/import/ics", { text: "hello", as: "homework" });
    expect(res.status).toBe(400);
    expect(res.data.error).toMatch(/isn't a calendar/);
  });
});

describe("calendar files for the phone's Calendar app", () => {
  it("creates daily repeating reminders with alerts, only for the ones turned on", () => {
    const reminders = structuredClone(defaults.reminders);
    reminders.weighIn.enabled = false;
    const text = remindersIcs(reminders, "2026-10-05", "https://example.github.io/Limitless/");
    expect(text).toContain("RRULE:FREQ=DAILY");
    expect(text).toContain("DTSTART:20261005T070000");
    expect(text).toContain("DTSTART:20261005T210000");
    expect(text).not.toContain("weigh in");
    expect(text.match(/BEGIN:VALARM/g)).toHaveLength(3);
    expect(text.split("\r\n").every((line) => line.length <= 75)).toBe(true);
    // Our own file parses as valid iCalendar, one occurrence per reminder per day.
    const parsed = parseIcs(text, new Date("2026-10-05T00:00:00Z"), new Date("2026-10-07T12:00:00Z"), "America/New_York");
    expect(parsed.filter((e) => e.title.includes("journal"))).toHaveLength(2);
  });

  it("adds an alert before homework is due and before events start", () => {
    run("INSERT INTO homework (id, title, course, due_at, all_day) VALUES (1, 'Essay, final', 'English', '2026-10-08T03:59:00.000Z', 0)");
    const hw = homeworkIcs(get("SELECT * FROM homework WHERE id = 1")!, 3);
    expect(hw).toContain("DTSTART:20261008T035900Z");
    expect(hw).toContain("TRIGGER:-PT3H");
    expect(hw).toContain("SUMMARY:📚 Due: Essay\\, final (English)");

    run("INSERT INTO events (id, title, start, \"end\", all_day) VALUES (1, 'Game', '2026-10-09T22:00:00.000Z', '2026-10-10T00:00:00.000Z', 0)");
    const ev = eventIcs(get("SELECT * FROM events WHERE id = 1")!, 30);
    expect(ev).toContain("TRIGGER:-PT30M");
    expect(ev).toContain("DTEND:20261010T000000Z");
  });

  it("serves the files through the API", async () => {
    const call = api();
    const { data } = await call<{ filename: string; text: string }>("GET", "/ics/reminders?appUrl=https%3A%2F%2Fx.github.io%2FLimitless%2F");
    expect(data.filename).toBe("limitless-reminders.ics");
    expect(data.text).toContain("URL:https://x.github.io/Limitless/");
    const missing = await call("GET", "/ics/homework/999");
    expect(missing.status).toBe(404);
  });
});

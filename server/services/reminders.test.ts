import { DateTime } from "luxon";
import { beforeEach, describe, expect, it } from "vitest";
import { all, run } from "../db.ts";
import { freshDb } from "../test/helpers.ts";
import { inWindow, runReminders } from "./reminders.ts";

const ZONE = "America/New_York";
const at = (iso: string) => DateTime.fromISO(iso, { zone: ZONE });

describe("inWindow", () => {
  it("is true from the scheduled time until the window closes", () => {
    expect(inWindow(at("2026-10-05T06:59"), "07:00")).toBe(false);
    expect(inWindow(at("2026-10-05T07:00"), "07:00")).toBe(true);
    expect(inWindow(at("2026-10-05T08:29"), "07:00")).toBe(true);
    expect(inWindow(at("2026-10-05T08:31"), "07:00")).toBe(false);
  });
});

describe("runReminders", () => {
  beforeEach(() => freshDb(ZONE));

  const titles = () => all<{ title: string; body: string }>("SELECT title, body FROM notifications ORDER BY id");

  it("sends the morning briefing once, with today's non-negotiables", async () => {
    run("INSERT INTO non_negotiables (for_date, text, position) VALUES ('2026-10-05', 'Gym', 0), ('2026-10-05', 'Read', 1)");
    await runReminders(at("2026-10-05T07:02"));
    await runReminders(at("2026-10-05T07:03"));
    const briefings = titles().filter((n) => n.title.includes("Good morning"));
    expect(briefings).toHaveLength(1);
    expect(briefings[0].body).toContain("Gym, Read");
  });

  it("only nags about journaling and weighing in when they aren't done", async () => {
    run("INSERT INTO weights (date, weight) VALUES ('2026-10-05', 160)");
    await runReminders(at("2026-10-05T07:31"));
    expect(titles().some((n) => n.title.includes("weigh in"))).toBe(false);

    await runReminders(at("2026-10-05T21:10"));
    expect(titles().filter((n) => n.title.includes("How did today go"))).toHaveLength(1);
  });

  it("warns about approved homework due soon and upcoming events, but not pending items", async () => {
    const now = at("2026-10-05T14:00");
    run(
      "INSERT INTO homework (title, course, due_at, all_day, approval) VALUES ('Essay', 'English', ?, 0, 'approved'), ('Hidden', NULL, ?, 0, 'pending')",
      now.plus({ hours: 2 }).toUTC().toISO(),
      now.plus({ hours: 2 }).toUTC().toISO(),
    );
    run(
      "INSERT INTO events (title, start, all_day, status) VALUES ('Practice', ?, 0, 'approved'), ('Maybe', ?, 0, 'pending')",
      now.plus({ minutes: 20 }).toUTC().toISO(),
      now.plus({ minutes: 20 }).toUTC().toISO(),
    );
    await runReminders(now);
    const t = titles();
    expect(t.some((n) => n.body === "Essay (English)")).toBe(true);
    expect(t.some((n) => n.body === "Hidden")).toBe(false);
    expect(t.some((n) => n.title.includes("Practice"))).toBe(true);
    expect(t.some((n) => n.title.includes("Maybe"))).toBe(false);
  });
});

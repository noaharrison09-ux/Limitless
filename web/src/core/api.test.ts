import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb } from "./test/helpers.ts";

let call: ReturnType<typeof api>;

beforeEach(async () => {
  await freshDb("America/New_York");
  call = api();
});

describe("in-page API", () => {
  it("answers unknown routes with 404 and bad input with 400", async () => {
    expect((await call("GET", "/nope")).status).toBe(404);
    expect((await call("POST", "/body/weights", { date: "Oct 1", weight: 1 })).status).toBe(400);
    expect((await call("PATCH", "/goals/abc", {})).status).toBe(400);
  });

  it("moves journal non-negotiables onto the next day and keeps check marks on re-save", async () => {
    const saved = await call<{ tomorrow: { text: string }[] }>("PUT", "/journal/day/2026-10-04", {
      went_right: "Gym",
      went_wrong: "Late night",
      tomorrow: ["Lift", "Read", " "],
    });
    expect(saved.data.tomorrow.map((n) => n.text)).toEqual(["Lift", "Read"]);
    const next = await call<{ today: { id: number; text: string }[] }>("GET", "/journal/day/2026-10-05");
    expect(next.data.today.map((n) => n.text)).toEqual(["Lift", "Read"]);

    await call("PATCH", `/journal/non-negotiables/${next.data.today[0].id}`, { done: true });
    const again = await call<{ tomorrow: { text: string; done: number }[] }>("PUT", "/journal/day/2026-10-04", { tomorrow: ["Lift", "Read", "Stretch"] });
    expect(again.data.tomorrow.map((n) => [n.text, n.done])).toEqual([
      ["Lift", 1],
      ["Read", 0],
      ["Stretch", 0],
    ]);
  });

  it("stores homework due times in your timezone", async () => {
    const timed = await call<{ due_at: string; all_day: number }>("POST", "/homework", { title: "Lab report", due_date: "2026-10-06", due_time: "08:00" });
    expect(timed.data).toMatchObject({ due_at: "2026-10-06T12:00:00.000Z", all_day: 0 });
    const allDay = await call<{ due_at: string; all_day: number }>("POST", "/homework", { title: "Reading", due_date: "2026-10-07" });
    expect(allDay.data).toMatchObject({ due_at: "2026-10-08T03:59:00.000Z", all_day: 1 });
    const open = await call<{ title: string }[]>("GET", "/homework");
    expect(open.data.map((h) => h.title)).toEqual(["Lab report", "Reading"]);
  });

  it("keeps one weigh-in per day and reports bulk stats", async () => {
    await call("POST", "/body/weights", { date: "2026-10-01", weight: 160 });
    await call("POST", "/body/weights", { date: "2026-10-01", weight: 160.4 });
    const { data } = await call<{ date: string; weight: number }[]>("GET", "/body/weights");
    expect(data).toEqual([expect.objectContaining({ date: "2026-10-01", weight: 160.4 })]);
    const summary = await call<{ weight: { latest: { weight: number } } }>("GET", "/body/summary");
    expect(summary.data.weight.latest.weight).toBe(160.4);
  });

  it("tracks goal progress", async () => {
    const { data: goal } = await call<{ id: number; progress: number; steps: { id: number }[] }>("POST", "/goals", {
      title: "Bench 225",
      kind: "steps",
      steps: ["Program", "Train", "Test"],
    });
    expect(goal.progress).toBe(0);
    const { data } = await call<{ progress: number }>("PATCH", `/goals/steps/${goal.steps[0].id}`, { done: true });
    expect(data.progress).toBeCloseTo(1 / 3);
  });

  it("turns an idea into a project and back into an idea when the project is deleted", async () => {
    const { data: note } = await call<{ id: number }>("POST", "/notes", { body: "Study planner app" });
    const { data: project } = await call<{ id: number }>("POST", "/projects", { name: "Study planner", from_note_id: note.id });
    const { data: detail } = await call<{ notes: { id: number }[] }>("GET", `/projects/${project.id}`);
    expect(detail.notes.map((n) => n.id)).toEqual([note.id]);
    expect((await call<unknown[]>("GET", "/notes?project=none")).data).toEqual([]);

    await call("DELETE", `/projects/${project.id}`);
    expect((await call<{ id: number }[]>("GET", "/notes?project=none")).data.map((n) => n.id)).toEqual([note.id]);
  });

  it("adds, edits and lists calendar events", async () => {
    const ev = await call<{ id: number }>("POST", "/calendar/events", { title: "Practice", date: "2026-10-06", start_time: "15:45", end_time: "17:00" });
    expect(ev.status).toBe(201);
    await call("PATCH", `/calendar/events/${ev.data.id}`, { title: "Soccer practice" });
    const { data } = await call<{ events: { title: string; start: string }[] }>("GET", "/calendar/events?from=2026-10-06T00:00:00Z&to=2026-10-07T12:00:00Z");
    expect(data.events).toEqual([expect.objectContaining({ title: "Soccer practice", start: "2026-10-06T19:45:00.000Z" })]);
  });

  it("builds the Today view without any server", async () => {
    await call("PUT", "/settings/prefs", { name: "Sam" });
    const { status, data } = await call<{ name: string; homework: object; body: object; journal: object }>("GET", "/today");
    expect(status).toBe(200);
    expect(data).toMatchObject({ name: "Sam", homework: expect.any(Object), body: expect.any(Object), journal: expect.any(Object) });
  });

  it("validates reminder times", async () => {
    expect((await call("PUT", "/settings/reminders", { journal: { time: "25:00" } })).status).toBe(400);
    const { data } = await call<{ journal: { time: string; enabled: boolean } }>("PUT", "/settings/reminders", { journal: { time: "21:30", enabled: false } });
    expect(data.journal).toEqual({ time: "21:30", enabled: false });
  });
});

describe("backup and restore", () => {
  it("round-trips everything through a backup file", async () => {
    await call("PUT", "/settings/prefs", { name: "Sam", units: "kg" });
    await call("POST", "/body/weights", { date: "2026-10-01", weight: 72.5 });
    const { data: goal } = await call<{ id: number }>("POST", "/goals", { title: "Run 5k", kind: "steps", steps: ["Week 1"] });
    await call("POST", "/notes", { body: "Idea" });
    const backup = (await call("GET", "/export")).data;
    const copy = JSON.parse(JSON.stringify(backup));

    // Start over on a "new phone" and restore.
    await freshDb("America/New_York");
    call = api();
    expect((await call<unknown[]>("GET", "/body/weights")).data).toEqual([]);
    const restored = await call<{ counts: Record<string, number> }>("POST", "/restore", { data: copy });
    expect(restored.data.counts).toMatchObject({ weights: 1, goals: 1, goal_steps: 1, notes: 1 });

    expect((await call<{ weight: number }[]>("GET", "/body/weights")).data[0].weight).toBe(72.5);
    const goals = await call<{ id: number; steps: unknown[] }[]>("GET", "/goals");
    expect(goals.data).toEqual([expect.objectContaining({ id: goal.id, steps: [expect.anything()] })]);
    expect((await call<{ prefs: { name: string; units: string } }>("GET", "/settings")).data.prefs).toMatchObject({ name: "Sam", units: "kg" });
  });

  it("rejects files that aren't backups", async () => {
    expect((await call("POST", "/restore", { data: { hello: "world" } })).status).toBe(400);
    expect((await call("POST", "/restore", {})).status).toBe(400);
  });
});

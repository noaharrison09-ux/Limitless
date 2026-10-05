import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { assertConfig } from "./config.ts";
import { freshDb } from "./test/helpers.ts";

let server: Server;
let base = "";
let cookie = "";

async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return { status: res.status, data: (await res.json()) as T };
}

beforeAll(async () => {
  assertConfig();
  freshDb("America/New_York");
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => server.close());

describe("API", () => {
  it("requires the password", async () => {
    expect((await call("GET", "/today")).status).toBe(401);
    expect((await call("POST", "/auth/login", { password: "nope" })).status).toBe(401);
    expect((await call("POST", "/auth/login", { password: "test-password" })).status).toBe(200);
    expect((await call("GET", "/auth/session")).data).toEqual({ authenticated: true });
  });

  it("moves journal non-negotiables onto the next day", async () => {
    const saved = await call<{ tomorrow: { text: string }[] }>("PUT", "/journal/day/2026-10-04", {
      went_right: "Gym",
      went_wrong: "Late night",
      tomorrow: ["Lift", "Read", " "],
    });
    expect(saved.data.tomorrow.map((n) => n.text)).toEqual(["Lift", "Read"]);
    const next = await call<{ today: { id: number; text: string; done: number }[] }>("GET", "/journal/day/2026-10-05");
    expect(next.data.today.map((n) => n.text)).toEqual(["Lift", "Read"]);

    await call("PATCH", `/journal/non-negotiables/${next.data.today[0].id}`, { done: true });
    // Re-saving last night's entry keeps what you already checked off.
    const again = await call<{ tomorrow: { text: string; done: number }[] }>("PUT", "/journal/day/2026-10-04", { tomorrow: ["Lift", "Read", "Stretch"] });
    expect(again.data.tomorrow).toEqual([
      expect.objectContaining({ text: "Lift", done: 1 }),
      expect.objectContaining({ text: "Read", done: 0 }),
      expect.objectContaining({ text: "Stretch", done: 0 }),
    ]);
  });

  it("stores homework due times in the user's timezone", async () => {
    const { data } = await call<{ due_at: string; all_day: number }>("POST", "/homework", {
      title: "Lab report",
      course: "Chemistry",
      due_date: "2026-10-06",
      due_time: "08:00",
    });
    expect(data.due_at).toBe("2026-10-06T12:00:00.000Z");
    expect(data.all_day).toBe(0);
    const allDay = await call<{ due_at: string; all_day: number }>("POST", "/homework", { title: "Reading", due_date: "2026-10-07" });
    expect(allDay.data).toMatchObject({ due_at: "2026-10-08T03:59:00.000Z", all_day: 1 });
  });

  it("upserts one weigh-in per day and reports bulk stats", async () => {
    await call("POST", "/body/weights", { date: "2026-10-01", weight: 160 });
    await call("POST", "/body/weights", { date: "2026-10-01", weight: 160.4 });
    const { data } = await call<{ date: string; weight: number }[]>("GET", "/body/weights");
    expect(data).toEqual([expect.objectContaining({ date: "2026-10-01", weight: 160.4 })]);
    expect((await call("POST", "/body/weights", { date: "Oct 1", weight: 1 })).status).toBe(400);
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

  it("turns an idea into a project", async () => {
    const { data: note } = await call<{ id: number }>("POST", "/notes", { body: "Study planner app" });
    const { data: project } = await call<{ id: number }>("POST", "/projects", { name: "Study planner", from_note_id: note.id });
    const { data: detail } = await call<{ notes: { id: number }[] }>("GET", `/projects/${project.id}`);
    expect(detail.notes.map((n) => n.id)).toEqual([note.id]);
    expect((await call<unknown[]>("GET", "/notes?project=none")).data).toEqual([]);
  });

  it("approves queued items through the API", async () => {
    const { data: before } = await call<{ count: number }>("GET", "/approvals");
    expect(before.count).toBe(0);
    const ev = await call<{ id: number; status: string }>("POST", "/calendar/events", { title: "Practice", date: "2026-10-06", start_time: "15:45" });
    expect(ev.data.status).toBe("approved");
    const { data: range } = await call<{ events: { title: string }[] }>(
      "GET",
      `/calendar/events?from=2026-10-06T00:00:00Z&to=2026-10-07T12:00:00Z`,
    );
    expect(range.events.map((e) => e.title)).toContain("Practice");
  });

  it("never returns stored secrets", async () => {
    await call("PUT", "/schoology", { icalUrl: "webcal://example.schoology.com/feed/abc.ics" });
    const { data } = await call<{ schoology: Record<string, unknown> }>("GET", "/settings");
    expect(data.schoology).toMatchObject({ hasIcal: true });
    expect(JSON.stringify(data)).not.toContain("example.schoology.com");
  });
});

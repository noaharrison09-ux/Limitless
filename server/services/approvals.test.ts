import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, run } from "../db.ts";
import { encrypt } from "../crypto.ts";
import { freshDb } from "../test/helpers.ts";
import { syncFeed, type FeedRow } from "./calendarSync.ts";
import { approveAll, decideEvent, decideHomework, listPending, pendingCount } from "./approvals.ts";

// A tiny local calendar server so the real sync code runs end to end.
let feedBody = "";
let server: http.Server;
let feedUrl = "";

const day = (offset: number) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
};

function calendar(events: { uid: string; title: string; offset: number; rrule?: string }[]) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    ...events.flatMap((e) => [
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `SUMMARY:${e.title}`,
      `DTSTART:${day(e.offset)}T180000Z`,
      `DTEND:${day(e.offset)}T190000Z`,
      ...(e.rrule ? [`RRULE:${e.rrule}`] : []),
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ].join("\r\n");
}

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/calendar" });
    res.end(feedBody);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  feedUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/cal.ics`;
});

afterAll(() => server.close());

function addFeed(autoApprove = false): FeedRow {
  const { lastId } = run(
    "INSERT INTO calendar_feeds (name, url_enc, auto_approve) VALUES ('Family', ?, ?)",
    encrypt(feedUrl),
    autoApprove ? 1 : 0,
  );
  return get<FeedRow>("SELECT * FROM calendar_feeds WHERE id = ?", lastId)!;
}

describe("calendar approval queue", () => {
  beforeEach(() => freshDb("UTC"));

  it("queues linked-calendar events until approved, and remembers the decision across syncs", async () => {
    feedBody = calendar([
      { uid: "dinner", title: "Family dinner", offset: 2, rrule: "FREQ=WEEKLY;COUNT=3" },
      { uid: "dentist", title: "Dentist", offset: 3 },
    ]);
    const feed = addFeed();
    const first = await syncFeed(feed);
    expect(first.events).toBe(4);
    expect(new Set(first.newPending)).toEqual(new Set(["Family dinner", "Dentist"]));

    const pending = listPending();
    expect(pending.count).toBe(2); // the recurring series counts once
    const dinner = pending.events.find((e) => e.title === "Family dinner")!;
    expect(dinner.occurrences).toBe(3);
    const dentist = pending.events.find((e) => e.title === "Dentist")!;

    decideEvent(dinner.id, "approved");
    decideEvent(dentist.id, "declined");
    expect(all("SELECT status FROM events WHERE uid = 'dinner'").every((r) => r.status === "approved")).toBe(true);
    expect(pendingCount()).toBe(0);

    // A re-sync replaces the rows but keeps both decisions, and only the new event is queued.
    feedBody = calendar([
      { uid: "dinner", title: "Family dinner", offset: 2, rrule: "FREQ=WEEKLY;COUNT=3" },
      { uid: "dentist", title: "Dentist", offset: 3 },
      { uid: "recital", title: "Recital", offset: 5 },
    ]);
    const second = await syncFeed(get<FeedRow>("SELECT * FROM calendar_feeds WHERE id = ?", feed.id)!);
    expect(second.newPending).toEqual(["Recital"]);
    expect(get("SELECT status FROM events WHERE uid = 'dentist'")).toEqual(expect.objectContaining({ status: "declined" }));
    expect(all("SELECT DISTINCT status FROM events WHERE uid = 'dinner'")).toEqual([expect.objectContaining({ status: "approved" })]);
    expect(pendingCount()).toBe(1);
  });

  it("auto-approves feeds you trust", async () => {
    feedBody = calendar([{ uid: "x", title: "Game", offset: 1 }]);
    await syncFeed(addFeed(true));
    expect(pendingCount()).toBe(0);
    expect(get("SELECT status FROM events WHERE uid = 'x'")).toEqual(expect.objectContaining({ status: "approved" }));
  });

  it("records a feed error instead of throwing away existing events", async () => {
    feedBody = "not a calendar";
    const feed = addFeed();
    await expect(syncFeed(feed)).rejects.toThrow(/iCal/);
    expect(get<{ last_error: string }>("SELECT last_error FROM calendar_feeds WHERE id = ?", feed.id)!.last_error).toMatch(/iCal/);
  });

  it("handles email suggestions and homework decisions", () => {
    run("INSERT INTO events (source, status, title, start) VALUES ('email', 'pending', 'Midterm', '2026-10-09T12:00:00.000Z')");
    run("INSERT INTO homework (title, source, external_id, approval) VALUES ('Worksheet', 'schoology', 'a:1', 'pending')");
    run("INSERT INTO homework (title, source, external_id, approval) VALUES ('Quiz', 'schoology', 'a:2', 'pending')");
    expect(pendingCount()).toBe(3);

    const ev = get<{ id: number }>("SELECT id FROM events WHERE title = 'Midterm'")!;
    decideEvent(ev.id, "declined");
    expect(get("SELECT 1 FROM events WHERE id = ?", ev.id)).toBeUndefined();

    const hw = get<{ id: number }>("SELECT id FROM homework WHERE title = 'Worksheet'")!;
    decideHomework(hw.id, "declined");
    expect(get("SELECT approval, hidden FROM homework WHERE id = ?", hw.id)).toEqual(expect.objectContaining({ approval: "declined", hidden: 1 }));

    approveAll();
    expect(pendingCount()).toBe(0);
    expect(get("SELECT approval FROM homework WHERE title = 'Quiz'")).toEqual(expect.objectContaining({ approval: "approved" }));
  });
});

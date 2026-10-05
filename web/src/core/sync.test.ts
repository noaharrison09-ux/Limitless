import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { all, run } from "./db.ts";
import { load } from "./settings.ts";
import { api, freshDb } from "./test/helpers.ts";
import { applySyncPayload, decryptSyncFile, type SyncFile, type SyncPayload } from "./sync.ts";
import { calendarLinks, encryptPayload, main } from "../../../scripts/sync-calendars.ts";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const PASS = "maple orbit jacket thunder";

const vcal = (...events: string[][]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...events.flat(), "END:VCALENDAR"].join("\r\n");
const vevent = (uid: string, title: string, start: string, extra: string[] = []) => [
  "BEGIN:VEVENT",
  `UID:${uid}`,
  `SUMMARY:${title}`,
  `DTSTART:${start}`,
  ...extra,
  "END:VEVENT",
];

const homeworkCal = vcal(vevent("sgy-1", "Lab report", "20261007T035900Z", ["URL:https://x.schoology.com/assignment/42/info"]));
const eventsCal = (...titles: string[]) => vcal(...titles.map((t, i) => vevent(`ev-${t}`, t, `2026100${6 + i}T150000Z`)));

const payload = (over: Partial<SyncPayload> = {}): SyncPayload => ({
  v: 1,
  syncedAt: "2026-10-05T11:17:00.000Z",
  homework: [homeworkCal],
  events: [eventsCal("Practice", "Dentist")],
  errors: [],
  ...over,
});

// Fewer key-stretching rounds than the real 600,000 keeps the tests quick; the format is the same.
const lock = (p: SyncPayload, passphrase = PASS) => encryptPayload(p, passphrase, 1_000);

beforeEach(async () => {
  await freshDb("America/New_York");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("locking and unlocking", () => {
  it("the app unlocks what the GitHub script locked", async () => {
    const p = payload();
    const file = lock(p);
    expect(file.data).not.toContain("Lab report");
    expect(JSON.stringify(file)).not.toContain("Practice");
    expect(await decryptSyncFile(file, PASS)).toEqual(p);
  });

  it("pads the locked file so its size doesn't reveal how much is on your calendar", () => {
    const small = lock(payload({ events: [eventsCal("Practice")] }));
    const bigger = lock(payload({ events: [eventsCal("Practice", "Dentist", "Lift", "Game", "Study")] }));
    expect(small.data.length).toBe(bigger.data.length);
  });

  it("refuses the wrong passphrase", async () => {
    await expect(decryptSyncFile(lock(payload()), "not the right passphrase")).rejects.toThrow("doesn't match");
  });

  it("refuses a file that was tampered with", async () => {
    const file = lock(payload());
    const bytes = Buffer.from(file.data, "base64");
    bytes[3] ^= 1;
    await expect(decryptSyncFile({ ...file, data: bytes.toString("base64") }, PASS)).rejects.toThrow();
  });
});

describe("applying a sync", () => {
  it("adds homework and events", () => {
    const r = applySyncPayload(payload(), NOW);
    expect(r).toEqual({ counts: { homework: 1, events: 2 }, errors: [] });
    expect(all("SELECT title, source FROM events ORDER BY start")).toEqual([
      { title: "Practice", source: "sync" },
      { title: "Dentist", source: "sync" },
    ]);
    expect(all("SELECT title, external_id FROM homework")).toEqual([{ title: "Lab report", external_id: "assignment:42" }]);
  });

  it("mirrors the calendar: deleted events disappear, your own events and homework progress stay", () => {
    run("INSERT INTO events (source, title, start, all_day) VALUES ('local', 'My own thing', '2026-10-06T20:00:00.000Z', 0)");
    applySyncPayload(payload(), NOW);
    run("UPDATE homework SET status = 'done'");
    applySyncPayload(payload({ events: [eventsCal("Practice")] }), NOW);
    expect(all("SELECT title, source FROM events ORDER BY start")).toEqual([
      { title: "Practice", source: "sync" },
      { title: "My own thing", source: "local" },
    ]);
    expect(all("SELECT status FROM homework")).toEqual([{ status: "done" }]);
  });

  it("keeps the events it has when a calendar couldn't be downloaded", () => {
    applySyncPayload(payload(), NOW);
    const r = applySyncPayload(
      payload({ events: [], errors: [{ kind: "events", source: "Calendar", message: "the calendar link returned HTTP 404" }] }),
      NOW,
    );
    expect(r.counts.events).toBe(2);
    expect(r.errors).toEqual([{ source: "Calendar", message: "the calendar link returned HTTP 404" }]);
  });

  it("keeps the events it has when a calendar can't be read", () => {
    applySyncPayload(payload(), NOW);
    const r = applySyncPayload(payload({ events: ["BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nnot a calendar"] }), NOW);
    expect(r.counts.events).toBe(2);
    expect(r.errors[0].source).toBe("Calendar");
  });
});

describe("sync API", () => {
  it("needs a long enough passphrase, and never hands it back", async () => {
    const call = api();
    expect((await call("PUT", "/sync/settings", { passphrase: "short" })).status).toBe(400);
    const saved = await call("PUT", "/sync/settings", { passphrase: PASS });
    expect(saved.status).toBe(200);
    expect(saved.data).toMatchObject({ configured: true });
    expect(JSON.stringify(saved.data)).not.toContain(PASS);
    expect(JSON.stringify((await call("GET", "/sync/status")).data)).not.toContain(PASS);
  });

  it("imports a new file once, then skips it until GitHub publishes another", async () => {
    const call = api();
    await call("PUT", "/sync/settings", { passphrase: PASS });
    const file = lock(payload());

    const first = await call("POST", "/sync/apply", { file });
    expect(first.data).toMatchObject({ changed: true, appliedSyncedAt: file.syncedAt, counts: { homework: 1, events: 2 }, lastError: null });
    expect((await call("POST", "/sync/apply", { file })).data).toMatchObject({ changed: false });
    expect((await call("POST", "/sync/apply", { file, force: true })).data).toMatchObject({ changed: true });

    const newer = lock(payload({ syncedAt: "2026-10-05T14:17:00.000Z", events: [eventsCal("Practice")] }));
    expect((await call("POST", "/sync/apply", { file: newer })).data).toMatchObject({ changed: true, counts: { events: 1 } });
  });

  it("explains a passphrase mismatch", async () => {
    const call = api();
    await call("PUT", "/sync/settings", { passphrase: PASS });
    const res = await call<{ error: string }>("POST", "/sync/apply", { file: lock(payload(), "a different passphrase entirely") });
    expect(res.status).toBe(400);
    expect(res.data.error).toContain("doesn't match");
    expect(load("sync").lastError).toContain("doesn't match");
    expect(all("SELECT id FROM events")).toEqual([]);
  });

  it("keeps synced events read-only and labels them", async () => {
    const call = api();
    await call("PUT", "/sync/settings", { passphrase: PASS });
    await call("POST", "/sync/apply", { file: lock(payload()) });
    const range = await call<{ events: { id: number; feed_name: string }[] }>(
      "GET",
      "/calendar/events?from=2026-10-05T00:00:00.000Z&to=2026-10-12T00:00:00.000Z",
    );
    expect(range.data.events.map((e) => e.feed_name)).toEqual(["Synced", "Synced"]);
    const id = range.data.events[0].id;
    expect((await call("PATCH", `/calendar/events/${id}`, { title: "Changed" })).status).toBe(400);
    expect((await call("DELETE", `/calendar/events/${id}`)).status).toBe(400);
  });

  it("leaves the passphrase out of backups", async () => {
    const call = api();
    await call("PUT", "/sync/settings", { passphrase: PASS });
    expect(JSON.stringify((await call("GET", "/export")).data)).not.toContain(PASS);
  });
});

describe("the GitHub script", () => {
  let server: http.Server;
  let base: string;
  let outDir: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/school.ics") res.end(homeworkCal);
      else if (req.url === "/apple.ics") res.end(eventsCal("Practice"));
      else if (req.url === "/web.html") res.end("<html>sign in</html>");
      else res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => server.close());

  beforeEach(() => {
    vi.useRealTimers();
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "limitless-sync-"));
  });

  const written = () => JSON.parse(fs.readFileSync(path.join(outDir, "sync", "data.json"), "utf8")) as SyncFile;

  it("downloads, locks and publishes, and its log never shows the links", async () => {
    const env = {
      // A stray newline pasted into the GitHub secret is ignored, as the app ignores one typed on the phone.
      SYNC_PASSPHRASE: `${PASS}\n`,
      SCHOOLOGY_ICAL_URL: `${base}/school.ics`,
      CALENDAR_ICAL_URL: `${base}/apple.ics\n${base}/missing.ics, ${base}/web.html`,
    };
    const log = await main(outDir, env);
    expect(log).not.toContain(base);
    expect(log).not.toContain("127.0.0.1");
    expect(log).toContain("Calendar 2: the calendar link returned HTTP 404");
    expect(log).toContain("Calendar 3: the link didn't return a calendar");

    const file = written();
    expect(file.iterations).toBe(600_000);
    expect(JSON.stringify(file)).not.toContain("Practice");
    const p = await decryptSyncFile(file, PASS);
    expect(p.homework).toEqual([homeworkCal]);
    expect(p.events).toEqual([eventsCal("Practice")]);
    expect(p.errors.map((e) => [e.kind, e.source])).toEqual([
      ["events", "Calendar 2"],
      ["events", "Calendar 3"],
    ]);
    expect(JSON.stringify(p.errors)).not.toContain(base);
  });

  it("publishes nothing without a passphrase, or with one that's too short", async () => {
    expect(await main(outDir, { CALENDAR_ICAL_URL: `${base}/apple.ics` })).toContain("skipping");
    expect(await main(outDir, { SYNC_PASSPHRASE: "short", CALENDAR_ICAL_URL: `${base}/apple.ics` })).toContain("nothing was published");
    expect(fs.existsSync(path.join(outDir, "sync"))).toBe(false);
  });

  it("uses only Node's built-in modules, so no outside package runs next to your links", () => {
    const source = fs.readFileSync(new URL("../../../scripts/sync-calendars.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.every((i) => i.startsWith("node:"))).toBe(true);
  });

  it("reads several links and turns webcal:// into https://", () => {
    expect(calendarLinks(" webcal://p01-caldav.icloud.com/published/2/abc \nhttps://a.schoology.com/calendar/feed/ical/1/x.ics,webcals://b/c\n")).toEqual([
      "https://p01-caldav.icloud.com/published/2/abc",
      "https://a.schoology.com/calendar/feed/ical/1/x.ics",
      "https://b/c",
    ]);
    expect(calendarLinks(undefined)).toEqual([]);
  });

  it("says a link couldn't be reached without printing it", async () => {
    const log = await main(outDir, { SYNC_PASSPHRASE: PASS, CALENDAR_ICAL_URL: "http://127.0.0.1:9/cal.ics" });
    expect(log).toContain("couldn't reach the calendar");
    expect(log).not.toContain("127.0.0.1");
  });
});

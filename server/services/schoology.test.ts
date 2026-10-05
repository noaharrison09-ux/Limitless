import { beforeEach, describe, expect, it } from "vitest";
import { get, run } from "../db.ts";
import { freshDb } from "../test/helpers.ts";
import { itemsFromIcs, oauthSignature, percentEncode, upsertImported } from "./schoology.ts";

describe("OAuth 1.0a signing", () => {
  it("matches the published reference signature", () => {
    // Reference request from Twitter's "Creating a signature" documentation.
    const { signature } = oauthSignature({
      method: "POST",
      url: "https://api.twitter.com/1.1/statuses/update.json?include_entities=true",
      consumerKey: "xvz1evFS4wEEPTGEFPHBog",
      consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
      token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
      tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
      nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
      timestamp: "1318622958",
      bodyParams: { status: "Hello Ladies + Gentlemen, a signed OAuth request!" },
    });
    expect(signature).toBe("hCtSmYh+iHYCEqBWrE7C7hYmtUk=");
  });

  it("percent-encodes per RFC 3986", () => {
    expect(percentEncode("a b!*'()")).toBe("a%20b%21%2A%27%28%29");
  });
});

describe("Schoology import", () => {
  beforeEach(() => freshDb());

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:sgy-1",
    "SUMMARY:Lab report",
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

  it("maps feed events to homework, keyed by assignment id when present", () => {
    const items = itemsFromIcs(ics, Date.parse("2026-10-05T12:00:00Z"));
    expect(items).toEqual([
      expect.objectContaining({ externalId: "assignment:987654", title: "Lab report", dueAt: "2026-10-07T03:59:00.000Z", allDay: false }),
      // All-day due dates become 11:59 PM local.
      expect.objectContaining({ externalId: "ical:sgy-2", title: "Reading quiz", dueAt: "2026-10-10T03:59:00.000Z", allDay: true }),
    ]);
  });

  it("queues new items for approval and keeps your status on re-import", () => {
    const item = { externalId: "assignment:1", title: "Essay", course: null, dueAt: "2026-10-08T03:59:00.000Z", allDay: false, url: null, notes: null };
    expect(upsertImported(item, false)).toBe("new");
    const row = get<{ id: number; approval: string }>("SELECT id, approval FROM homework WHERE external_id = 'assignment:1'")!;
    expect(row.approval).toBe("pending");

    run("UPDATE homework SET approval = 'approved', status = 'done' WHERE id = ?", row.id);
    expect(upsertImported({ ...item, title: "Essay (revised)", course: "English" }, false)).toBe("updated");
    expect(get("SELECT title, course, approval, status FROM homework WHERE id = ?", row.id)).toEqual(
      expect.objectContaining({ title: "Essay (revised)", course: "English", approval: "approved", status: "done" }),
    );
  });

  it("skips the queue when auto-approve is on", () => {
    upsertImported({ externalId: "assignment:2", title: "Quiz", course: null, dueAt: null, allDay: false, url: null, notes: null }, true);
    expect(get<{ approval: string }>("SELECT approval FROM homework WHERE external_id = 'assignment:2'")!.approval).toBe("approved");
  });
});

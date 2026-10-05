import { describe, expect, it } from "vitest";
import { parseIcs } from "./ical.ts";

const wrap = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n${body}\r\nEND:VCALENDAR\r\n`;
const W0 = new Date("2026-09-01T00:00:00Z");
const W1 = new Date("2026-12-31T00:00:00Z");

describe("parseIcs", () => {
  it("converts TZID times using IANA rules even without a VTIMEZONE block", () => {
    const events = parseIcs(
      wrap(`BEGIN:VEVENT\r\nUID:a1\r\nSUMMARY:Practice\r\nDTSTART;TZID=America/New_York:20261006T154500\r\nDTEND;TZID=America/New_York:20261006T173000\r\nLOCATION:North field\r\nEND:VEVENT`),
      W0,
      W1,
      "America/Chicago",
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      uid: "a1",
      title: "Practice",
      start: "2026-10-06T19:45:00.000Z",
      end: "2026-10-06T21:30:00.000Z",
      allDay: false,
      location: "North field",
    });
  });

  it("handles UTC and floating times", () => {
    const events = parseIcs(
      wrap(
        `BEGIN:VEVENT\r\nUID:u\r\nSUMMARY:UTC\r\nDTSTART:20261010T120000Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:f\r\nSUMMARY:Floating\r\nDTSTART:20261011T090000\r\nEND:VEVENT`,
      ),
      W0,
      W1,
      "America/New_York",
    );
    expect(events.map((e) => [e.uid, e.start])).toEqual([
      ["u", "2026-10-10T12:00:00.000Z"],
      ["f", "2026-10-11T13:00:00.000Z"],
    ]);
  });

  it("marks all-day events and anchors them to local midnight", () => {
    const [ev] = parseIcs(
      wrap(`BEGIN:VEVENT\r\nUID:d\r\nSUMMARY:No school\r\nDTSTART;VALUE=DATE:20261012\r\nDTEND;VALUE=DATE:20261013\r\nEND:VEVENT`),
      W0,
      W1,
      "America/New_York",
    );
    expect(ev.allDay).toBe(true);
    expect(ev.date).toBe("2026-10-12");
    expect(ev.start).toBe("2026-10-12T04:00:00.000Z");
    expect(ev.end).toBe("2026-10-13T04:00:00.000Z");
  });

  it("expands weekly recurrences, honoring EXDATE and moved instances", () => {
    const events = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:weekly",
          "SUMMARY:Study group",
          "DTSTART;TZID=America/New_York:20261001T190000",
          "DTEND;TZID=America/New_York:20261001T200000",
          "RRULE:FREQ=WEEKLY;COUNT=4",
          "EXDATE;TZID=America/New_York:20261008T190000",
          "END:VEVENT",
          "BEGIN:VEVENT",
          "UID:weekly",
          "RECURRENCE-ID;TZID=America/New_York:20261015T190000",
          "SUMMARY:Study group (moved)",
          "DTSTART;TZID=America/New_York:20261016T180000",
          "DTEND;TZID=America/New_York:20261016T190000",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      W0,
      W1,
      "America/New_York",
    );
    expect(events.map((e) => [e.title, e.start])).toEqual([
      ["Study group", "2026-10-01T23:00:00.000Z"],
      ["Study group (moved)", "2026-10-16T22:00:00.000Z"],
      ["Study group", "2026-10-22T23:00:00.000Z"],
    ]);
    expect(events.every((e) => e.uid === "weekly" && e.recurring)).toBe(true);
  });

  it("skips cancelled events and events outside the window", () => {
    const events = parseIcs(
      wrap(
        `BEGIN:VEVENT\r\nUID:c\r\nSUMMARY:Cancelled\r\nSTATUS:CANCELLED\r\nDTSTART:20261010T120000Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:old\r\nSUMMARY:Old\r\nDTSTART:20250101T120000Z\r\nEND:VEVENT`,
      ),
      W0,
      W1,
      "UTC",
    );
    expect(events).toEqual([]);
  });
});

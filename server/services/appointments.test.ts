import { beforeEach, describe, expect, it } from "vitest";
import { all, get } from "../db.ts";
import { save } from "../settings.ts";
import { freshDb } from "../test/helpers.ts";
import { appointmentFromText, appointmentTitle, appointmentsFromInvites, stripQuoted } from "./appointments.ts";
import { processMessage, type Rule } from "./email.ts";

const ZONE = "America/New_York";
const RECEIVED = new Date("2026-10-05T14:00:00Z"); // Monday 10:00 AM in New York

const mail = (over: Partial<Parameters<typeof appointmentFromText>[0]> = {}) => ({
  subject: "Your appointment is confirmed",
  text: "Hi Noa,\n\nYour appointment is confirmed for Tuesday, October 14 at 3:30 PM.\nLocation: 12 Main St, Suite 4\n\nSee you then!",
  fromName: "Bright Smiles Dental",
  fromAddr: "frontdesk@brightsmiles.com",
  bulk: false,
  ...over,
});

describe("appointmentFromText", () => {
  it("reads a typical confirmation", () => {
    expect(appointmentFromText(mail(), RECEIVED, ZONE)).toEqual({
      uid: null,
      title: "Appointment · Bright Smiles Dental",
      start: "2026-10-14T19:30:00.000Z",
      end: "2026-10-14T20:30:00.000Z",
      allDay: false,
      location: "12 Main St, Suite 4",
      via: "text",
    });
  });

  it("resolves relative days from when the email arrived, in your timezone", () => {
    const a = appointmentFromText(mail({ subject: "Reminder: your visit", text: "See you tomorrow at 2pm for your cleaning." }), RECEIVED, ZONE);
    expect(a?.start).toBe("2026-10-06T18:00:00.000Z");
  });

  it("honors an explicit timezone and a time range", () => {
    const a = appointmentFromText(mail({ text: "Your interview is Oct 20 from 1:00 PM to 1:45 PM PST." }), RECEIVED, ZONE);
    expect(a).toMatchObject({ start: "2026-10-20T21:00:00.000Z", end: "2026-10-20T21:45:00.000Z" });
  });

  it("uses an all-day slot when an appointment has a date but no time", () => {
    const a = appointmentFromText(mail({ text: "Your appointment is on October 22." }), RECEIVED, ZONE);
    expect(a).toMatchObject({ allDay: true, start: "2026-10-22T04:00:00.000Z" });
  });

  it("ignores promos, past dates, quoted replies, and non-appointment mail", () => {
    expect(appointmentFromText(mail({ subject: "Fall sale!", text: "Book your appointment by Oct 30 at 5pm and save", bulk: true }), RECEIVED, ZONE)).toBeNull();
    expect(appointmentFromText(mail({ text: "Thanks for your appointment on September 2 at 3pm." }), RECEIVED, ZONE)).toBeNull();
    expect(appointmentFromText(mail({ subject: "Lunch?", text: "Want to grab lunch Friday at noon?" }), RECEIVED, ZONE)).toBeNull();
    const quoted = "Sounds good.\n\nOn Mon, Oct 5, 2026 at 9:00 AM Clinic <c@x.com> wrote:\n> Your appointment is Oct 30 at 4pm";
    expect(appointmentFromText(mail({ subject: "Re: appointment", text: quoted }), RECEIVED, ZONE)).toBeNull();
  });
});

describe("helpers", () => {
  it("keeps specific subjects and names generic ones after the sender", () => {
    expect(appointmentTitle("Re: Interview with Acme Corp", "Jane", "jane@acme.com")).toBe("Interview with Acme Corp");
    expect(appointmentTitle("Reminder: Your upcoming appointment", "", "noreply@zocdoc.com")).toBe("Appointment · Zocdoc");
    expect(appointmentTitle("Booking confirmed", "Barber Shop", "x@y.com")).toBe("Booking · Barber Shop");
  });

  it("strips quoted replies", () => {
    expect(stripQuoted("Yes!\n> old line\nOn Fri, Oct 2 Bob <b@x.com> wrote:\nolder")).toBe("Yes!");
  });

  it("reads calendar invites and cancellations", () => {
    const ics = (method: string, uid: string) =>
      Buffer.from(
        `BEGIN:VCALENDAR\r\nMETHOD:${method}\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:Physical therapy\r\nDTSTART;TZID=America/New_York:20261016T090000\r\nDTEND;TZID=America/New_York:20261016T100000\r\nLOCATION:Room 3\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`,
      );
    const { found } = appointmentsFromInvites([{ contentType: "text/calendar", content: ics("REQUEST", "pt-1") }], RECEIVED, ZONE);
    expect(found).toEqual([
      { uid: "pt-1", title: "Physical therapy", start: "2026-10-16T13:00:00.000Z", end: "2026-10-16T14:00:00.000Z", allDay: false, location: "Room 3", via: "invite" },
    ]);
    const cancel = appointmentsFromInvites([{ filename: "invite.ics", content: ics("CANCEL", "pt-1") }], RECEIVED, ZONE);
    expect(cancel).toEqual({ found: [], cancelledUids: ["pt-1"] });
  });
});

/* ---------- Whole pipeline: raw email in, calendar + notification out ---------- */

function rfc822(opts: { id: string; from: string; subject: string; text: string; ics?: string; bulk?: boolean }): Buffer {
  const headers = [
    `From: ${opts.from}`,
    "To: noa@example.com",
    `Subject: ${opts.subject}`,
    "Date: Mon, 05 Oct 2026 10:00:00 -0400",
    `Message-ID: <${opts.id}@test>`,
    "MIME-Version: 1.0",
    ...(opts.bulk ? ["List-Unsubscribe: <mailto:unsub@example.com>"] : []),
  ];
  if (!opts.ics) return Buffer.from([...headers, "Content-Type: text/plain; charset=utf-8", "", opts.text].join("\r\n"));
  return Buffer.from(
    [
      ...headers,
      'Content-Type: multipart/mixed; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain; charset=utf-8",
      "",
      opts.text,
      "--b1",
      'Content-Type: text/calendar; charset=utf-8; method=REQUEST; name="invite.ics"',
      'Content-Disposition: attachment; filename="invite.ics"',
      "",
      opts.ics,
      "--b1--",
    ].join("\r\n"),
  );
}

const invite = (method: string, start: string) =>
  [
    "BEGIN:VCALENDAR",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    "UID:ortho-77",
    "SUMMARY:Orthodontist adjustment",
    `DTSTART;TZID=America/New_York:${start}`,
    "LOCATION:Smile Ortho",
    method === "CANCEL" ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

describe("processMessage", () => {
  const account = { id: 1 };
  const noRules: Rule[] = [];

  beforeEach(() => {
    freshDb(ZONE);
    // processMessage stores emails under an account row.
    get("INSERT INTO email_accounts (id, label, host, username, password_enc) VALUES (1, 'me', 'imap.example.com', 'me', 'x') RETURNING id");
  });

  const events = () => all<{ title: string; start: string; status: string; uid: string | null }>("SELECT title, start, status, uid FROM events ORDER BY start");
  const notices = () => all<{ title: string; url: string }>("SELECT title, url FROM notifications ORDER BY id");

  it("turns a calendar invite into a pending appointment, follows updates, and removes cancellations", async () => {
    await processMessage(account, rfc822({ id: "a1", from: "Smile Ortho <office@smileortho.com>", subject: "Invitation", text: "See attached.", ics: invite("REQUEST", "20261016T090000") }), [], null, noRules);
    expect(events()).toEqual([{ title: "Orthodontist adjustment", start: "2026-10-16T13:00:00.000Z", status: "pending", uid: "ortho-77" }]);
    expect(notices()).toEqual([{ title: "📅 Appointment: Orthodontist adjustment", url: "/approvals" }]);

    // You approve it, then the office moves it: the time updates and it stays approved.
    get("UPDATE events SET status = 'approved' RETURNING id");
    await processMessage(account, rfc822({ id: "a2", from: "Smile Ortho <office@smileortho.com>", subject: "Updated invitation", text: "New time.", ics: invite("REQUEST", "20261016T110000") }), [], null, noRules);
    expect(events()).toEqual([{ title: "Orthodontist adjustment", start: "2026-10-16T15:00:00.000Z", status: "approved", uid: "ortho-77" }]);

    await processMessage(account, rfc822({ id: "a3", from: "Smile Ortho <office@smileortho.com>", subject: "Cancelled", text: "Cancelled.", ics: invite("CANCEL", "20261016T110000") }), [], null, noRules);
    expect(events()).toEqual([]);
    expect(notices().at(-1)).toEqual({ title: "❌ Cancelled: Orthodontist adjustment", url: "/calendar" });
  });

  it("reads plain-text confirmations, keeps the email readable, and skips the reminder duplicate", async () => {
    const text = "Hi Noa,\n\nYour appointment is confirmed for Tuesday, October 14 at 3:30 PM.\nLocation: 12 Main St\n";
    await processMessage(account, rfc822({ id: "d1", from: "Bright Smiles Dental <frontdesk@brightsmiles.com>", subject: "Your appointment is confirmed", text }), [], null, noRules);
    expect(events()).toEqual([expect.objectContaining({ title: "Appointment · Bright Smiles Dental", start: "2026-10-14T19:30:00.000Z", status: "pending" })]);
    const saved = get<{ reason: string; body: string; read: number }>("SELECT reason, body, read FROM important_emails");
    expect(saved).toMatchObject({ reason: "📅 Appointment", read: 1 });
    expect(saved!.body).toContain("October 14 at 3:30 PM");

    await processMessage(account, rfc822({ id: "d2", from: "Bright Smiles Dental <frontdesk@brightsmiles.com>", subject: "Appointment reminder", text }), [], null, noRules);
    expect(events()).toHaveLength(1);
  });

  it("adds straight to the calendar when auto-approve is on, and respects block rules", async () => {
    save("appointments", { enabled: true, autoApprove: true });
    await processMessage(account, rfc822({ id: "e1", from: "Coach <coach@school.org>", subject: "Interview scheduled", text: "Your interview is Oct 20 at 4pm." }), [], null, noRules);
    expect(events()).toEqual([expect.objectContaining({ status: "approved" })]);
    expect(notices()[0].title).toMatch(/^📅 Added:/);

    const block: Rule[] = [{ id: 1, field: "block", pattern: "spam.com", label: null, enabled: 1 }];
    await processMessage(account, rfc822({ id: "e2", from: "x@spam.com", subject: "Appointment confirmed", text: "Oct 21 at 3pm" }), [], null, block);
    expect(events()).toHaveLength(1);
  });

  it("does nothing with appointment reading turned off", async () => {
    save("appointments", { enabled: false, autoApprove: false });
    await processMessage(account, rfc822({ id: "f1", from: "Clinic <c@clinic.com>", subject: "Appointment confirmed", text: "Oct 14 at 3pm" }), [], null, noRules);
    expect(events()).toEqual([]);
    expect(all("SELECT * FROM important_emails")).toEqual([]);
  });
});

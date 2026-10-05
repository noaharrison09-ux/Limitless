import * as chrono from "chrono-node";
import { DateTime, FixedOffsetZone, type Zone } from "luxon";
import { parseIcs } from "./ical.ts";

/** An appointment found in an email, ready to become a (pending) calendar event. */
export type FoundAppointment = {
  /** Invite UID when the email carried a calendar invite, so updates replace the old version. */
  uid: string | null;
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  location: string | null;
  via: "invite" | "ai" | "text";
};

export type Attachment = { contentType?: string; filename?: string; content: Buffer };

type Candidate = { start: DateTime; end: DateTime | null; timed: boolean };

const STRONG = /\b(appointments?|appts?|reservations?|bookings?|booked|interview|consultation|check-?up|orientation|tee time)\b/i;
const WEAK = /\b(scheduled|confirmed|confirmation|visit|session|lesson|meeting|reminder|see you)\b/i;

export function appointmentSignals(subject: string, text: string): { strong: boolean; any: boolean } {
  const strong = STRONG.test(subject) || STRONG.test(text.slice(0, 4000));
  return { strong, any: strong || WEAK.test(subject) };
}

/** Drops quoted replies and forwarded headers so we don't pick up dates from older messages. */
export function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) continue;
    if (/^\s*On .{6,120} wrote:\s*$/i.test(line)) break;
    if (/^-{2,}\s*(Original Message|Forwarded message)\s*-{2,}/i.test(line)) break;
    if (/^\s*From:\s.+/i.test(line) && out.length > 3) break;
    out.push(line);
  }
  return out.join("\n");
}

function sender(fromName: string, fromAddr: string): string {
  const name = fromName.replace(/\s*\(.*?\)\s*/g, " ").replace(/\b(no-?reply|notifications?)\b/gi, "").trim();
  if (name) return name;
  const domain = fromAddr.split("@")[1]?.split(".").slice(-2, -1)[0] ?? "";
  return domain ? domain.charAt(0).toUpperCase() + domain.slice(1) : "Email";
}

const GENERIC =
  /^(your\s+)?(upcoming\s+)?(appointment|appt|booking|reservation|visit|session)(\s+(confirmation|reminder|request|details|update|is confirmed|confirmed|has been (confirmed|scheduled|booked|updated)))?[.!]*$/i;

/** "Your appointment is confirmed" -> "Appointment · Bright Smiles Dental"; specific subjects are kept. */
export function appointmentTitle(subject: string, fromName: string, fromAddr: string): string {
  let s = subject.replace(/^((re|fwd?|fw)\s*:\s*)+/i, "").trim();
  s = s.replace(/^(reminder|confirmation|confirmed|update|updated|new)\s*[:\-–]\s*/i, "").trim();
  if (!s || GENERIC.test(s)) {
    const noun = (s.match(/appointment|booking|reservation|visit|session/i)?.[0] ?? "appointment").toLowerCase();
    return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} · ${sender(fromName, fromAddr)}`;
  }
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

export function findLocation(text: string): string | null {
  const m = text.match(/^\s*(location|where|address|place|clinic|office|venue)\s*[:\-–]\s*(.{3,160})$/im);
  return m ? m[2].trim() : null;
}

/** Reads calendar invites (.ics parts) attached to an email; cancellations are reported separately. */
export function appointmentsFromInvites(
  attachments: Attachment[],
  received: Date,
  zone: string,
): { found: FoundAppointment[]; cancelledUids: string[] } {
  const found: FoundAppointment[] = [];
  const cancelledUids: string[] = [];
  for (const a of attachments) {
    const type = (a.contentType ?? "").toLowerCase();
    if (!type.includes("calendar") && !type.includes("ics") && !/\.ics$/i.test(a.filename ?? "")) continue;
    const text = a.content.toString("utf8");
    if (!text.includes("BEGIN:VCALENDAR")) continue;
    if (/^METHOD:CANCEL/im.test(text)) {
      for (const m of text.matchAll(/^UID:(.+)$/gim)) cancelledUids.push(m[1].trim());
      continue;
    }
    try {
      const from = new Date(received.getTime() - 86_400_000);
      const to = new Date(received.getTime() + 400 * 86_400_000);
      for (const ev of parseIcs(text, from, to, zone)) {
        found.push({ uid: ev.uid, title: ev.title, start: ev.start, end: ev.end, allDay: ev.allDay, location: ev.location, via: "invite" });
      }
    } catch {
      // A malformed invite shouldn't stop the rest of the email from being read.
    }
  }
  return { found, cancelledUids };
}

/** Turns the AI's {date, time} answer into an appointment in the user's timezone. */
export function appointmentFromAi(
  ev: { title: string; date: string; time: string | null; location: string | null } | null,
  zone: string,
): FoundAppointment | null {
  if (!ev || !/^\d{4}-\d{2}-\d{2}$/.test(ev.date)) return null;
  const timed = !!ev.time && /^\d{2}:\d{2}$/.test(ev.time);
  const start = DateTime.fromISO(`${ev.date}T${timed ? ev.time : "00:00"}`, { zone });
  if (!start.isValid) return null;
  return {
    uid: null,
    title: ev.title.trim() || "Appointment",
    start: start.toUTC().toISO()!,
    end: (timed ? start.plus({ hours: 1 }) : start.plus({ days: 1 })).toUTC().toISO()!,
    allDay: !timed,
    location: ev.location,
    via: "ai",
  };
}

/**
 * Finds "your appointment is Tuesday, Oct 14 at 3:30 PM" style dates in plain email text.
 * Only used when the email looks like an appointment; picks the first future date it finds.
 */
export function appointmentFromText(
  email: { subject: string; text: string; fromName: string; fromAddr: string; bulk: boolean },
  received: Date,
  zone: string,
): FoundAppointment | null {
  const signals = appointmentSignals(email.subject, email.text);
  if (!signals.any) return null;
  // Mailing-list mail needs a strong word like "appointment" in the subject (skips "book now!" promos).
  if (email.bulk && !STRONG.test(email.subject)) return null;

  const body = stripQuoted(email.text).slice(0, 6000);
  const offset = DateTime.fromJSDate(received).setZone(zone).offset;
  const results = chrono.parse(`${email.subject}\n${body}`, { instant: received, timezone: offset }, { forwardDate: true });

  const earliest = received.getTime() - 60 * 60 * 1000;
  const latest = received.getTime() + 400 * 86_400_000;
  const candidates = results
    .map((r): Candidate | null => {
      const s = r.start;
      if (!s.isCertain("day") && !s.isCertain("weekday")) return null;
      const timed = s.isCertain("hour");
      // An explicit zone in the email ("9:15am EST") wins; otherwise use the user's own zone.
      const tz: Zone | string = s.isCertain("timezoneOffset") ? FixedOffsetZone.instance(s.get("timezoneOffset") ?? 0) : zone;
      const start = DateTime.fromObject(
        { year: s.get("year")!, month: s.get("month")!, day: s.get("day")!, hour: timed ? s.get("hour")! : 0, minute: timed ? (s.get("minute") ?? 0) : 0 },
        { zone: tz },
      );
      if (!start.isValid || start.toMillis() < earliest || start.toMillis() > latest) return null;
      // Without a stated year, the parser rolls past dates into next year ("thanks for coming
      // Sept 2" -> next Sept 2). Real bookings are rarely that far out, so cap those at ~6 months.
      if (!s.isCertain("year") && start.toMillis() > received.getTime() + 183 * 86_400_000) return null;
      let end: DateTime | null = null;
      if (timed && r.end?.isCertain("hour")) {
        const e = r.end;
        end = DateTime.fromObject(
          { year: e.get("year")!, month: e.get("month")!, day: e.get("day")!, hour: e.get("hour")!, minute: e.get("minute") ?? 0 },
          { zone: tz },
        );
        if (!end.isValid || end <= start) end = null;
      }
      return { start, end, timed };
    })
    .filter((c): c is Candidate => c !== null);

  // Prefer a date with a time; a date alone only counts for clearly-appointment emails.
  const pick = candidates.find((c) => c.timed) ?? (signals.strong ? candidates[0] : undefined);
  if (!pick) return null;

  const start = pick.timed ? pick.start : pick.start.setZone(zone, { keepLocalTime: true }).startOf("day");
  return {
    uid: null,
    title: appointmentTitle(email.subject, email.fromName, email.fromAddr),
    start: start.toUTC().toISO()!,
    end: (pick.end ?? (pick.timed ? start.plus({ hours: 1 }) : start.plus({ days: 1 }))).toUTC().toISO()!,
    allDay: !pick.timed,
    location: findLocation(body),
    via: "text",
  };
}

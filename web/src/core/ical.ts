import ICAL from "ical.js";
import { DateTime } from "luxon";

type ITime = InstanceType<typeof ICAL.Time>;
type IEvent = InstanceType<typeof ICAL.Event>;
type IComponent = InstanceType<typeof ICAL.Component>;

export type ParsedEvent = {
  /** Base UID of the event (shared by every occurrence of a recurring series). */
  uid: string;
  title: string;
  /** UTC ISO instant. All-day events start at local midnight in `zone`. */
  start: string;
  end: string | null;
  allDay: boolean;
  /** For all-day events, the calendar date (YYYY-MM-DD). */
  date: string | null;
  location: string | null;
  description: string | null;
  url: string | null;
  recurring: boolean;
};

const MAX_ITERATIONS = 20000;

function tzidOf(component: IComponent, prop: string): string | null {
  const p = component.getFirstProperty(prop);
  const tzid = p?.getParameter("tzid");
  return typeof tzid === "string" ? tzid : null;
}

/** Converts an ICAL.Time to a UTC ISO string, preferring IANA zone rules when the TZID is a known zone. */
function toIso(t: ITime, tzid: string | null, zone: string): { iso: string; date: string | null } {
  if (t.isDate) {
    const date = `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
    return { iso: DateTime.fromISO(date, { zone }).toUTC().toISO()!, date };
  }
  if (t.zone === ICAL.Timezone.utcTimezone) return { iso: t.toJSDate().toISOString(), date: null };
  const wall = { year: t.year, month: t.month, day: t.day, hour: t.hour, minute: t.minute, second: t.second };
  if (tzid && DateTime.local().setZone(tzid).isValid) {
    return { iso: DateTime.fromObject(wall, { zone: tzid }).toUTC().toISO()!, date: null };
  }
  if (t.zone && t.zone !== ICAL.Timezone.localTimezone) {
    return { iso: new Date(t.toUnixTime() * 1000).toISOString(), date: null };
  }
  // Floating time (or unknown TZID): interpret in the user's timezone.
  return { iso: DateTime.fromObject(wall, { zone }).toUTC().toISO()!, date: null };
}

function clean(s: string | null | undefined): string | null {
  const v = (s ?? "").trim();
  return v ? v : null;
}

function urlOf(component: IComponent): string | null {
  const v = component.getFirstPropertyValue("url");
  return typeof v === "string" ? clean(v) : null;
}

/**
 * Parses an iCalendar feed and expands recurring events into individual
 * occurrences that overlap [windowStart, windowEnd].
 */
export function parseIcs(text: string, windowStart: Date, windowEnd: Date, zone: string): ParsedEvent[] {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const vtz of root.getAllSubcomponents("vtimezone")) {
    try {
      ICAL.TimezoneService.register(vtz);
    } catch {
      // A malformed VTIMEZONE shouldn't sink the whole feed; IANA lookup covers most cases.
    }
  }

  const masters: IEvent[] = [];
  const exceptions = new Map<string, IEvent[]>();
  for (const ve of root.getAllSubcomponents("vevent")) {
    const ev = new ICAL.Event(ve);
    if (!ev.uid || !ev.startDate) continue;
    if (ev.isRecurrenceException()) {
      const list = exceptions.get(ev.uid) ?? [];
      list.push(ev);
      exceptions.set(ev.uid, list);
    } else {
      masters.push(ev);
    }
  }

  const out: ParsedEvent[] = [];
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();

  const emit = (ev: IEvent, item: IEvent, start: ITime, end: ITime | null, recurring: boolean) => {
    const s = toIso(start, tzidOf(item.component, "dtstart"), zone);
    const e = end ? toIso(end, tzidOf(item.component, "dtend") ?? tzidOf(item.component, "dtstart"), zone) : null;
    const sMs = Date.parse(s.iso);
    const eMs = e ? Date.parse(e.iso) : sMs;
    if (eMs < startMs || sMs > endMs) return;
    if (item.component.getFirstPropertyValue("status") === "CANCELLED") return;
    out.push({
      uid: ev.uid,
      title: clean(item.summary) ?? "(untitled)",
      start: s.iso,
      end: e?.iso ?? null,
      allDay: start.isDate,
      date: s.date,
      location: clean(item.location),
      description: clean(item.description),
      url: urlOf(item.component),
      recurring,
    });
  };

  for (const ev of masters) {
    for (const exc of exceptions.get(ev.uid) ?? []) ev.relateException(exc);
    if (!ev.isRecurring()) {
      emit(ev, ev, ev.startDate, ev.endDate ?? null, false);
      continue;
    }
    const it = ev.iterator();
    let next: ITime | null;
    let n = 0;
    while ((next = it.next()) && n++ < MAX_ITERATIONS) {
      if (next.toJSDate().getTime() > endMs + 86_400_000) break;
      const details = ev.getOccurrenceDetails(next);
      emit(ev, details.item, details.startDate, details.endDate ?? null, true);
    }
  }

  // Exceptions whose master isn't in the feed (rare) still get shown.
  const masterUids = new Set(masters.map((m) => m.uid));
  for (const [uid, list] of exceptions) {
    if (masterUids.has(uid)) continue;
    for (const ev of list) emit(ev, ev, ev.startDate, ev.endDate ?? null, true);
  }

  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** Downloads a feed; accepts webcal:// links as copied from Google/Apple/Schoology. */
export async function fetchIcs(url: string): Promise<string> {
  const href = url.trim().replace(/^webcals?:\/\//i, "https://");
  const res = await fetch(href, {
    headers: { "User-Agent": "Limitless/1.0 (personal calendar sync)", Accept: "text/calendar, */*" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Calendar feed returned HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes("BEGIN:VCALENDAR")) throw new Error("That link didn't return an iCal calendar");
  return text;
}

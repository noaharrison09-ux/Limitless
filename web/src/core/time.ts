import { DateTime } from "luxon";
import { load } from "./settings.ts";

function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Your timezone: the one set in Settings, otherwise this phone's own. */
export function zone(): string {
  return load("prefs").timezone || deviceZone();
}

export function nowLocal(): DateTime {
  return DateTime.now().setZone(zone());
}

/** Today's date (YYYY-MM-DD) in the user's timezone. */
export function todayStr(): string {
  return nowLocal().toISODate()!;
}

export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: zone() }).plus({ days }).toISODate()!;
}

/** UTC ISO instant for a wall-clock time on a local date, e.g. ("2026-10-05", "23:59"). */
export function localToUtcIso(date: string, time = "00:00"): string {
  return DateTime.fromISO(`${date}T${time}`, { zone: zone() }).toUTC().toISO()!;
}

/** Local date (YYYY-MM-DD) of a UTC instant. */
export function localDateOf(iso: string): string {
  return DateTime.fromISO(iso).setZone(zone()).toISODate()!;
}

export function formatLocalTime(iso: string): string {
  return DateTime.fromISO(iso).setZone(zone()).toFormat("h:mm a");
}

export function formatLocalDay(iso: string): string {
  return DateTime.fromISO(iso).setZone(zone()).toFormat("ccc LLL d");
}

/** Bounds (UTC ISO) of a local calendar day. */
export function dayBoundsUtc(date: string): { start: string; end: string } {
  const start = DateTime.fromISO(date, { zone: zone() }).startOf("day");
  return { start: start.toUTC().toISO()!, end: start.plus({ days: 1 }).toUTC().toISO()! };
}

export function isValidZone(name: string): boolean {
  return DateTime.now().setZone(name).isValid;
}

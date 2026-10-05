const pad = (n: number) => String(n).padStart(2, "0");

export function dateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayStr(): string {
  return dateStr(new Date());
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: string, n: number): string {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return dateStr(d);
}

export function timeStr(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function fmtDay(s: string, opts: { long?: boolean } = {}): string {
  const today = todayStr();
  if (s === today) return "Today";
  if (s === addDays(today, 1)) return "Tomorrow";
  if (s === addDays(today, -1)) return "Yesterday";
  return parseDate(s).toLocaleDateString([], {
    weekday: opts.long ? "long" : "short",
    month: "short",
    day: "numeric",
  });
}

export function fmtLongDate(s: string): string {
  return parseDate(s).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

/** "Today 8:00 AM", "Tomorrow", "Wed, Oct 7 · 11:59 PM" */
export function fmtDue(iso: string | null, allDay: number | boolean): string {
  if (!iso) return "No due date";
  const d = new Date(iso);
  const day = fmtDay(dateStr(d));
  return allDay ? day : `${day} · ${fmtTime(iso)}`;
}

export function isOverdue(iso: string | null, allDay: number | boolean): boolean {
  if (!iso) return false;
  if (allDay) return dateStr(new Date(iso)) < todayStr();
  return new Date(iso).getTime() < Date.now();
}

export function ago(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function greeting(hour: number): string {
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

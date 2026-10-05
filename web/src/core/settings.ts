import { getSetting, setSetting } from "./db.ts";

export type Prefs = {
  name: string;
  /** IANA timezone. Empty means "use this device's timezone". */
  timezone: string;
  units: "lb" | "kg";
};

export type BulkSettings = {
  goalWeight: number | null;
  startWeight: number | null;
  startDate: string | null;
  /** Target gain per week in the user's units (e.g. 0.5 lb/week for a lean bulk). */
  targetRate: number | null;
  calorieTarget: number | null;
  proteinTarget: number | null;
};

export type TimedReminder = { enabled: boolean; time: string };

/** Times used when you add Limitless reminders to your phone's Calendar app. */
export type ReminderSettings = {
  morningBriefing: TimedReminder;
  weighIn: TimedReminder;
  homeworkEvening: TimedReminder;
  journal: TimedReminder;
  /** Alert this many hours before a timed assignment is due (when added to your phone's calendar). */
  homeworkDueSoon: { enabled: boolean; hours: number };
  /** Alert this many minutes before an event (when added to your phone's calendar). */
  events: { enabled: boolean; minutesBefore: number };
};

/** Calendar auto-sync on this device. Never included in backups (the passphrase stays here). */
export type SyncState = {
  passphrase: string;
  /** When GitHub made the file that was last imported, so the same file isn't imported twice. */
  appliedSyncedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  counts: { homework: number; events: number } | null;
  /** Calendars GitHub couldn't download or the app couldn't read last time. */
  sourceErrors: { source: string; message: string }[];
};

export const defaults = {
  prefs: { name: "", timezone: "", units: "lb" } as Prefs,
  bulk: {
    goalWeight: null,
    startWeight: null,
    startDate: null,
    targetRate: 0.5,
    calorieTarget: null,
    proteinTarget: null,
  } as BulkSettings,
  reminders: {
    morningBriefing: { enabled: true, time: "07:00" },
    weighIn: { enabled: true, time: "07:30" },
    homeworkEvening: { enabled: true, time: "18:00" },
    journal: { enabled: true, time: "21:00" },
    homeworkDueSoon: { enabled: true, hours: 3 },
    events: { enabled: true, minutesBefore: 30 },
  } as ReminderSettings,
  sync: {
    passphrase: "",
    appliedSyncedAt: null,
    lastCheckedAt: null,
    lastError: null,
    counts: null,
    sourceErrors: [],
  } as SyncState,
};

type Defaults = typeof defaults;

export function load<K extends keyof Defaults>(key: K): Defaults[K] {
  return getSetting(key, defaults[key]);
}

export function save<K extends keyof Defaults>(key: K, value: Defaults[K]) {
  setSetting(key, value);
}

export function patch<K extends keyof Defaults>(key: K, partial: Partial<Defaults[K]>): Defaults[K] {
  const next = { ...load(key), ...partial };
  save(key, next);
  return next;
}

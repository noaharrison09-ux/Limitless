import { getSetting, setSetting } from "./db.ts";

export type Prefs = {
  name: string;
  timezone: string;
  /** False until the phone reports its timezone (or the user picks one). */
  timezoneConfirmed: boolean;
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

export type ReminderSettings = {
  morningBriefing: TimedReminder;
  weighIn: TimedReminder;
  homeworkEvening: TimedReminder;
  journal: TimedReminder;
  homeworkDueSoon: { enabled: boolean; hours: number };
  events: { enabled: boolean; minutesBefore: number };
};

export type SchoologySettings = {
  icalUrlEnc: string | null;
  consumerKeyEnc: string | null;
  consumerSecretEnc: string | null;
  lastSynced: string | null;
  lastError: string | null;
  lastImported: number;
  /** Skip the approval queue for Schoology items. */
  autoApprove: boolean;
};

export type AiSettings = {
  enabled: boolean;
  criteria: string;
  apiKeyEnc: string | null;
  /** Let the AI suggest calendar events found in important emails (they go to the approval queue). */
  suggestEvents: boolean;
};

export const defaults = {
  prefs: { name: "", timezone: "America/New_York", timezoneConfirmed: false, units: "lb" } as Prefs,
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
  schoology: {
    icalUrlEnc: null,
    consumerKeyEnc: null,
    consumerSecretEnc: null,
    lastSynced: null,
    lastError: null,
    lastImported: 0,
    autoApprove: false,
  } as SchoologySettings,
  ai: {
    enabled: false,
    criteria:
      "Emails from my teachers, coaches, or school staff; anything about grades, tests, deadlines, schedule changes, college, jobs, or money; and messages from real people who expect a reply. Not newsletters, promotions, or automated notifications.",
    apiKeyEnc: null,
    suggestEvents: true,
  } as AiSettings,
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

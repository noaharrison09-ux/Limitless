/**
 * Calendar auto-sync, phone side. GitHub Actions downloads your calendars every few hours and
 * publishes them locked with your passphrase (see scripts/sync-calendars.ts). This unlocks that
 * file with the passphrase saved on this device and imports it.
 */
import { get, run, tx } from "./db.ts";
import { importEvents, importHomework } from "./calendarFiles.ts";

export const MIN_PASSPHRASE = 16;

export type SyncPayload = {
  v: 1;
  syncedAt: string;
  homework: string[];
  events: string[];
  errors: { kind: "homework" | "events"; source: string; message: string }[];
};

export type SyncFile = { v: 1; syncedAt: string; iterations: number; salt: string; iv: string; data: string };

export function isSyncFile(file: unknown): file is SyncFile {
  const f = file as SyncFile;
  return (
    !!f &&
    f.v === 1 &&
    typeof f.syncedAt === "string" &&
    Number.isInteger(f.iterations) &&
    f.iterations > 0 &&
    [f.salt, f.iv, f.data].every((s) => typeof s === "string")
  );
}

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class PassphraseError extends Error {}

/** Unlocks the synced file (PBKDF2-SHA256 key, AES-256-GCM), matching scripts/sync-calendars.ts. */
export async function decryptSyncFile(file: SyncFile, passphrase: string): Promise<SyncPayload> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("This browser can't unlock synced calendars.");
  const base = await subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const key = await subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: fromBase64(file.salt), iterations: file.iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  let plain: ArrayBuffer;
  try {
    plain = await subtle.decrypt({ name: "AES-GCM", iv: fromBase64(file.iv) }, key, fromBase64(file.data));
  } catch {
    throw new PassphraseError("Your passphrase doesn't match the SYNC_PASSPHRASE secret on GitHub.");
  }
  const payload = JSON.parse(new TextDecoder().decode(plain)) as SyncPayload;
  const texts = (v: unknown) => Array.isArray(v) && v.every((t) => typeof t === "string");
  if (payload?.v !== 1 || !texts(payload.homework) || !texts(payload.events)) throw new Error("The synced file is in a format this version doesn't understand.");
  payload.errors = Array.isArray(payload.errors) ? payload.errors : [];
  return payload;
}

export type ApplyResult = {
  counts: { homework: number; events: number };
  errors: { source: string; message: string }[];
};

function label(name: string, i: number, total: number) {
  return total > 1 ? `${name} ${i + 1}` : name;
}

/**
 * Imports an unlocked file. Homework is added or refreshed (your status and notes are kept).
 * Synced events mirror your calendar, so the previous copies are replaced, unless a calendar
 * couldn't be downloaded this time, in which case the events you already have are kept.
 */
export function applySyncPayload(payload: SyncPayload, now = Date.now()): ApplyResult {
  const errors = payload.errors.map(({ source, message }) => ({ source, message }));
  let homework = 0;
  for (const [i, text] of payload.homework.entries()) {
    try {
      const r = importHomework(text, now);
      homework += r.added + r.updated;
    } catch {
      errors.push({ source: label("Schoology", i, payload.homework.length), message: "the app couldn't read this calendar" });
    }
  }

  const allEventCalendarsArrived = !payload.errors.some((e) => e.kind === "events");
  try {
    tx(() => {
      if (allEventCalendarsArrived) run("DELETE FROM events WHERE source = 'sync'");
      for (const text of payload.events) importEvents(text, now, "sync");
    });
  } catch {
    // Nothing was changed (the whole step rolled back), so the events already here stay.
    errors.push({ source: "Calendar", message: "the app couldn't read this calendar" });
  }
  const events = get<{ n: number }>("SELECT COUNT(*) AS n FROM events WHERE source = 'sync'")?.n ?? 0;
  return { counts: { homework, events }, errors };
}

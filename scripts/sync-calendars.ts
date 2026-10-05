/**
 * Calendar auto-sync, run by GitHub Actions (see .github/workflows/deploy-pages.yml).
 *
 * Downloads your calendar links (kept private in the repo's Actions secrets), locks the
 * result with your passphrase (AES-256-GCM, key from PBKDF2-SHA256), and writes it into the
 * built site as sync/data.json. The site is public, but without the passphrase that file is
 * unreadable. The app on your phone unlocks it with the same passphrase and imports it.
 *
 * Uses only Node's built-in modules, so the workflow can run it without installing any
 * packages: no outside code ever runs alongside your calendar links.
 *
 * Usage: node scripts/sync-calendars.ts <outDir>
 * Env:   SYNC_PASSPHRASE     the passphrase you also type into the app (required)
 *        SCHOOLOGY_ICAL_URL  calendar link(s) imported as homework (one per line)
 *        CALENDAR_ICAL_URL   calendar link(s) imported as events, e.g. Apple Calendar (one per line)
 */
import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const ITERATIONS = 600_000;
/** Anyone can download the locked file, so a short passphrase could be guessed offline. */
export const MIN_PASSPHRASE = 16;

export type SyncPayload = {
  v: 1;
  syncedAt: string;
  homework: string[];
  events: string[];
  /** Calendars that couldn't be downloaded; the app keeps what it already has from those. */
  errors: { kind: "homework" | "events"; source: string; message: string }[];
};

export type SyncFile = {
  v: 1;
  /** Not secret: lets the app skip unlocking a file it has already imported. */
  syncedAt: string;
  iterations: number;
  salt: string;
  iv: string;
  /** Base64 of ciphertext followed by the 16-byte GCM tag (the layout WebCrypto expects). */
  data: string;
};

/**
 * The locked file's size is public, so the contents are padded with spaces (which JSON ignores)
 * up to the next power of two, at least 64 KiB. That way the size doesn't hint at how much is
 * on your calendar.
 */
export function padded(json: string): Buffer {
  const bytes = Buffer.from(json, "utf8");
  let size = 64 * 1024;
  while (size < bytes.length) size *= 2;
  return Buffer.concat([bytes, Buffer.alloc(size - bytes.length, " ")]);
}

export function encryptPayload(payload: SyncPayload, passphrase: string, iterations = ITERATIONS): SyncFile {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(passphrase, salt, iterations, 32, "sha256");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(padded(JSON.stringify(payload))), cipher.final(), cipher.getAuthTag()]);
  return {
    v: 1,
    syncedAt: payload.syncedAt,
    iterations,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    data: data.toString("base64"),
  };
}

/** One or more links separated by new lines, spaces or commas; webcal:// becomes https://. */
export function calendarLinks(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^webcals?:\/\//i, "https://"));
}

/** Downloads one calendar. Error messages never include the link itself (it's a secret). */
async function download(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "Limitless calendar sync", Accept: "text/calendar, */*" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("couldn't reach the calendar (check the link)");
  }
  if (!res.ok) throw new Error(`the calendar link returned HTTP ${res.status}`);
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new Error("the calendar stopped downloading partway");
  }
  if (!text.includes("BEGIN:VCALENDAR")) throw new Error("the link didn't return a calendar");
  return text;
}

export async function buildPayload(env: Record<string, string | undefined>, now = new Date()): Promise<SyncPayload> {
  const payload: SyncPayload = { v: 1, syncedAt: now.toISOString(), homework: [], events: [], errors: [] };
  const sources: [string, "homework" | "events", string[]][] = [
    ["Schoology", "homework", calendarLinks(env.SCHOOLOGY_ICAL_URL)],
    ["Calendar", "events", calendarLinks(env.CALENDAR_ICAL_URL)],
  ];
  for (const [name, kind, urls] of sources) {
    for (const [i, url] of urls.entries()) {
      const label = urls.length > 1 ? `${name} ${i + 1}` : name;
      try {
        payload[kind].push(await download(url));
      } catch (err) {
        payload.errors.push({ kind, source: label, message: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return payload;
}

export async function main(outDir: string, env: Record<string, string | undefined> = process.env): Promise<string> {
  // Trimmed, like the app does, so a stray space or newline pasted into the secret doesn't matter.
  const passphrase = (env.SYNC_PASSPHRASE ?? "").trim();
  if (!passphrase) return "Calendar sync not set up (no SYNC_PASSPHRASE secret); skipping.";
  if (passphrase.length < MIN_PASSPHRASE)
    return `SYNC_PASSPHRASE is shorter than ${MIN_PASSPHRASE} characters, so nothing was published. Use four or more random words.`;
  if (!env.SCHOOLOGY_ICAL_URL && !env.CALENDAR_ICAL_URL) return "Calendar sync has a passphrase but no calendar links; skipping.";
  const payload = await buildPayload(env);
  const file = encryptPayload(payload, passphrase);
  fs.mkdirSync(path.join(outDir, "sync"), { recursive: true });
  fs.writeFileSync(path.join(outDir, "sync", "data.json"), JSON.stringify(file));
  const problems = payload.errors.map((e) => `${e.source}: ${e.message}`).join("; ");
  return `Synced ${payload.homework.length} homework and ${payload.events.length} event calendar(s)${problems ? `; problems: ${problems}` : ""}.`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2] ?? "dist")
    .then((msg) => console.log(msg))
    .catch(() => {
      // Never fail the deploy over calendars; the app keeps working with what it has.
      // The error itself isn't printed: these logs are public and could mention a link.
      console.log("Calendar sync failed unexpectedly; the app keeps the calendars it already has.");
    });
}

import crypto from "node:crypto";
import { DateTime } from "luxon";
import { get, run } from "../db.ts";
import { decrypt } from "../crypto.ts";
import { load, patch } from "../settings.ts";
import { zone } from "../time.ts";
import { fetchIcs, parseIcs } from "./ical.ts";
import { announcePending } from "./approvals.ts";
import { notify } from "./push.ts";

const API = "https://api.schoology.com/v1";
const DAY = 86_400_000;

/* ---------- OAuth 1.0a (two-legged) request signing ---------- */

export function percentEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

export type OAuthInput = {
  method: string;
  url: string;
  consumerKey: string;
  consumerSecret: string;
  token?: string;
  tokenSecret?: string;
  nonce?: string;
  timestamp?: string;
  /** Extra form-body params that must be part of the signature. */
  bodyParams?: Record<string, string>;
};

export function oauthSignature(input: OAuthInput): { signature: string; params: Record<string, string> } {
  const u = new URL(input.url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: input.consumerKey,
    oauth_nonce: input.nonce ?? crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: input.timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
  };
  if (input.token) oauth.oauth_token = input.token;

  const pairs: [string, string][] = [
    ...Object.entries(oauth),
    ...Object.entries(input.bodyParams ?? {}),
    ...[...u.searchParams.entries()],
  ].map(([k, v]) => [percentEncode(k), percentEncode(v)]);
  pairs.sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1));
  const paramString = pairs.map(([k, v]) => `${k}=${v}`).join("&");
  const baseUrl = `${u.protocol}//${u.host}${u.pathname}`;
  const base = [input.method.toUpperCase(), percentEncode(baseUrl), percentEncode(paramString)].join("&");
  const key = `${percentEncode(input.consumerSecret)}&${percentEncode(input.tokenSecret ?? "")}`;
  const signature = crypto.createHmac("sha1", key).update(base).digest("base64");
  return { signature, params: oauth };
}

export function oauthHeader(input: OAuthInput): string {
  const { signature, params } = oauthSignature(input);
  const all = { ...params, oauth_signature: signature };
  return (
    'OAuth realm="Schoology API", ' +
    Object.entries(all)
      .map(([k, v]) => `${k}="${percentEncode(v)}"`)
      .join(", ")
  );
}

type Creds = { key: string; secret: string };

async function sgyGet<T = Record<string, unknown>>(pathOrUrl: string, creds: Creds, depth = 0): Promise<T> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${API}${pathOrUrl}`;
  const res = await fetch(url, {
    headers: {
      Authorization: oauthHeader({ method: "GET", url, consumerKey: creds.key, consumerSecret: creds.secret }),
      Accept: "application/json",
    },
    // Schoology answers /users/me with a 303; follow it ourselves so the new URL gets a fresh signature.
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const location = res.headers.get("location");
  if (res.status >= 300 && res.status < 400 && location && depth < 3) {
    return sgyGet<T>(new URL(location, url).toString(), creds, depth + 1);
  }
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    if (res.status === 401) throw new Error("Schoology rejected the API key/secret (401). Re-check them in Settings.");
    throw new Error(`Schoology API ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

/* ---------- Importing ---------- */

export type ImportItem = {
  externalId: string;
  title: string;
  course: string | null;
  dueAt: string | null;
  allDay: boolean;
  url: string | null;
  notes: string | null;
};

/** Inserts new items (into the approval queue unless auto-approve is on) and refreshes existing ones. */
export function upsertImported(item: ImportItem, autoApprove: boolean): "new" | "updated" {
  const existing = get<{ id: number; course: string | null }>(
    "SELECT id, course FROM homework WHERE external_id = ?",
    item.externalId,
  );
  if (existing) {
    run(
      "UPDATE homework SET title = ?, due_at = ?, all_day = ?, url = COALESCE(?, url), course = COALESCE(?, course) WHERE id = ?",
      item.title,
      item.dueAt,
      item.allDay,
      item.url,
      item.course,
      existing.id,
    );
    return "updated";
  }
  run(
    `INSERT INTO homework (title, course, due_at, all_day, url, notes, source, external_id, approval)
     VALUES (?, ?, ?, ?, ?, ?, 'schoology', ?, ?)`,
    item.title,
    item.course,
    item.dueAt,
    item.allDay,
    item.url,
    item.notes,
    item.externalId,
    autoApprove ? "approved" : "pending",
  );
  return "new";
}

const ASSIGNMENT_RE = /\/assignment\/(\d+)/;

export function itemsFromIcs(text: string, now = Date.now()): ImportItem[] {
  const events = parseIcs(text, new Date(now - 3 * DAY), new Date(now + 120 * DAY), zone());
  return events.map((ev) => {
    const assignment = (ev.url ?? "").match(ASSIGNMENT_RE) ?? (ev.description ?? "").match(ASSIGNMENT_RE);
    return {
      externalId: assignment ? `assignment:${assignment[1]}` : ev.recurring ? `ical:${ev.uid}:${ev.start}` : `ical:${ev.uid}`,
      title: ev.title,
      course: ev.location,
      dueAt: ev.allDay ? DateTime.fromISO(ev.date!, { zone: zone() }).set({ hour: 23, minute: 59 }).toUTC().toISO() : ev.start,
      allDay: ev.allDay,
      url: ev.url,
      notes: ev.description ? ev.description.slice(0, 2000) : null,
    };
  });
}

type Section = { id: string | number; course_title?: string; section_title?: string };
type Assignment = { id: string | number; title?: string; description?: string; due?: string; web_url?: string };

async function itemsFromApi(creds: Creds, now = Date.now()): Promise<ImportItem[]> {
  const me = await sgyGet<{ uid?: string | number; id?: string | number }>("/users/me", creds);
  const uid = me.uid ?? me.id;
  if (!uid) throw new Error("Couldn't read your Schoology user id");
  const sections = (await sgyGet<{ section?: Section[] }>(`/users/${uid}/sections`, creds)).section ?? [];
  const items: ImportItem[] = [];
  const from = now - 3 * DAY;
  const to = now + 120 * DAY;
  for (const sec of sections) {
    let next: string | undefined = `/sections/${sec.id}/assignments?start=0&limit=100`;
    for (let page = 0; next && page < 5; page++) {
      const data: { assignment?: Assignment[]; links?: { next?: string } } = await sgyGet(next, creds);
      for (const a of data.assignment ?? []) {
        if (!a.due) continue;
        const due = DateTime.fromFormat(a.due, "yyyy-MM-dd HH:mm:ss", { zone: zone() });
        if (!due.isValid || due.toMillis() < from || due.toMillis() > to) continue;
        items.push({
          externalId: `assignment:${a.id}`,
          title: (a.title ?? "Assignment").trim(),
          course: sec.course_title ?? sec.section_title ?? null,
          dueAt: due.toUTC().toISO(),
          allDay: false,
          url: a.web_url ?? null,
          notes: a.description ? a.description.slice(0, 2000) : null,
        });
      }
      next = data.links?.next;
    }
  }
  return items;
}

let running: Promise<SyncResult> | null = null;

type SyncResult = { imported: number; updated: number; newTitles: string[] };

export function syncSchoology(): Promise<SyncResult> {
  running ??= doSync().finally(() => (running = null));
  return running;
}

async function doSync(): Promise<SyncResult> {
  const s = load("schoology");
  const result: SyncResult = { imported: 0, updated: 0, newTitles: [] };
  if (!s.icalUrlEnc && !(s.consumerKeyEnc && s.consumerSecretEnc)) return result;
  try {
    const items: ImportItem[] = [];
    // API items first so they win (they carry course names) when both sources list an assignment.
    if (s.consumerKeyEnc && s.consumerSecretEnc) {
      items.push(...(await itemsFromApi({ key: decrypt(s.consumerKeyEnc), secret: decrypt(s.consumerSecretEnc) })));
    }
    if (s.icalUrlEnc) {
      const seen = new Set(items.map((i) => i.externalId));
      for (const item of itemsFromIcs(await fetchIcs(decrypt(s.icalUrlEnc)))) {
        if (seen.has(item.externalId)) continue;
        seen.add(item.externalId);
        items.push(item);
      }
    }
    for (const item of items) {
      if (upsertImported(item, s.autoApprove) === "new") {
        result.imported++;
        result.newTitles.push(item.title);
      } else result.updated++;
    }
    patch("schoology", { lastSynced: new Date().toISOString(), lastError: null, lastImported: result.imported });
    if (s.lastSynced && result.newTitles.length) {
      if (s.autoApprove) {
        await notify({
          title: `📚 ${result.newTitles.length} new from Schoology`,
          body: result.newTitles.slice(0, 5).join(" · "),
          url: "/homework",
          dedupeKey: `sgy-new:${result.newTitles.join("|")}`,
        });
      } else {
        await announcePending("Schoology", result.newTitles);
      }
    }
    return result;
  } catch (err) {
    patch("schoology", { lastError: err instanceof Error ? err.message : String(err), lastSynced: new Date().toISOString() });
    throw err;
  }
}

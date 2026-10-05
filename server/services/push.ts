import webpush from "web-push";
import { all, get, getSetting, run, setSetting } from "../db.ts";
import { decrypt, encrypt } from "../crypto.ts";
import { config } from "../config.ts";

type Vapid = { publicKey: string; privateKeyEnc: string };

let configuredFor = "";

/**
 * Push services want a contact URL for the sender. Apple rejects placeholder values,
 * so prefer the app's own https address (recorded the first time a phone subscribes).
 */
function vapidSubject(): string {
  if (process.env.VAPID_SUBJECT) return process.env.VAPID_SUBJECT;
  if (config.publicUrl.startsWith("https://")) return config.publicUrl;
  const origin = getSetting<string | null>("publicOrigin", null);
  if (origin?.startsWith("https://")) return origin;
  return "mailto:limitless-app@example.com";
}

export function rememberOrigin(origin: string) {
  if (origin.startsWith("https://") && getSetting<string | null>("publicOrigin", null) !== origin) {
    setSetting("publicOrigin", origin);
  }
}

/** VAPID keys identify this server to the phone's push service. Generated once and stored. */
export function vapidPublicKey(): string {
  let vapid = getSetting<Vapid | null>("vapid", null);
  if (!vapid) {
    const keys = webpush.generateVAPIDKeys();
    vapid = { publicKey: keys.publicKey, privateKeyEnc: encrypt(keys.privateKey) };
    setSetting("vapid", vapid);
  }
  const subject = vapidSubject();
  if (configuredFor !== subject) {
    webpush.setVapidDetails(subject, vapid.publicKey, decrypt(vapid.privateKeyEnc));
    configuredFor = subject;
  }
  return vapid.publicKey;
}

export function saveSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string) {
  run(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent`,
    sub.endpoint,
    sub.keys.p256dh,
    sub.keys.auth,
    userAgent ?? null,
  );
}

export function removeSubscription(endpoint: string) {
  run("DELETE FROM push_subscriptions WHERE endpoint = ?", endpoint);
}

export type Notice = {
  title: string;
  body?: string;
  /** In-app path to open when the notification is tapped. */
  url?: string;
  /** If set, a notice with the same key is only ever sent once. */
  dedupeKey?: string;
  tag?: string;
};

export function alreadySent(dedupeKey: string): boolean {
  return !!get("SELECT 1 FROM notifications WHERE dedupe_key = ?", dedupeKey);
}

/** Records the notice (shown in the app's bell) and pushes it to every subscribed device. */
export async function notify(n: Notice): Promise<{ sent: number; skipped?: boolean }> {
  if (n.dedupeKey && alreadySent(n.dedupeKey)) return { sent: 0, skipped: true };
  run(
    "INSERT INTO notifications (dedupe_key, title, body, url) VALUES (?, ?, ?, ?)",
    n.dedupeKey ?? null,
    n.title,
    n.body ?? null,
    n.url ?? "/",
  );
  vapidPublicKey();
  const subs = all<{ endpoint: string; p256dh: string; auth: string }>("SELECT * FROM push_subscriptions");
  const payload = JSON.stringify({ title: n.title, body: n.body ?? "", url: n.url ?? "/", tag: n.tag });
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          TTL: 60 * 60 * 12,
          urgency: "high",
        });
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) removeSubscription(s.endpoint);
        else console.error("[push] send failed", status ?? err);
      }
    }),
  );
  return { sent };
}

import crypto from "node:crypto";
import webpush from "web-push";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { all } from "../db.ts";
import { freshDb } from "../test/helpers.ts";
import { notify, saveSubscription } from "./push.ts";

function phone(endpoint: string) {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  saveSubscription({
    endpoint,
    keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") },
  });
}

describe("notify", () => {
  beforeEach(() => freshDb());
  afterEach(() => vi.restoreAllMocks());

  it("sends an encrypted, VAPID-signed push once per dedupe key and logs it", async () => {
    phone("https://push.example.com/device-1");
    const send = vi.spyOn(webpush, "sendNotification").mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    expect(await notify({ title: "📚 1 due tomorrow", body: "Essay", url: "/homework", dedupeKey: "k1" })).toEqual({ sent: 1 });
    expect(await notify({ title: "📚 1 due tomorrow", body: "Essay", url: "/homework", dedupeKey: "k1" })).toEqual({ sent: 0, skipped: true });
    expect(send).toHaveBeenCalledTimes(1);

    const [subscription, payload] = send.mock.calls[0];
    expect(JSON.parse(String(payload))).toMatchObject({ title: "📚 1 due tomorrow", body: "Essay", url: "/homework" });
    // Run the real encryption + signing on what we would have sent.
    const { headers } = webpush.generateRequestDetails(subscription, String(payload)) as { headers: Record<string, unknown> };
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(String(headers.Authorization)).toMatch(/^vapid t=.+, k=.+/);
    expect(all("SELECT title FROM notifications")).toEqual([expect.objectContaining({ title: "📚 1 due tomorrow" })]);
  });

  it("forgets devices whose subscription has expired", async () => {
    phone("https://push.example.com/gone");
    vi.spyOn(webpush, "sendNotification").mockRejectedValue(Object.assign(new Error("Gone"), { statusCode: 410 }));
    await notify({ title: "Hi" });
    expect(all("SELECT * FROM push_subscriptions")).toEqual([]);
  });
});

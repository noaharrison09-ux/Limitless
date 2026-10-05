import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.ts";

let key: Buffer | null = null;

/**
 * Stored credentials (email app passwords, calendar URLs, Schoology keys) are
 * encrypted at rest with AES-256-GCM. The key is derived from a random file in
 * the data directory plus the optional APP_SECRET env var.
 */
function getKey(): Buffer {
  if (key) return key;
  const file = path.join(config.dataDir, "secret.key");
  let material: Buffer;
  if (fs.existsSync(file)) {
    material = fs.readFileSync(file);
  } else {
    fs.mkdirSync(config.dataDir, { recursive: true });
    material = crypto.randomBytes(32);
    fs.writeFileSync(file, material, { mode: 0o600 });
  }
  key = crypto.createHash("sha256").update(material).update(config.appSecret).digest();
  return key;
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(":");
}

export function decrypt(blob: string | null | undefined): string {
  if (!blob) return "";
  const [version, iv, tag, data] = blob.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unrecognized secret format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

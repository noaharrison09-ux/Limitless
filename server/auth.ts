import crypto from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { config } from "./config.ts";
import { get, run } from "./db.ts";
import { safeEqual, sha256 } from "./crypto.ts";

const COOKIE = "lsid";
const MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000; // browsers cap cookies at 400 days

const failures = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function isAuthed(req: Request): boolean {
  const token = readCookie(req, COOKIE);
  if (!token) return false;
  const hash = sha256(token);
  const row = get("SELECT token_hash FROM sessions WHERE token_hash = ?", hash);
  if (!row) return false;
  run("UPDATE sessions SET last_seen = ? WHERE token_hash = ?", new Date().toISOString(), hash);
  return true;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: "Not signed in" });
}

export const authRouter = Router();

authRouter.get("/session", (req, res) => {
  res.json({ authenticated: isAuthed(req) });
});

authRouter.post("/login", (req, res) => {
  const ip = req.ip ?? "unknown";
  const now = Date.now();
  const f = failures.get(ip);
  if (f && now - f.first < WINDOW_MS && f.count >= MAX_FAILURES) {
    res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
    return;
  }
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!safeEqual(password, config.appPassword)) {
    if (!f || now - f.first >= WINDOW_MS) failures.set(ip, { count: 1, first: now });
    else f.count++;
    res.status(401).json({ error: "Wrong password" });
    return;
  }
  failures.delete(ip);
  const token = crypto.randomBytes(32).toString("base64url");
  const ts = new Date().toISOString();
  run(
    "INSERT INTO sessions (token_hash, created_at, last_seen, user_agent) VALUES (?, ?, ?, ?)",
    sha256(token),
    ts,
    ts,
    req.headers["user-agent"] ?? null,
  );
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    maxAge: MAX_AGE_MS,
    path: "/",
  });
  res.json({ ok: true });
});

authRouter.post("/logout", (req, res) => {
  const token = readCookie(req, COOKIE);
  if (token) run("DELETE FROM sessions WHERE token_hash = ?", sha256(token));
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});

import initSqlJs, { type SqlJsStatic } from "sql.js";
import { openDb } from "../db.ts";
import { save } from "../settings.ts";
import { createApp } from "../app.ts";
import { handle } from "../router.ts";

let SQL: SqlJsStatic | null = null;

/** A fresh, empty on-device database (in memory) for each test. */
export async function freshDb(timezone = "America/New_York") {
  SQL ??= await initSqlJs();
  const db = openDb(new SQL.Database());
  save("prefs", { name: "Test", timezone, units: "lb" });
  return db;
}

/** Calls the in-page API the way the screens do. */
export function api() {
  const app = createApp();
  return async <T = Record<string, unknown>>(method: string, path: string, body?: unknown) => {
    const res = await handle(app, method, path, body);
    return { status: res.status, data: res.body as T };
  };
}

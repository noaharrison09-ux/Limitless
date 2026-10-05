import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

export type Row = Record<string, unknown>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS weights (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  weight REAL NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS nutrition (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  calories INTEGER,
  protein INTEGER,
  note TEXT
);

CREATE TABLE IF NOT EXISTS lifts (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  exercise TEXT NOT NULL,
  weight REAL NOT NULL,
  reps INTEGER NOT NULL,
  sets INTEGER,
  note TEXT
);

CREATE TABLE IF NOT EXISTS measurements (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  value REAL NOT NULL,
  UNIQUE (date, name)
);

CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  target_date TEXT,
  kind TEXT NOT NULL DEFAULT 'steps',
  start_value REAL,
  current_value REAL,
  target_value REAL,
  unit TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS goal_steps (
  id INTEGER PRIMARY KEY,
  goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  went_right TEXT,
  went_wrong TEXT,
  notes TEXT,
  mood INTEGER,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS non_negotiables (
  id INTEGER PRIMARY KEY,
  for_date TEXT NOT NULL,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS non_negotiables_for_date ON non_negotiables(for_date);

CREATE TABLE IF NOT EXISTS homework (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  course TEXT,
  due_at TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'todo',
  priority INTEGER NOT NULL DEFAULT 2,
  notes TEXT,
  url TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT UNIQUE,
  -- Imported items wait in the approval queue ('pending') until you approve or decline them.
  approval TEXT NOT NULL DEFAULT 'approved',
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS homework_due ON homework(due_at);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  emoji TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS project_tasks (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS calendar_feeds (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  url_enc TEXT NOT NULL,
  color TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  auto_approve INTEGER NOT NULL DEFAULT 0,
  last_synced TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  feed_id INTEGER REFERENCES calendar_feeds(id) ON DELETE CASCADE,
  -- 'local' (added by you), 'feed' (linked calendar), 'email' (suggested from an important email)
  source TEXT NOT NULL DEFAULT 'local',
  -- 'approved' events show on the calendar; 'pending' ones wait in the approval queue.
  status TEXT NOT NULL DEFAULT 'approved',
  email_id INTEGER,
  uid TEXT,
  title TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  description TEXT,
  url TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS events_start ON events(start);

-- Approve/decline decisions for linked-calendar events, keyed by feed + event UID so they
-- survive re-syncs (a whole recurring series is approved at once).
CREATE TABLE IF NOT EXISTS calendar_decisions (
  key TEXT PRIMARY KEY,
  decision TEXT NOT NULL,
  decided_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_accounts (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 993,
  secure INTEGER NOT NULL DEFAULT 1,
  username TEXT NOT NULL,
  password_enc TEXT NOT NULL,
  mailbox TEXT NOT NULL DEFAULT 'INBOX',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_uid INTEGER,
  uid_validity TEXT,
  last_checked TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS email_rules (
  id INTEGER PRIMARY KEY,
  field TEXT NOT NULL,
  pattern TEXT NOT NULL,
  label TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS important_emails (
  id INTEGER PRIMARY KEY,
  account_id INTEGER REFERENCES email_accounts(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  from_name TEXT,
  from_addr TEXT,
  subject TEXT,
  snippet TEXT,
  received_at TEXT,
  reason TEXT,
  summary TEXT,
  body TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (account_id, message_id)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  dedupe_key TEXT UNIQUE,
  title TEXT NOT NULL,
  body TEXT,
  url TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`;

let db: DatabaseSync | null = null;

export function openDb(file: string): DatabaseSync {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Adds columns introduced after a database was first created. */
function migrate(d: DatabaseSync) {
  const add = (table: string, column: string, type: string) => {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  };
  add("important_emails", "body", "TEXT");
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error("Database not opened");
  return db;
}

/** Converts JS values into something node:sqlite can bind (booleans -> 0/1, undefined -> null). */
function bindable(v: unknown): SQLInputValue {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" || typeof v === "string" || typeof v === "bigint") return v;
  if (v instanceof Uint8Array) return v;
  return JSON.stringify(v);
}

export function all<T = Row>(sql: string, ...params: unknown[]): T[] {
  return getDb().prepare(sql).all(...params.map(bindable)) as T[];
}

export function get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
  return getDb().prepare(sql).get(...params.map(bindable)) as T | undefined;
}

export function run(sql: string, ...params: unknown[]) {
  const r = getDb().prepare(sql).run(...params.map(bindable));
  return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
}

let txDepth = 0;

/** Runs fn in a transaction. Nested calls join the outer transaction. */
export function tx<T>(fn: () => T): T {
  if (txDepth > 0) return fn();
  const d = getDb();
  d.exec("BEGIN");
  txDepth++;
  try {
    const out = fn();
    d.exec("COMMIT");
    return out;
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  } finally {
    txDepth--;
  }
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = get<{ value: string }>("SELECT value FROM settings WHERE key = ?", key);
  if (!row) return fallback;
  try {
    const parsed = JSON.parse(row.value);
    if (fallback && typeof fallback === "object" && !Array.isArray(fallback)) {
      return { ...fallback, ...parsed };
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown) {
  run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    JSON.stringify(value),
  );
}

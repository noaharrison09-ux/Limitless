import type { Database, SqlValue } from "sql.js";

export type Row = Record<string, unknown>;

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weights (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  weight REAL NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
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
  created_at TEXT NOT NULL DEFAULT ${NOW},
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
  -- 'manual' (added by you) or 'import' (from a Schoology calendar file)
  source TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT UNIQUE,
  -- Imported items you remove are hidden, so importing the same file again won't bring them back.
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${NOW},
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
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS project_tasks (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  -- 'local' (added by you) or 'import' (from a calendar file)
  source TEXT NOT NULL DEFAULT 'local',
  uid TEXT,
  title TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  description TEXT,
  url TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS events_start ON events(start);
`;

/** Every table holding your data, in an order that's safe to restore into (parents first). */
export const DATA_TABLES = [
  "weights",
  "nutrition",
  "lifts",
  "measurements",
  "goals",
  "goal_steps",
  "journal_entries",
  "non_negotiables",
  "homework",
  "projects",
  "project_tasks",
  "notes",
  "events",
] as const;

let db: Database | null = null;
let txDepth = 0;
let onWrite: (() => void) | null = null;

/** Opens the app database on an already-loaded sql.js Database and makes sure the tables exist. */
export function openDb(database: Database, opts: { onWrite?: () => void } = {}): Database {
  db = database;
  onWrite = opts.onWrite ?? null;
  txDepth = 0;
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}

export function getDb(): Database {
  if (!db) throw new Error("Database not opened");
  return db;
}

/** Bytes of the whole database, for saving on the device. */
export function exportDb(): Uint8Array {
  const d = getDb();
  const bytes = d.export();
  // sql.js re-opens the database when exporting, which resets pragmas.
  d.exec("PRAGMA foreign_keys = ON;");
  return bytes;
}

export function inTransaction(): boolean {
  return txDepth > 0;
}

/** Converts JS values into something SQLite can bind (booleans -> 0/1, undefined -> null). */
function bindable(v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Uint8Array) return v;
  return JSON.stringify(v);
}

export function all<T = Row>(sql: string, ...params: unknown[]): T[] {
  const stmt = getDb().prepare(sql);
  try {
    stmt.bind(params.map(bindable));
    const rows: T[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    return rows;
  } finally {
    stmt.free();
  }
}

export function get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
  return all<T>(sql, ...params)[0];
}

export function run(sql: string, ...params: unknown[]) {
  const d = getDb();
  d.run(sql, params.map(bindable));
  const changes = d.getRowsModified();
  const lastId = Number(d.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0);
  if (txDepth === 0) onWrite?.();
  return { changes, lastId };
}

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
    onWrite?.();
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

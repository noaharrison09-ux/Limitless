import { Router, type Request } from "express";
import { all, get, run, type Row } from "../db.ts";

export type ColType = "text" | "int" | "real" | "bool" | "date" | "datetime";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function coerce(col: string, type: ColType, value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  switch (type) {
    case "text":
      return String(value).trim();
    case "int": {
      const n = Math.round(Number(value));
      if (!Number.isFinite(n)) throw new HttpError(400, `${col} must be a number`);
      return n;
    }
    case "real": {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new HttpError(400, `${col} must be a number`);
      return n;
    }
    case "bool":
      return value === true || value === 1 || value === "1" || value === "true" ? 1 : 0;
    case "date":
      if (typeof value !== "string" || !DATE_RE.test(value)) throw new HttpError(400, `${col} must be YYYY-MM-DD`);
      return value;
    case "datetime": {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) throw new HttpError(400, `${col} must be a date/time`);
      return d.toISOString();
    }
  }
}

/** Picks and coerces whitelisted columns from a request body. */
export function pick(body: unknown, columns: Record<string, ColType>): Record<string, unknown> {
  const src = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [col, type] of Object.entries(columns)) {
    const v = coerce(col, type, src[col]);
    if (v !== undefined) out[col] = v;
  }
  return out;
}

export function idParam(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Bad id");
  return id;
}

export function insertRow(table: string, values: Record<string, unknown>): Row {
  const cols = Object.keys(values);
  const { lastId } = run(
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    ...cols.map((c) => values[c]),
  );
  return get(`SELECT * FROM ${table} WHERE id = ?`, lastId)!;
}

export function updateRow(table: string, id: number, values: Record<string, unknown>): Row {
  const cols = Object.keys(values);
  if (cols.length) {
    const r = run(
      `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
      ...cols.map((c) => values[c]),
      id,
    );
    if (!r.changes) throw new HttpError(404, "Not found");
  }
  const row = get(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!row) throw new HttpError(404, "Not found");
  return row;
}

type CrudOptions = {
  table: string;
  columns: Record<string, ColType>;
  required?: string[];
  orderBy: string;
  /** Unique column: POSTing an existing value updates that row instead of failing. */
  upsertOn?: string;
  /** Column stamped with the current time on every write. */
  touch?: string;
  /** Map of query param -> SQL condition using one "?" placeholder. */
  filters?: Record<string, string>;
  limit?: number;
};

export function crudRouter(opts: CrudOptions): Router {
  const r = Router();
  const { table, columns } = opts;

  r.get("/", (req, res) => {
    const where: string[] = [];
    const params: unknown[] = [];
    for (const [param, cond] of Object.entries(opts.filters ?? {})) {
      const v = req.query[param];
      if (typeof v === "string" && v !== "") {
        where.push(cond);
        params.push(v);
      }
    }
    const sql = `SELECT * FROM ${table} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${opts.orderBy} ${opts.limit ? `LIMIT ${opts.limit}` : ""}`;
    res.json(all(sql, ...params));
  });

  r.post("/", (req, res) => {
    const values = pick(req.body, columns);
    for (const col of opts.required ?? []) {
      if (values[col] === undefined || values[col] === null) throw new HttpError(400, `${col} is required`);
    }
    if (opts.touch) values[opts.touch] = new Date().toISOString();
    if (opts.upsertOn && values[opts.upsertOn] != null) {
      const existing = get<{ id: number }>(`SELECT id FROM ${table} WHERE ${opts.upsertOn} = ?`, values[opts.upsertOn]);
      if (existing) {
        res.json(updateRow(table, existing.id, values));
        return;
      }
    }
    res.status(201).json(insertRow(table, values));
  });

  r.patch("/:id", (req, res) => {
    const values = pick(req.body, columns);
    for (const col of opts.required ?? []) {
      if (col in values && values[col] === null) throw new HttpError(400, `${col} is required`);
    }
    if (opts.touch) values[opts.touch] = new Date().toISOString();
    res.json(updateRow(table, idParam(req), values));
  });

  r.delete("/:id", (req, res) => {
    run(`DELETE FROM ${table} WHERE id = ?`, idParam(req));
    res.json({ ok: true });
  });

  return r;
}

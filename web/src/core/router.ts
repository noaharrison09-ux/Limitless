/**
 * A tiny in-page stand-in for an HTTP server router. The app's screens still "call an API"
 * (GET /today, POST /homework, ...), but the handlers run right here in the browser against
 * the on-device database, so the whole app works as static files (e.g. on GitHub Pages).
 */

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type Req = {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  // Request bodies are untyped JSON, exactly like a real API.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
};

export class Res {
  statusCode = 200;
  body: unknown = undefined;
  sent = false;
  status(code: number) {
    this.statusCode = code;
    return this;
  }
  json(data: unknown) {
    this.body = data;
    this.sent = true;
    return this;
  }
}

export type Handler = (req: Req, res: Res) => unknown;

type Layer =
  | { kind: "route"; method: string; segments: string[]; handler: Handler }
  | { kind: "mount"; segments: string[]; router: RouterT };

function split(path: string): string[] {
  return path.split("/").filter(Boolean);
}

function matchRoute(pattern: string[], parts: string[]): Record<string, string> | null {
  if (pattern.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i].startsWith(":")) params[pattern[i].slice(1)] = decodeURIComponent(parts[i]);
    else if (pattern[i] !== parts[i]) return null;
  }
  return params;
}

type RouteFn = (path: string, handler: Handler) => void;

export interface RouterT {
  get: RouteFn;
  post: RouteFn;
  put: RouteFn;
  patch: RouteFn;
  delete: RouteFn;
  use(pathOrRouter: string | RouterT, maybeRouter?: RouterT): void;
  dispatch(req: Req, res: Res, parts: string[]): Promise<boolean>;
}

export function Router(): RouterT {
  const layers: Layer[] = [];
  const route = (method: string): RouteFn => (path, handler) => {
    layers.push({ kind: "route", method, segments: split(path), handler });
  };

  const router: RouterT = {
    get: route("GET"),
    post: route("POST"),
    put: route("PUT"),
    patch: route("PATCH"),
    delete: route("DELETE"),
    /** Mount a sub-router, optionally under a path prefix. */
    use(pathOrRouter: string | RouterT, maybeRouter?: RouterT) {
      if (typeof pathOrRouter === "string") layers.push({ kind: "mount", segments: split(pathOrRouter), router: maybeRouter! });
      else layers.push({ kind: "mount", segments: [], router: pathOrRouter });
    },
    /** Runs the first matching handler. Returns false when nothing matched. */
    async dispatch(req: Req, res: Res, parts: string[]): Promise<boolean> {
      for (const layer of layers) {
        if (layer.kind === "mount") {
          const prefix = layer.segments;
          if (prefix.every((s, i) => parts[i] === s) && parts.length >= prefix.length) {
            if (await layer.router.dispatch(req, res, parts.slice(prefix.length))) return true;
          }
          continue;
        }
        if (layer.method !== req.method) continue;
        const params = matchRoute(layer.segments, parts);
        if (!params) continue;
        req.params = params;
        await layer.handler(req, res);
        return true;
      }
      return false;
    },
  };
  return router;
}

/** Sends one request through an app router, returning {status, body} like an HTTP response. */
export async function handle(app: RouterT, method: string, url: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const [path, search = ""] = url.split("?");
  const query: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(search)) query[k] = v;
  const req: Req = { method: method.toUpperCase(), path, params: {}, query, body: body ?? {} };
  const res = new Res();
  try {
    const found = await app.dispatch(req, res, split(path));
    if (!found) return { status: 404, body: { error: "Not found" } };
    return { status: res.statusCode, body: res.body ?? {} };
  } catch (err) {
    if (err instanceof HttpError) return { status: err.status, body: { error: err.message } };
    const message = err instanceof Error ? err.message : String(err);
    if (/UNIQUE constraint failed/.test(message)) return { status: 409, body: { error: "That already exists" } };
    console.error(err);
    return { status: 500, body: { error: "Something went wrong" } };
  }
}

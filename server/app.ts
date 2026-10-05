import fs from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { authRouter, requireAuth } from "./auth.ts";
import { HttpError } from "./routes/crud.ts";
import { bodyRouter } from "./routes/body.ts";
import { goalsRouter } from "./routes/goals.ts";
import { journalRouter } from "./routes/journal.ts";
import { homeworkRouter } from "./routes/homework.ts";
import { notesRouter, projectsRouter } from "./routes/projects.ts";
import { calendarRouter } from "./routes/calendar.ts";
import { emailRouter } from "./routes/email.ts";
import { systemRouter } from "./routes/system.ts";
import { dashboardRouter } from "./routes/dashboard.ts";

export function createApp(opts: { staticDir?: string } = {}) {
  const app = express();
  // Trust only the host's own proxy hop, so a client can't fake its IP with X-Forwarded-For.
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1));
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/auth", authRouter);

  const api = express.Router();
  api.use(requireAuth);
  api.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  api.use(dashboardRouter);
  api.use("/body", bodyRouter);
  api.use("/goals", goalsRouter);
  api.use("/journal", journalRouter);
  api.use("/homework", homeworkRouter);
  api.use("/projects", projectsRouter);
  api.use("/notes", notesRouter);
  api.use("/calendar", calendarRouter);
  api.use("/email", emailRouter);
  api.use(systemRouter);
  app.use("/api", api);
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  if (opts.staticDir && fs.existsSync(opts.staticDir)) {
    const dir = opts.staticDir;
    app.use(
      express.static(dir, {
        index: false,
        setHeaders(res, file) {
          // The service worker and HTML must always be fresh; hashed assets can be cached forever.
          if (file.endsWith("sw.js") || file.endsWith(".html") || file.endsWith(".webmanifest")) {
            res.setHeader("Cache-Control", "no-cache");
          } else if (file.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          }
        },
      }),
    );
    // Client-side routes (/calendar, /journal, ...) all serve the app shell.
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(dir, "index.html"));
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    const e = err as { type?: string; message?: string };
    if (e?.type === "entity.parse.failed") {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }
    if (/UNIQUE constraint failed/.test(e?.message ?? "")) {
      res.status(409).json({ error: "That already exists" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  });

  return app;
}

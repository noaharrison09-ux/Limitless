import { Router } from "./router.ts";
import { bodyRouter } from "./routes/body.ts";
import { goalsRouter } from "./routes/goals.ts";
import { journalRouter } from "./routes/journal.ts";
import { homeworkRouter } from "./routes/homework.ts";
import { notesRouter, projectsRouter } from "./routes/projects.ts";
import { calendarRouter } from "./routes/calendar.ts";
import { systemRouter } from "./routes/system.ts";
import { dashboardRouter } from "./routes/dashboard.ts";

/** All of the app's "API" routes, run in-page against the on-device database. */
export function createApp() {
  const app = Router();
  app.use(dashboardRouter);
  app.use("/body", bodyRouter);
  app.use("/goals", goalsRouter);
  app.use("/journal", journalRouter);
  app.use("/homework", homeworkRouter);
  app.use("/projects", projectsRouter);
  app.use("/notes", notesRouter);
  app.use("/calendar", calendarRouter);
  app.use(systemRouter);
  return app;
}

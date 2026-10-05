import { Router } from "../router.ts";
import { all, get, run } from "../db.ts";
import { HttpError, idParam, insertRow, pick, updateRow, type ColType } from "./crud.ts";

export const projectsRouter = Router();

const PROJECT_COLUMNS: Record<string, ColType> = {
  name: "text",
  description: "text",
  status: "text",
  emoji: "text",
  pinned: "bool",
};

function touchProject(id: unknown) {
  if (id) run("UPDATE projects SET updated_at = ? WHERE id = ?", new Date().toISOString(), id);
}

projectsRouter.get("/", (_req, res) => {
  res.json(
    all(`
      SELECT p.*,
        (SELECT COUNT(*) FROM project_tasks t WHERE t.project_id = p.id) AS task_count,
        (SELECT COUNT(*) FROM project_tasks t WHERE t.project_id = p.id AND t.done = 1) AS tasks_done,
        (SELECT COUNT(*) FROM notes n WHERE n.project_id = p.id) AS note_count
      FROM projects p
      ORDER BY p.pinned DESC, p.status = 'done', p.updated_at DESC
    `),
  );
});

projectsRouter.get("/:id", (req, res) => {
  const id = idParam(req);
  const project = get("SELECT * FROM projects WHERE id = ?", id);
  if (!project) throw new HttpError(404, "Not found");
  res.json({
    ...project,
    tasks: all("SELECT * FROM project_tasks WHERE project_id = ? ORDER BY done, position, id", id),
    notes: all("SELECT * FROM notes WHERE project_id = ? ORDER BY pinned DESC, created_at DESC", id),
  });
});

projectsRouter.post("/", (req, res) => {
  const values = pick(req.body, PROJECT_COLUMNS);
  if (!values.name) throw new HttpError(400, "name is required");
  const project = insertRow("projects", values);
  // "Turn this idea into a project": move the idea note into the new project.
  const fromNote = Number(req.body?.from_note_id);
  if (Number.isInteger(fromNote) && fromNote > 0) {
    run("UPDATE notes SET project_id = ? WHERE id = ?", project.id, fromNote);
  }
  res.status(201).json(project);
});

projectsRouter.patch("/:id", (req, res) => {
  const values = pick(req.body, PROJECT_COLUMNS);
  values.updated_at = new Date().toISOString();
  res.json(updateRow("projects", idParam(req), values));
});

projectsRouter.delete("/:id", (req, res) => {
  run("DELETE FROM projects WHERE id = ?", idParam(req));
  res.json({ ok: true });
});

projectsRouter.post("/:id/tasks", (req, res) => {
  const id = idParam(req);
  const title = String(req.body?.title ?? "").trim();
  if (!title) throw new HttpError(400, "title is required");
  const max = get<{ m: number | null }>("SELECT MAX(position) AS m FROM project_tasks WHERE project_id = ?", id);
  const row = insertRow("project_tasks", { project_id: id, title, position: (max?.m ?? -1) + 1 });
  touchProject(id);
  res.status(201).json(row);
});

projectsRouter.patch("/tasks/:id", (req, res) => {
  const row = updateRow("project_tasks", idParam(req), pick(req.body, { title: "text", done: "bool" }));
  touchProject(row.project_id);
  res.json(row);
});

projectsRouter.delete("/tasks/:id", (req, res) => {
  run("DELETE FROM project_tasks WHERE id = ?", idParam(req));
  res.json({ ok: true });
});

/** Notes double as the ideas inbox: a note with no project is a loose idea. */
export const notesRouter = Router();

notesRouter.get("/", (req, res) => {
  if (req.query.project === "none") {
    res.json(all("SELECT * FROM notes WHERE project_id IS NULL ORDER BY pinned DESC, created_at DESC"));
    return;
  }
  res.json(all("SELECT * FROM notes ORDER BY created_at DESC LIMIT 200"));
});

const NOTE_COLUMNS: Record<string, ColType> = { body: "text", project_id: "int", pinned: "bool" };

notesRouter.post("/", (req, res) => {
  const values = pick(req.body, NOTE_COLUMNS);
  if (!values.body) throw new HttpError(400, "body is required");
  touchProject(values.project_id);
  res.status(201).json(insertRow("notes", { ...values, updated_at: new Date().toISOString() }));
});

notesRouter.patch("/:id", (req, res) => {
  const values = pick(req.body, NOTE_COLUMNS);
  if ("body" in values && !values.body) throw new HttpError(400, "body is required");
  touchProject(values.project_id);
  res.json(updateRow("notes", idParam(req), { ...values, updated_at: new Date().toISOString() }));
});

notesRouter.delete("/:id", (req, res) => {
  run("DELETE FROM notes WHERE id = ?", idParam(req));
  res.json({ ok: true });
});

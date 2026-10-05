import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, errorMessage, toast } from "../lib/api";
import { useApi } from "../lib/hooks";
import { ago } from "../lib/dates";
import type { Note, Project } from "../lib/types";
import { Icon } from "../components/Icon";
import { Card, Empty, ErrorBox, Field, Segmented, Sheet, Spinner, TopBar } from "../components/ui";

export const STATUS_LABEL: Record<Project["status"], string> = {
  idea: "Idea",
  active: "Active",
  paused: "Paused",
  done: "Done",
};

export function ProjectSheet({
  project,
  fromNote,
  onClose,
  onSaved,
}: {
  project?: Project;
  fromNote?: Note;
  onClose: () => void;
  onSaved: (p: Project) => void;
}) {
  const [name, setName] = useState(project?.name ?? fromNote?.body.split("\n")[0].slice(0, 80) ?? "");
  const [emoji, setEmoji] = useState(project?.emoji ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [status, setStatus] = useState<Project["status"]>(project?.status ?? "active");
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const body = { name, emoji, description, status, from_note_id: fromNote?.id };
      const p = project ? await api.patch<Project>(`/projects/${project.id}`, body) : await api.post<Project>("/projects", body);
      onSaved(p);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Sheet title={project ? "Edit project" : "New project"} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <div style={{ display: "grid", gridTemplateColumns: "72px 1fr", gap: 10 }}>
          <Field label="Icon">
            <input className="input" value={emoji} onChange={(e) => setEmoji(e.target.value.slice(0, 4))} placeholder="🚀" style={{ textAlign: "center", fontSize: 22 }} />
          </Field>
          <Field label="Name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!project} />
          </Field>
        </div>
        <Field label="What is it?">
          <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="The vision in a sentence or two" />
        </Field>
        <Field label="Status">
          <Segmented
            value={status}
            onChange={setStatus}
            options={(Object.keys(STATUS_LABEL) as Project["status"][]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
          />
        </Field>
        <ErrorBox error={error} />
        <button className="btn primary block" disabled={!name}>
          {project ? "Save" : "Create project"}
        </button>
      </form>
    </Sheet>
  );
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const projects = useApi<Project[]>("/projects");
  const ideas = useApi<Note[]>("/notes?project=none");
  const [text, setText] = useState("");
  const [sheet, setSheet] = useState<{ fromNote?: Note } | null>(null);
  const [filter, setFilter] = useState<"open" | "done">("open");

  const capture = async () => {
    if (!text.trim()) return;
    await api.post("/notes", { body: text.trim() });
    setText("");
    toast("Idea saved");
    ideas.reload();
  };

  const removeIdea = async (id: number) => {
    if (!confirm("Delete this idea?")) return;
    await api.del(`/notes/${id}`);
    ideas.reload();
  };

  const moveIdea = async (note: Note, projectId: number) => {
    await api.patch(`/notes/${note.id}`, { project_id: projectId });
    toast("Moved to project");
    ideas.reload();
    projects.reload();
  };

  const list = (projects.data ?? []).filter((p) => (filter === "done" ? p.status === "done" : p.status !== "done"));

  return (
    <>
      <TopBar
        title="Ideas & projects"
        back
        right={
          <button className="icon-btn" aria-label="New project" onClick={() => setSheet({})}>
            <Icon name="plus" />
          </button>
        }
      />
      <div className="page">
        <Card eyebrow="Capture" title="What's on your mind?" className="wood-edge">
          <textarea
            className="input"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="An idea, a thought about a project, something to build…"
          />
          <button className="btn primary block" style={{ marginTop: 10 }} onClick={capture} disabled={!text.trim()}>
            <Icon name="sparkle" size={18} /> Save idea
          </button>
        </Card>

        <div className="section-title">
          <h2>Projects</h2>
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: "open", label: "Open" },
              { value: "done", label: "Done" },
            ]}
          />
        </div>
        <ErrorBox error={projects.error} />
        {!projects.data ? (
          <Spinner />
        ) : list.length === 0 ? (
          <section className="card">
            <Empty icon="folder" title="No projects yet">
              Turn an idea into a project, or tap + to start one.
            </Empty>
          </section>
        ) : (
          <div className="tiles">
            {list.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="tile">
                <div className="tile-icon" style={{ fontSize: 22 }}>
                  {p.emoji || <Icon name="folder" />}
                </div>
                <strong>{p.name}</strong>
                <div className="tile-sub">
                  {STATUS_LABEL[p.status]}
                  {p.task_count ? ` · ${p.tasks_done}/${p.task_count} tasks` : ""}
                  {p.note_count ? ` · ${p.note_count} notes` : ""}
                </div>
                {p.pinned ? (
                  <span style={{ position: "absolute", top: 12, right: 12, color: "var(--oak)" }}>
                    <Icon name="pin" size={16} />
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        )}

        <div className="section-title">
          <h2>Idea inbox</h2>
          <span className="small muted">{ideas.data?.length ?? 0}</span>
        </div>
        {ideas.data && ideas.data.length === 0 && (
          <section className="card">
            <Empty icon="bulb" title="No loose ideas">
              Anything you capture above lands here until you file it into a project.
            </Empty>
          </section>
        )}
        {ideas.data?.map((n) => (
          <div key={n.id} className="note-card">
            {n.body}
            <div className="note-meta">
              <span>{ago(n.created_at)}</span>
              <span className="note-actions">
                {projects.data && projects.data.length > 0 && (
                  <select
                    className="input"
                    style={{ minHeight: 32, padding: "4px 8px", fontSize: 13, width: "auto" }}
                    value=""
                    onChange={(e) => e.target.value && moveIdea(n, Number(e.target.value))}
                    aria-label="Move to project"
                  >
                    <option value="">Move to…</option>
                    {projects.data
                      .filter((p) => p.status !== "done")
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.emoji} {p.name}
                        </option>
                      ))}
                  </select>
                )}
                <button className="btn small" onClick={() => setSheet({ fromNote: n })}>
                  Make project
                </button>
                <button className="icon-btn" style={{ width: 32, height: 32 }} aria-label="Delete idea" onClick={() => removeIdea(n.id)}>
                  <Icon name="trash" size={15} />
                </button>
              </span>
            </div>
          </div>
        ))}
      </div>
      {sheet && (
        <ProjectSheet
          fromNote={sheet.fromNote}
          onClose={() => setSheet(null)}
          onSaved={(p) => {
            ideas.reload();
            navigate(`/projects/${p.id}`);
          }}
        />
      )}
    </>
  );
}

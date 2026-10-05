import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, toast } from "../lib/api";
import { useApi } from "../lib/hooks";
import { ago } from "../lib/dates";
import type { Note, Project, ProjectTask } from "../lib/types";
import { Icon } from "../components/Icon";
import { Card, ErrorBox, Progress, Spinner, TopBar } from "../components/ui";
import { ProjectSheet, STATUS_LABEL } from "./Projects";

type Detail = Project & { tasks: ProjectTask[]; notes: Note[] };

export function ProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, error, reload } = useApi<Detail>(`/projects/${id}`);
  const [task, setTask] = useState("");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);

  if (!data) return <><TopBar title="Project" back="/projects" />{error ? <div className="page"><ErrorBox error={error} /></div> : <Spinner />}</>;

  const addTask = async () => {
    if (!task.trim()) return;
    await api.post(`/projects/${data.id}/tasks`, { title: task.trim() });
    setTask("");
    reload();
  };
  const toggleTask = async (t: ProjectTask) => {
    await api.patch(`/projects/tasks/${t.id}`, { done: !t.done });
    reload();
  };
  const removeTask = async (t: ProjectTask) => {
    await api.del(`/projects/tasks/${t.id}`);
    reload();
  };
  const addNote = async () => {
    if (!note.trim()) return;
    await api.post("/notes", { body: note.trim(), project_id: data.id });
    setNote("");
    toast("Thought saved");
    reload();
  };
  const pinNote = async (n: Note) => {
    await api.patch(`/notes/${n.id}`, { pinned: !n.pinned });
    reload();
  };
  const removeNote = async (n: Note) => {
    if (!confirm("Delete this note?")) return;
    await api.del(`/notes/${n.id}`);
    reload();
  };
  const togglePin = async () => {
    await api.patch(`/projects/${data.id}`, { pinned: !data.pinned });
    reload();
  };
  const remove = async () => {
    if (!confirm(`Delete “${data.name}”? Its notes go back to the idea inbox.`)) return;
    await api.del(`/projects/${data.id}`);
    navigate("/projects");
  };

  const done = data.tasks.filter((t) => t.done).length;

  return (
    <>
      <TopBar
        title={`${data.emoji ? `${data.emoji} ` : ""}${data.name}`}
        back="/projects"
        right={
          <button className="icon-btn" aria-label="Edit project" onClick={() => setEditing(true)}>
            <Icon name="edit" size={19} />
          </button>
        }
      />
      <div className="page">
        <Card className="wood-edge">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: data.description ? 10 : 0 }}>
            <span className="chip wood">{STATUS_LABEL[data.status]}</span>
            <span className="chip">Started {ago(data.created_at)}</span>
            <button className={`chip${data.pinned ? " warn" : ""}`} style={{ border: 0, cursor: "pointer" }} onClick={togglePin}>
              <Icon name="pin" size={12} /> {data.pinned ? "Pinned" : "Pin"}
            </button>
          </div>
          {data.description && <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{data.description}</p>}
        </Card>

        <Card eyebrow="Next steps" title={data.tasks.length ? `${done} of ${data.tasks.length} done` : "Tasks"}>
          {data.tasks.length > 0 && <Progress value={done / data.tasks.length} />}
          <div style={{ marginTop: 4 }}>
            {data.tasks.map((t) => (
              <div key={t.id} className="row" style={{ padding: "8px 0", minHeight: 0 }}>
                <input type="checkbox" className="check" checked={!!t.done} onChange={() => toggleTask(t)} />
                <span className={`row-main row-title${t.done ? " done" : ""}`} style={{ fontWeight: 500 }}>
                  {t.title}
                </span>
                <button className="icon-btn" style={{ width: 30, height: 30, border: 0 }} aria-label="Delete task" onClick={() => removeTask(t)}>
                  <Icon name="x" size={15} />
                </button>
              </div>
            ))}
          </div>
          <div className="kbd-add" style={{ marginTop: 8 }}>
            <input className="input" placeholder="Add a task" value={task} onChange={(e) => setTask(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTask()} />
            <button className="btn" onClick={addTask} aria-label="Add task" disabled={!task.trim()}>
              <Icon name="plus" size={18} />
            </button>
          </div>
        </Card>

        <Card eyebrow="Thoughts" title="Notes & ideas">
          <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Jot down a thought, decision, or idea for this project…" />
          <button className="btn primary block" style={{ marginTop: 10 }} onClick={addNote} disabled={!note.trim()}>
            Add note
          </button>
        </Card>

        {data.notes.map((n) => (
          <div key={n.id} className="note-card" style={n.pinned ? { borderColor: "var(--oak-2)", background: "var(--oak-wash)" } : undefined}>
            {n.body}
            <div className="note-meta">
              <span>
                {n.pinned ? "📌 " : ""}
                {ago(n.created_at)}
              </span>
              <span style={{ display: "flex", gap: 6 }}>
                <button className="icon-btn" style={{ width: 32, height: 32 }} aria-label={n.pinned ? "Unpin" : "Pin"} onClick={() => pinNote(n)}>
                  <Icon name="pin" size={15} />
                </button>
                <button className="icon-btn" style={{ width: 32, height: 32 }} aria-label="Delete note" onClick={() => removeNote(n)}>
                  <Icon name="trash" size={15} />
                </button>
              </span>
            </div>
          </div>
        ))}

        <button className="btn danger block" onClick={remove} style={{ marginTop: 12 }}>
          <Icon name="trash" size={18} /> Delete project
        </button>
      </div>
      {editing && <ProjectSheet project={data} onClose={() => setEditing(false)} onSaved={() => reload()} />}
    </>
  );
}

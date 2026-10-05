import { useState, type FormEvent } from "react";
import { api, errorMessage, refreshAll, toast } from "../lib/api";
import { useApi } from "../lib/hooks";
import { addDays, dateStr, fmtDue, isOverdue, timeStr, todayStr } from "../lib/dates";
import type { Homework } from "../lib/types";
import { Icon } from "../components/Icon";
import { Empty, ErrorBox, Fab, Field, Segmented, Sheet, Spinner, TopBar } from "../components/ui";

function bucket(h: Homework): string {
  if (!h.due_at) return "No due date";
  if (isOverdue(h.due_at, h.all_day)) return "Overdue";
  const d = dateStr(new Date(h.due_at));
  const today = todayStr();
  if (d === today) return "Today";
  if (d === addDays(today, 1)) return "Tomorrow";
  if (d <= addDays(today, 7)) return "This week";
  return "Later";
}

const ORDER = ["Overdue", "Today", "Tomorrow", "This week", "Later", "No due date"];

function HomeworkSheet({ item, courses, onClose }: { item?: Homework; courses: string[]; onClose: () => void }) {
  const due = item?.due_at ? new Date(item.due_at) : null;
  const [title, setTitle] = useState(item?.title ?? "");
  const [course, setCourse] = useState(item?.course ?? "");
  const [date, setDate] = useState(due ? dateStr(due) : addDays(todayStr(), 1));
  const [time, setTime] = useState(due && !item?.all_day ? timeStr(due) : "");
  const [priority, setPriority] = useState(String(item?.priority ?? 2));
  const [status, setStatus] = useState<Homework["status"]>(item?.status ?? "todo");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = { title, course, due_date: date || null, due_time: time || null, priority: Number(priority), status, notes };
    try {
      if (item) await api.patch(`/homework/${item.id}`, body);
      else await api.post("/homework", body);
      toast(item ? "Saved" : "Assignment added");
      refreshAll();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const remove = async () => {
    if (!item || !confirm(item.source === "manual" ? "Delete this assignment?" : "Remove this? It won't be imported again.")) return;
    await api.del(`/homework/${item.id}`);
    refreshAll();
    onClose();
  };

  return (
    <Sheet title={item ? "Assignment" : "New assignment"} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <Field label="Assignment">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Chapter 5 problems" autoFocus={!item} />
        </Field>
        <Field label="Class">
          <input className="input" value={course} onChange={(e) => setCourse(e.target.value)} list="courses" placeholder="Chemistry" />
          <datalist id="courses">
            {courses.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <div className="grid-2">
          <Field label="Due">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Time" hint="optional">
            <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <Field label="Status">
          <Segmented
            value={status}
            onChange={setStatus}
            options={[
              { value: "todo", label: "To do" },
              { value: "doing", label: "Working on it" },
              { value: "done", label: "Done" },
            ]}
          />
        </Field>
        <Field label="Priority">
          <Segmented
            value={priority}
            onChange={setPriority}
            options={[
              { value: "1", label: "Low" },
              { value: "2", label: "Normal" },
              { value: "3", label: "High" },
            ]}
          />
        </Field>
        <Field label="Notes">
          <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {item?.url && (
          <a className="btn block" href={item.url} target="_blank" rel="noreferrer">
            <Icon name="external" size={18} /> Open in Schoology
          </a>
        )}
        <ErrorBox error={error} />
        <button className="btn primary block" disabled={!title}>
          {item ? "Save" : "Add assignment"}
        </button>
        {item && (
          <button type="button" className="btn danger block" onClick={remove}>
            <Icon name="trash" size={18} /> {item.source === "manual" ? "Delete" : "Remove"}
          </button>
        )}
      </form>
    </Sheet>
  );
}

export function HomeworkPage() {
  const [tab, setTab] = useState<"open" | "done">("open");
  const { data, error, setData } = useApi<Homework[]>(`/homework?status=${tab}`);
  const courses = useApi<string[]>("/homework/courses").data ?? [];
  const settings = useApi<{ schoology: { hasIcal: boolean; hasApi: boolean } }>("/settings").data;
  const [sheet, setSheet] = useState<{ item?: Homework } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [course, setCourse] = useState("all");

  const toggle = async (h: Homework) => {
    const status = h.status === "done" ? "todo" : "done";
    setData((data ?? []).filter((x) => x.id !== h.id));
    await api.patch(`/homework/${h.id}`, { status });
    toast(status === "done" ? `Done: ${h.title}` : "Moved back to to-do");
    refreshAll();
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api.post<{ imported: number }>("/schoology/sync");
      toast(r.imported ? `${r.imported} new from Schoology — check Approvals` : "Schoology is up to date");
      refreshAll();
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setSyncing(false);
    }
  };

  const items = (data ?? []).filter((h) => course === "all" || h.course === course);
  const groups = new Map<string, Homework[]>();
  for (const h of items) {
    const b = tab === "done" ? "Completed" : bucket(h);
    groups.set(b, [...(groups.get(b) ?? []), h]);
  }
  const groupNames = tab === "done" ? ["Completed"] : ORDER.filter((g) => groups.has(g));
  const hasSchoology = settings?.schoology.hasIcal || settings?.schoology.hasApi;

  return (
    <>
      <TopBar
        title="Homework"
        right={
          hasSchoology ? (
            <button className="icon-btn" aria-label="Sync Schoology" onClick={sync} disabled={syncing}>
              <Icon name="refresh" className={syncing ? "spin" : ""} />
            </button>
          ) : undefined
        }
      />
      <div className="page">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "open", label: "To do" },
            { value: "done", label: "Done" },
          ]}
        />
        {courses.length > 1 && (
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
            {["all", ...courses].map((c) => (
              <button key={c} className={`chip${course === c ? " wood" : ""}`} style={{ border: 0, cursor: "pointer", padding: "6px 12px" }} onClick={() => setCourse(c)}>
                {c === "all" ? "All classes" : c}
              </button>
            ))}
          </div>
        )}
        <ErrorBox error={error} />
        {!data ? (
          <Spinner />
        ) : items.length === 0 ? (
          <section className="card">
            <Empty icon="book" title={tab === "done" ? "Nothing finished yet" : "No homework"}>
              {tab === "open" && !hasSchoology ? "Connect Schoology in Settings to import assignments automatically, or tap + to add one." : null}
            </Empty>
          </section>
        ) : (
          <section className="card flush">
            {groupNames.map((g) => (
              <div key={g}>
                <div className={`day-head${g === "Overdue" ? "" : g === "Today" ? " today" : ""}`} style={g === "Overdue" ? { color: "var(--bad)" } : undefined}>
                  {g} · {groups.get(g)!.length}
                </div>
                {groups.get(g)!.map((h) => (
                  <div key={h.id} className="row">
                    <input type="checkbox" className="check" checked={h.status === "done"} onChange={() => toggle(h)} aria-label={`Toggle ${h.title}`} />
                    <button className="row-main" onClick={() => setSheet({ item: h })} style={{ background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer" }}>
                      <div className={`row-title${h.status === "done" ? " done" : ""}`}>
                        {h.priority >= 3 && <span style={{ color: "var(--bad)" }}>! </span>}
                        {h.title}
                      </div>
                      <div className="row-sub" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        <span>{fmtDue(h.due_at, h.all_day)}</span>
                        {h.course && <span className="chip">{h.course}</span>}
                        {h.status === "doing" && <span className="chip warn">In progress</span>}
                        {h.source === "schoology" && <span className="chip">Schoology</span>}
                      </div>
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </section>
        )}
      </div>
      <Fab label="Add assignment" onClick={() => setSheet({})} />
      {sheet && <HomeworkSheet item={sheet.item} courses={courses} onClose={() => setSheet(null)} />}
    </>
  );
}

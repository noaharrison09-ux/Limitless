import { useState, type FormEvent } from "react";
import { api, errorMessage, toast } from "../lib/api";
import { useApi } from "../lib/hooks";
import { fmtDay } from "../lib/dates";
import type { Goal } from "../lib/types";
import { Icon } from "../components/Icon";
import { Empty, ErrorBox, Fab, Field, Progress, Segmented, Sheet, Spinner, TopBar, fmtNum } from "../components/ui";

const CATEGORIES = ["Fitness", "School", "Personal", "Money", "Skills", "Projects"];

function GoalSheet({ goal, onClose, onSaved }: { goal?: Goal; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(goal?.title ?? "");
  const [description, setDescription] = useState(goal?.description ?? "");
  const [category, setCategory] = useState(goal?.category ?? "");
  const [targetDate, setTargetDate] = useState(goal?.target_date ?? "");
  const [kind, setKind] = useState<Goal["kind"]>(goal?.kind ?? "steps");
  const [start, setStart] = useState(goal?.start_value?.toString() ?? "");
  const [target, setTarget] = useState(goal?.target_value?.toString() ?? "");
  const [unit, setUnit] = useState(goal?.unit ?? "");
  const [steps, setSteps] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      title,
      description,
      category,
      target_date: targetDate || null,
      kind,
      start_value: kind === "number" ? start : null,
      target_value: kind === "number" ? target : null,
      current_value: kind === "number" ? (goal?.current_value ?? start) : null,
      unit: kind === "number" ? unit : null,
      steps: goal ? undefined : steps.split("\n").filter((s) => s.trim()),
    };
    try {
      if (goal) await api.patch(`/goals/${goal.id}`, body);
      else await api.post("/goals", body);
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const remove = async () => {
    if (!goal || !confirm("Delete this goal?")) return;
    await api.del(`/goals/${goal.id}`);
    onSaved();
    onClose();
  };

  return (
    <Sheet title={goal ? "Edit goal" : "New goal"} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <Field label="Goal">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Bench 225, get an A in Chem…" autoFocus={!goal} />
        </Field>
        <Field label="Why it matters" hint="optional">
          <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </Field>
        <div className="grid-2">
          <Field label="Area">
            <input className="input" list="goal-cats" value={category} onChange={(e) => setCategory(e.target.value)} />
            <datalist id="goal-cats">
              {CATEGORIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="By">
            <input className="input" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Track progress by">
          <Segmented
            value={kind}
            onChange={setKind}
            options={[
              { value: "steps", label: "Milestones" },
              { value: "number", label: "A number" },
            ]}
          />
        </Field>
        {kind === "number" ? (
          <div className="grid-3">
            <Field label="Start">
              <input className="input" inputMode="decimal" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Target">
              <input className="input" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
            </Field>
            <Field label="Unit">
              <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="lb, $, pages" />
            </Field>
          </div>
        ) : (
          !goal && (
            <Field label="Milestones" hint="one per line">
              <textarea className="input" value={steps} onChange={(e) => setSteps(e.target.value)} rows={4} placeholder={"Find a program\nTrain 4x/week for a month\nTest 1RM"} />
            </Field>
          )
        )}
        <ErrorBox error={error} />
        <button className="btn primary block" disabled={!title || (kind === "number" && !target)}>
          {goal ? "Save" : "Create goal"}
        </button>
        {goal && (
          <button type="button" className="btn danger block" onClick={remove}>
            <Icon name="trash" size={18} /> Delete goal
          </button>
        )}
      </form>
    </Sheet>
  );
}

function GoalCard({ goal, onChange, onEdit }: { goal: Goal; onChange: (g: Goal) => void; onEdit: () => void }) {
  const [step, setStep] = useState("");
  const [value, setValue] = useState("");

  const call = async (p: Promise<Goal>) => {
    try {
      onChange(await p);
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  const done = goal.status === "done";
  return (
    <section className="card">
      <div className="card-head" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">
            {goal.category || "Goal"}
            {goal.target_date ? ` · by ${fmtDay(goal.target_date)}` : ""}
          </div>
          <h2 style={done ? { textDecoration: "line-through", color: "var(--ink-3)" } : undefined}>{goal.title}</h2>
        </div>
        <button className="icon-btn" aria-label="Edit goal" onClick={onEdit}>
          <Icon name="edit" size={18} />
        </button>
      </div>
      {goal.description && <p className="small" style={{ margin: "-4px 0 10px", color: "var(--ink-2)" }}>{goal.description}</p>}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <Progress value={goal.progress} />
        </div>
        <strong className="small">{Math.round(goal.progress * 100)}%</strong>
      </div>

      {goal.kind === "number" ? (
        <>
          <div className="small muted" style={{ marginTop: 6 }}>
            {fmtNum(goal.current_value ?? goal.start_value)} → {fmtNum(goal.target_value)} {goal.unit}
          </div>
          {!done && (
            <div className="kbd-add" style={{ marginTop: 10 }}>
              <input className="input" inputMode="decimal" placeholder={`Update current ${goal.unit ?? "value"}`} value={value} onChange={(e) => setValue(e.target.value)} />
              <button
                className="btn"
                disabled={!value}
                onClick={() => {
                  void call(api.patch<Goal>(`/goals/${goal.id}`, { current_value: value }));
                  setValue("");
                }}
              >
                Update
              </button>
            </div>
          )}
        </>
      ) : (
        <div style={{ marginTop: 6 }}>
          {goal.steps.map((s) => (
            <div key={s.id} className="row" style={{ padding: "8px 0", minHeight: 0 }}>
              <input type="checkbox" className="check" checked={!!s.done} onChange={(e) => call(api.patch<Goal>(`/goals/steps/${s.id}`, { done: e.target.checked }))} />
              <span className={`row-main row-title${s.done ? " done" : ""}`} style={{ fontWeight: 500 }}>
                {s.title}
              </span>
              <button className="icon-btn" style={{ width: 30, height: 30, border: 0 }} aria-label="Remove milestone" onClick={() => call(api.del<Goal>(`/goals/steps/${s.id}`))}>
                <Icon name="x" size={15} />
              </button>
            </div>
          ))}
          {!done && (
            <div className="kbd-add" style={{ marginTop: 8 }}>
              <input
                className="input"
                placeholder="Add a milestone"
                value={step}
                onChange={(e) => setStep(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && step.trim()) {
                    void call(api.post<Goal>(`/goals/${goal.id}/steps`, { title: step }));
                    setStep("");
                  }
                }}
              />
              <button
                className="btn"
                aria-label="Add milestone"
                disabled={!step.trim()}
                onClick={() => {
                  void call(api.post<Goal>(`/goals/${goal.id}/steps`, { title: step }));
                  setStep("");
                }}
              >
                <Icon name="plus" size={18} />
              </button>
            </div>
          )}
        </div>
      )}
      <div className="btn-row" style={{ marginTop: 12 }}>
        {done ? (
          <button className="btn small" onClick={() => call(api.patch<Goal>(`/goals/${goal.id}`, { status: "active" }))}>
            Reopen
          </button>
        ) : (
          <button className="btn small primary" onClick={() => call(api.patch<Goal>(`/goals/${goal.id}`, { status: "done" })).then(() => toast("Goal complete! 🎉"))}>
            <Icon name="check" size={16} /> Mark achieved
          </button>
        )}
      </div>
    </section>
  );
}

export function GoalsPage() {
  const { data, error, reload, setData } = useApi<Goal[]>("/goals");
  const [tab, setTab] = useState<"active" | "done">("active");
  const [sheet, setSheet] = useState<{ goal?: Goal } | null>(null);

  const list = (data ?? []).filter((g) => (tab === "active" ? g.status === "active" : g.status !== "active"));
  const replace = (g: Goal) => setData((data ?? []).map((x) => (x.id === g.id ? g : x)));

  return (
    <>
      <TopBar title="Goals" back />
      <div className="page">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "active", label: "Active" },
            { value: "done", label: "Achieved" },
          ]}
        />
        <ErrorBox error={error} />
        {!data ? (
          <Spinner />
        ) : list.length === 0 ? (
          <section className="card">
            <Empty icon="target" title={tab === "active" ? "No active goals" : "Nothing achieved yet"}>
              {tab === "active" ? "Tap + to set one. Break it into milestones or track a number." : "Your wins will collect here."}
            </Empty>
          </section>
        ) : (
          list.map((g) => <GoalCard key={g.id} goal={g} onChange={replace} onEdit={() => setSheet({ goal: g })} />)
        )}
      </div>
      <Fab label="New goal" onClick={() => setSheet({})} />
      {sheet && <GoalSheet goal={sheet.goal} onClose={() => setSheet(null)} onSaved={reload} />}
    </>
  );
}
